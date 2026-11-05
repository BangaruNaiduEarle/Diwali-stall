"""Clone/check only a pre-migrated disposable fixture. Never apply migrations."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

directory=Path(sys.argv[1]).resolve(strict=True)
root=directory.parent
assert directory.name.startswith('reports-backend-') and (root/'isolation.json').exists()
state=json.loads((directory/'state.json').read_text())
source=Path(state['sourceDatabase']).resolve(strict=True)
target=Path(state['databaseFile']).resolve(strict=True)
assert root in source.parents and directory not in source.parents and 'persist' in source.parts
assert directory/'persist' in target.parents and target != source
assert str(source) != json.loads((root/'isolation.json').read_text())['original']

def snapshot(file):
    with sqlite3.connect(file.as_uri()+'?mode=ro',uri=True) as db:
        db.execute('BEGIN')
        schema=[list(row) for row in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name")]
        tables={}
        for typ,name,_,_ in schema:
            if typ=='table':
                rows=sorted(json.dumps(list(row),ensure_ascii=True) for row in db.execute('SELECT * FROM "'+name.replace('"','""')+'"'))
                tables[name]={'rows':len(rows),'sha256':hashlib.sha256('\n'.join(rows).encode()).hexdigest()}
        return {'schema':schema,'tables':tables,'integrity':[list(r) for r in db.execute('PRAGMA integrity_check')], 'foreignKeys':[list(r) for r in db.execute('PRAGMA foreign_key_check')]}

if sys.argv[2]=='clone':
    assert not (directory/'source-before.json').exists()
    before=snapshot(source)
    assert any(row[1]=='location_settings_events' for row in before['schema'])
    with sqlite3.connect(target) as dest:
        assert not list(dest.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"))
        with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as src:src.backup(dest)
    assert snapshot(target)==before
    (directory/'source-before.json').write_text(json.dumps(before,indent=2))
    print(json.dumps({'cloned':True,'migrationsApplied':False,'sourceReadOnly':True}))
else:
    before=json.loads((directory/'source-before.json').read_text())
    current=snapshot(target)
    protected=['customer_requests','customer_request_items','quotations','quotation_items','request_payment_accounts','request_payment_ledger','request_workflow_events','bill_item_purchase_costs','offline_sync_receipts','request_handover_claims','d1_migrations','platform_settings']
    result={'sourceUnchanged':snapshot(source)==before,'schemaUnchanged':current['schema']==before['schema'],
      'protectedTables':{name:current['tables'][name]==before['tables'][name] for name in protected},'integrity':current['integrity'],'foreignKeys':current['foreignKeys']}
    result['status']='PASS' if result['sourceUnchanged'] and result['schemaUnchanged'] and all(result['protectedTables'].values()) and result['integrity']==[['ok']] and not result['foreignKeys'] else 'FAIL'
    (directory/'preservation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));assert result['status']=='PASS'

