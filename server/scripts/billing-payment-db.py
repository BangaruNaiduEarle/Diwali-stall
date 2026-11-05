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
assert str(target) != manifest['original'] and directory.name.startswith('p4-')
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
            state = json.loads((directory / 'state.json').read_text(encoding='utf-8-sig'))
            progress = json.loads((directory / 'http-progress.json').read_text())
            saved = progress['saved']
            expected_ids = {saved[key]['id'] for key in ['lifecycle', 'race', 'samePayment', 'uniqueTarget', 'referenceTarget', 'validation', 'bBill', 'offline', 'superHandover']}
            expected_ids.update(saved[key] for key in ['referenceId', 'roundingId', 'pieceFloorId'])
            expected_ids.add(saved['checkoutConcurrency']['duplicateId'])
            expected_ids.update(saved['checkoutConcurrency']['independentIds'])
            requests = list(db.execute('SELECT id,location_id,season_id,revision,status,finalization_status,creator_user_id,assigned_to_user_id,closed_by_email FROM customer_requests WHERE location_id IN (?,?)', (state['a'],state['b'])))
            assert {row[0] for row in requests} == expected_ids, 'Unexpected/missing fixture bills'
            audits = []
            for request_id, location, season, revision, status, finalization, creator, recipient, finalizer in requests:
                events = list(db.execute('SELECT event_id,revision,business_id,location_id,season_id FROM request_workflow_events WHERE request_id=? ORDER BY revision', (request_id,)))
                assert [row[1] for row in events] == list(range(1,revision+1))
                assert all(row[2:] == (state['business'], location, season) for row in events)
                quotes = list(db.execute("SELECT id,accepted_amount_paise FROM quotations WHERE customer_request_id=? AND status!='void'", (request_id,)))
                assert len(quotes) == 1, 'Duplicate active quotation'
                account = db.execute('SELECT business_id,location_id,season_id,amount_due_paise,quotation_id FROM request_payment_accounts WHERE request_id=?', (request_id,)).fetchone()
                ledger = list(db.execute('SELECT payment_id,operation_id,entry_type,amount_paise,recording_mode,payment_method,actor_user_id,actor_role,device_id,occurred_at,received_at,business_id,location_id,season_id FROM request_payment_ledger WHERE request_id=? ORDER BY sequence', (request_id,)))
                if status == 'closed' and finalization == 'finalized':
                    assert account == (state['business'],location,season,quotes[0][1],quotes[0][0])
                else:
                    assert account is None and not ledger
                for payment_id, operation_id, entry_type, amount, mode, method, actor, role, device, occurred, received, business, ledger_location, ledger_season in ledger:
                    assert (business,ledger_location,ledger_season) == (state['business'],location,season)
                    assert isinstance(amount,int)
                    event = db.execute('SELECT actor_user_id,actor_role,device_id,occurred_at,received_at,event_type,metadata_json FROM request_workflow_events WHERE request_id=? AND event_id=?', (request_id,'payment-event-'+payment_id)).fetchone()
                    assert event and event[:5] == (actor,role,device,occurred,received)
                    expected_type = {'PAYMENT':'payment_recorded','HOLD':'payment_hold_set','RELEASE_HOLD':'payment_hold_released'}[entry_type]
                    assert event[5] == expected_type
                    metadata = json.loads(event[6])
                    assert metadata['paymentId'] == payment_id and metadata['operationId'] == operation_id
                    assert metadata['recordingMode'] == mode and metadata['paymentMethod'] == method
                summary = db.execute('SELECT amount_due_paise,received_paise,outstanding_paise,payment_count FROM request_payment_summaries WHERE request_id=?',(request_id,)).fetchone()
                paid = sum(row[3] for row in ledger if row[2]=='PAYMENT')
                assert summary[1] == paid and summary[3] == sum(row[2]=='PAYMENT' for row in ledger)
                if account:
                    assert summary[0] == account[3] and summary[2] == account[3]-paid and summary[2]>=0
                audits.append({'requestId':request_id,'location':location,'season':season,'revision':revision,'events':len(events),'activeQuotations':len(quotes),'ledgerEntries':len(ledger),'duePaise':summary[0],'receivedPaise':paid,'outstandingPaise':summary[2]})
            original_quote = db.execute('SELECT unit_rate_paise,line_total_paise FROM quotation_items WHERE quotation_id=?',(saved['lifecycle']['quotationId'],)).fetchone()
            assert original_quote == (10001,10001)
            original_item = db.execute('SELECT line_id,unit_price_paise FROM customer_request_items WHERE request_id=?',(saved['lifecycle']['id'],)).fetchone()
            assert original_item == (saved['lifecycle']['lineId'],10001)
            lifecycle = next(row for row in requests if row[0]==saved['lifecycle']['id'])
            assert lifecycle[6:] == (state['actors']['admin']['id'],state['actors']['owner']['id'],state['actors']['super']['email'])
            receipts = list(db.execute('SELECT operation_id,request_id,operation_type FROM offline_sync_receipts WHERE business_id=?',(state['business'],)))
            assert len(receipts)==1 and receipts[0][1:]==(saved['offline']['id'],'PAYMENT')
            assert db.execute('SELECT count(*) FROM request_payment_ledger WHERE operation_id=?',(receipts[0][0],)).fetchone()[0]==1
            actor_names = list(db.execute('SELECT p.actor_user_id,p.actor_name,u.display_name FROM request_payment_ledger p JOIN admin_users u ON u.id=p.actor_user_id WHERE p.business_id=?',(state['business'],)))
            assert all(row[1] == row[2] and row[1] for row in actor_names)
            assert db.execute('SELECT count(*) FROM request_workflow_events e JOIN request_payment_ledger p ON e.event_id = ? || p.payment_id WHERE p.business_id=? AND e.actor_name IS NOT p.actor_name',('payment-event-',state['business'])).fetchone()[0]==0
            result['phase4Audit']={'status':'PASS','requestCount':len(requests),'eventCount':sum(row['events'] for row in audits),'ledgerEntries':sum(row['ledgerEntries'] for row in audits),'bills':audits,'originalCatalogueAndQuotationSnapshotsPreserved':True,'distinctCreatorRecipientFinalizer':True,'offlineReceiptLedgerPairs':len(receipts)}
            output = directory / ('preservation-' + str(time.time_ns()) + '.json')
            with output.open('x') as out:
                json.dump(result, out, indent=2)
            print(json.dumps({'status': result['status'], 'rowsVerified': sum(t['before'] for t in tables.values()), 'tables': len(tables), 'phase4Audit': {key:value for key,value in result['phase4Audit'].items() if key!='bills'}, 'output': str(output)}))
            assert result['status'] == 'PASS'

