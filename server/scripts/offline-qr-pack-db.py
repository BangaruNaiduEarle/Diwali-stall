"""Snapshot/verify only the established disposable database, always read-only."""
import json
import sqlite3
import sys
import time
import hashlib
from collections import Counter
from pathlib import Path

root, directory = (Path(value).resolve(strict=True) for value in sys.argv[1:3])
manifest = json.loads((root / 'isolation.json').read_text())
target = Path(manifest['disposableDatabaseFile']).resolve(strict=True)
assert root / 'persist' in target.parents and root in directory.parents
assert str(target) != manifest['original'] and directory.name.startswith('p6-')
baseline = directory / 'before.sqlite'
with sqlite3.connect(target.as_uri() + '?mode=ro', uri=True) as db:
    if sys.argv[3] == 'snapshot':
        assert not baseline.exists()
        with sqlite3.connect(baseline) as out:
            db.backup(out)
        print(json.dumps({'snapshot': str(baseline)}))
    else:
        db.execute('BEGIN')
        with sqlite3.connect(baseline.as_uri() + '?mode=ro', uri=True) as before:
            tables = {}
            for (name,) in before.execute("SELECT name FROM sqlite_master WHERE type='table'"):
                if name in ('sqlite_sequence', '_cf_METADATA'):
                    continue
                quoted = '"' + name.replace('"', '""') + '"'
                old = Counter(before.execute('SELECT * FROM ' + quoted))
                new = Counter(db.execute('SELECT * FROM ' + quoted))
                tables[name] = {'before': sum(old.values()), 'changedOrMissing': sum((old-new).values())}
            schema = 'SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name'
            result = {'tables': tables, 'schemaUnchanged': list(before.execute(schema)) == list(db.execute(schema)),
                      'migrationsUnchanged': list(before.execute('SELECT * FROM d1_migrations')) == list(db.execute('SELECT * FROM d1_migrations')),
                      'integrity': list(db.execute('PRAGMA integrity_check')), 'foreignKeys': list(db.execute('PRAGMA foreign_key_check'))}
            result['status'] = 'PASS' if all(t['changedOrMissing'] == 0 for t in tables.values()) and result['schemaUnchanged'] and result['migrationsUnchanged'] and result['integrity'] == [('ok',)] and not result['foreignKeys'] else 'FAIL'
            state=json.loads((directory/'state.json').read_text())
            progress=json.loads((directory/'browser-progress.json').read_text())
            saved=progress['saved']
            expected={saved[key]['envelope']['payload']['requestId'] for key in ['normal','mixed']}
            requests=list(db.execute('SELECT id,location_id,season_id,revision,status,creator_user_id FROM customer_requests WHERE location_id=?',(state['a'],)))
            assert {r[0] for r in requests}==expected and len(requests)==2
            operations=[r for s in saved['finalSnapshots'].values() for r in s['outbox']]
            assert len(operations)==8 and len({r['id'] for r in operations})==8
            synced={r['id']:r for r in operations if r['state']=='synced'}
            conflicts={r['id']:r for r in operations if r['state']=='conflict'}
            assert len(synced)==6 and len(conflicts)==2 and all(r['payload']['kind']=='CREATE' for r in conflicts.values())
            receipts=list(db.execute('SELECT operation_id,fingerprint,request_id,revision,business_id,location_id,season_id,user_id,device_id,actor_role,operation_type,occurred_at,received_at FROM offline_sync_receipts WHERE business_id=?',(state['business'],)))
            assert {r[0] for r in receipts}==set(synced)
            receipt_checks=[]
            for op_id,fingerprint,request_id,revision,business,location,season,user,device,role,kind,occurred,received in receipts:
                local=synced[op_id];op=local['payload'];scope=op['scope']
                assert (business,location,season,user,device)==tuple(scope[key] for key in ['businessId','locationId','seasonId','userId','deviceId'])
                assert role=='owner' and user==state['actors']['owner']['id']
                assert kind==('CREATE' if op['kind']=='HANDOVER' else op['kind'])
                assert occurred==op['occurredAt'] and received
                calculated=hashlib.sha256(json.dumps(op,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
                assert calculated==fingerprint
                assert (request_id,revision)==(local['ack']['requestId'],local['ack']['revision'])
                event=db.execute('SELECT actor_user_id,actor_role,device_id,occurred_at,received_at FROM request_workflow_events WHERE request_id=? AND revision=?',(request_id,revision)).fetchone()
                assert event and event[:4]==(user,role,device,occurred) and event[4]
                receipt_checks.append({'operationId':op_id,'requestId':request_id,'kind':kind,'revision':revision,'fingerprintVerified':True,'actor':user,'device':device,'occurredAt':occurred,'receivedAt':received})
            event_count=0
            for request_id,location,season,revision,status,creator in requests:
                assert (location,season,creator)==(state['a'],state['season'],state['actors']['admin']['id'])
                events=list(db.execute('SELECT revision,business_id,location_id,season_id FROM request_workflow_events WHERE request_id=? ORDER BY revision',(request_id,)))
                assert [r[0] for r in events]==list(range(1,revision+1)) and all(r[1:]==(state['business'],location,season) for r in events)
                event_count+=len(events)
                assert db.execute("SELECT count(*) FROM quotations WHERE customer_request_id=? AND status!='void'",(request_id,)).fetchone()[0]==1
            mixed=saved['mixed']['envelope']['payload'];mixed_id=mixed['requestId']
            pack_lines=mixed['lines'][1:]
            items=list(db.execute('SELECT family_pack_id,quantity,unit_type,unit_price_paise,pack_snapshot FROM customer_request_items WHERE request_id=? AND family_pack_id IS NOT NULL ORDER BY line_number',(mixed_id,)))
            assert len(items)==2
            for item,line in zip(items,pack_lines):
                assert item[:4]==(line['familyPackId'],line['quantity'],'box',line['sellingUnitPaise'])
                assert json.loads(item[4])==line['packSnapshot']
            active=db.execute("SELECT id,total_paise,adjustment_paise,accepted_amount_paise FROM quotations WHERE customer_request_id=? AND status!='void'",(mixed_id,)).fetchone()
            assert active[1:]==(161700,-1000,50000)
            quotes=list(db.execute('SELECT total_paise FROM quotations WHERE customer_request_id=?',(mixed_id,)))
            assert (163000,) in quotes
            quote_packs=list(db.execute('SELECT i.family_pack_id,q.quantity,q.unit_rate_paise,q.pack_snapshot FROM quotation_items q JOIN customer_request_items i ON i.line_id=q.request_line_id AND i.request_id=? WHERE q.quotation_id=? AND i.family_pack_id IS NOT NULL ORDER BY q.line_number',(mixed_id,active[0])))
            assert len(quote_packs)==2
            for item,line in zip(quote_packs,pack_lines):
                assert item[:3]==(line['familyPackId'],line['quantity'],line['sellingUnitPaise']) and json.loads(item[3])==line['packSnapshot']
            claims=list(db.execute('SELECT transfer_id,request_id,operation_id,initiator_user_id,recipient_user_id FROM request_handover_claims WHERE business_id=?',(state['business'],)))
            assert len(claims)==2
            for transfer,request_id,op_id,creator,recipient in claims:
                export=next(saved[key]['envelope'] for key in ['normal','mixed'] if saved[key]['envelope']['payload']['requestId']==request_id)
                assert transfer==export['payload']['transferId'] and op_id in synced and creator==state['actors']['admin']['id'] and recipient==state['actors']['owner']['id']
            ledger=list(db.execute('SELECT operation_id,request_id,amount_paise,recording_mode,payment_method,actor_user_id,device_id FROM request_payment_ledger WHERE business_id=?',(state['business'],)))
            assert len(ledger)==1 and ledger[0][1:]==(mixed_id,10000,'OFFLINE','CASH',state['actors']['owner']['id'],synced[ledger[0][0]]['payload']['scope']['deviceId'])
            summary=db.execute('SELECT amount_due_paise,received_paise,outstanding_paise,payment_status FROM request_payment_summaries WHERE request_id=?',(mixed_id,)).fetchone()
            assert summary==(50000,10000,40000,'PARTIAL')
            accounts=list(db.execute('SELECT request_id,business_id,location_id,season_id FROM request_payment_accounts WHERE business_id=?',(state['business'],)))
            assert accounts==[(mixed_id,state['business'],state['a'],state['season'])]
            assert db.execute('SELECT status,closed_by_email FROM customer_requests WHERE id=?',(mixed_id,)).fetchone()==('closed',state['actors']['owner']['email'])
            result['phase6Audit']={'status':'PASS','requests':2,'localOperations':8,'receipts':6,'sourceConflictsWithoutReceipts':2,'qrClaims':2,'accounts':1,'payments':1,'workflowEvents':event_count,'unchangedPackSnapshots':2,'variantQuantities':[2,1],'variantUnitLabels':['box','piece','packet','bundle'],'originalQuotationPaise':163000,'adjustedQuotationPaise':161700,'amountDuePaise':50000,'receivedPaise':10000,'outstandingPaise':40000,'receiptMetadata':receipt_checks}
            output = directory / ('preservation-' + str(time.time_ns()) + '.json')
            with output.open('x') as out:
                json.dump(result, out, indent=2)
            print(json.dumps({'status': result['status'], 'rowsVerified': sum(t['before'] for t in tables.values()), 'tables': len(tables), 'phase6Audit':{key:value for key,value in result['phase6Audit'].items() if key!='receiptMetadata'}, 'output': str(output)}))
            assert result['status'] == 'PASS'

