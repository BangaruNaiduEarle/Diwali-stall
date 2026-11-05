"""Snapshot/verify only the established disposable database, always read-only."""
import json
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path

root, directory = (Path(value).resolve(strict=True) for value in sys.argv[1:3])
manifest = json.loads((root / 'isolation.json').read_text())
target = Path(manifest['disposableDatabaseFile']).resolve(strict=True)
assert root / 'persist' in target.parents and root in directory.parents
assert str(target) != manifest['original'] and directory.name.startswith('p5-')
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
            state = json.loads((directory / 'state.json').read_text())
            progress = json.loads((directory / 'browser-progress-verified.json').read_text())
            saved = progress['saved']
            snapshots = saved['finalSnapshots']
            expected = set(saved['mainIds'] + [saved['duplicateId']] + saved['raceIndependentIds'] + [saved['qr']['requestId']])
            assert len(expected) == 8
            requests = list(db.execute('SELECT id,location_id,season_id,revision,status FROM customer_requests WHERE location_id IN (?,?)',(state['a'],state['b'])))
            assert {row[0] for row in requests} == expected
            all_operations = [row for snapshot in snapshots.values() for row in snapshot['outbox']]
            assert len({row['id'] for row in all_operations}) == len(all_operations)
            synced = {row['id']: row for row in all_operations if row['state']=='synced'}
            conflicts = {row['id']: row for row in all_operations if row['state']=='conflict'}
            assert len(synced) == (16 if saved.get('raceRetry') else 15) and len(conflicts) == (5 if saved.get('raceRetry') else 4) and len(all_operations)==(21 if saved.get('raceRetry') else 19)
            receipts = list(db.execute('SELECT operation_id,request_id,revision,business_id,location_id,season_id,user_id,device_id,actor_role,captured_role,operation_type,occurred_at,received_at FROM offline_sync_receipts WHERE business_id=?',(state['business'],)))
            assert {row[0] for row in receipts} == set(synced)
            assert not set(conflicts).intersection(row[0] for row in receipts)
            receipt_checks = []
            for op_id,request_id,revision,business,location,season,user,device,role,captured,kind,occurred,received in receipts:
                local=synced[op_id];op=local['payload'];scope=op['scope']
                assert (business,location,season,user,device)==tuple(scope[key] for key in ['businessId','locationId','seasonId','userId','deviceId'])
                expected_kind = 'CREATE' if op['kind']=='HANDOVER' else op['kind']
                assert kind==expected_kind and occurred==op['occurredAt'] and received
                assert captured==op['capturedRole'] and local['ack']['revision']==revision and local['ack']['requestId']==request_id
                actor_name = next(name for name,actor in state['actors'].items() if actor['id']==user)
                assert role==state['actors'][actor_name]['role']
                event=db.execute('SELECT actor_user_id,actor_role,device_id,occurred_at,received_at,actor_name FROM request_workflow_events WHERE request_id=? AND revision=?',(request_id,revision)).fetchone()
                assert event and event[:4]==(user,role,device,occurred) and event[4]
                assert event[5]=='Phase5 '+actor_name
                receipt_checks.append({'operationId':op_id,'kind':kind,'requestId':request_id,'revision':revision,'actor':user,'device':device,'occurredAt':occurred,'receivedAt':received,'eventReceivedAt':event[4]})
            bills=[]
            for request_id,location,season,revision,status in requests:
                assert (location,season)==(state['a'],state['season'])
                events=list(db.execute('SELECT revision,business_id,location_id,season_id FROM request_workflow_events WHERE request_id=? ORDER BY revision',(request_id,)))
                assert [r[0] for r in events]==list(range(1,revision+1))
                assert all(r[1:]==(state['business'],location,season) for r in events)
                assert db.execute("SELECT count(*) FROM quotations WHERE customer_request_id=? AND status!='void'",(request_id,)).fetchone()[0]==1
                bills.append({'requestId':request_id,'revision':revision,'events':len(events),'status':status})
            for index,request_id in enumerate(saved['mainIds']):
                row=db.execute('SELECT creator_user_id FROM customer_requests WHERE id=?',(request_id,)).fetchone()
                assert row[0]==state['actors']['admin'+str(index+1)]['id']
            winner=db.execute('SELECT quantity FROM customer_request_items WHERE request_id=? AND product_id=?',(saved['editRace']['id'],state['products']['a'])).fetchone()
            assert winner[0]==saved['editRace']['quantity']
            final_id=saved['finalizationId']
            final=db.execute('SELECT status,closed_by_email FROM customer_requests WHERE id=?',(final_id,)).fetchone()
            assert final==('closed',state['actors']['owner']['email'])
            assert db.execute('SELECT quantity FROM customer_request_items WHERE request_id=?',(final_id,)).fetchone()[0]==5
            summary=db.execute('SELECT amount_due_paise,received_paise,outstanding_paise FROM request_payment_summaries WHERE request_id=?',(final_id,)).fetchone()
            assert summary==(42000,10000,32000)
            ledger=list(db.execute('SELECT operation_id,payment_id,actor_user_id,device_id,occurred_at,received_at,amount_paise,recording_mode FROM request_payment_ledger WHERE business_id=?',(state['business'],)))
            assert len(ledger)==1
            entry=ledger[0];pay_op=synced[entry[0]]['payload']
            assert entry[1]==saved['payment']['paymentId'] and entry[2:5]==(pay_op['scope']['userId'],pay_op['scope']['deviceId'],pay_op['occurredAt'])
            assert entry[5] and entry[6:]==(10000,'OFFLINE')
            claims=list(db.execute('SELECT transfer_id,request_id,initiator_user_id,recipient_user_id FROM request_handover_claims WHERE business_id=?',(state['business'],)))
            assert len(claims)==1 and claims[0]==(saved['qr']['transferId'],saved['qr']['requestId'],saved['qr']['creator'],saved['qr']['recipient'])
            assert db.execute('SELECT creator_user_id FROM customer_requests WHERE id=?',(saved['qr']['requestId'],)).fetchone()[0]==saved['qr']['creator']
            closure=db.execute('SELECT status,closed_by_email FROM customer_requests WHERE id=?',(saved['closure']['id'],)).fetchone()
            assert closure==('closed',state['actors'][saved['closure']['winner']]['email'])
            accounts=list(db.execute('SELECT request_id,business_id,location_id,season_id FROM request_payment_accounts WHERE business_id=?',(state['business'],)))
            assert len(accounts)==2 and all(row[1:]==(state['business'],state['a'],state['season']) for row in accounts)
            result['concurrencyAudit']={'status':'PASS','requests':len(requests),'operations':len(all_operations),'receipts':len(receipts),'conflictsWithoutReceipts':len(conflicts),'ledgerEntries':len(ledger),'qrClaims':len(claims),'finalizedAccounts':len(accounts),'workflowEvents':sum(r['events'] for r in bills),'bills':bills,'receiptMetadata':receipt_checks,'allExpectedRequestsPresent':True,'noCrossScopeWrites':True,'winnerVersionsPreserved':True}
            output = directory / ('preservation-' + str(time.time_ns()) + '.json')
            with output.open('x') as out:
                json.dump(result, out, indent=2)
            print(json.dumps({'status': result['status'], 'rowsVerified': sum(t['before'] for t in tables.values()), 'tables': len(tables), 'concurrencyAudit':{key:value for key,value in result['concurrencyAudit'].items() if key not in ['bills','receiptMetadata']}, 'output': str(output)}))
            assert result['status'] == 'PASS'

