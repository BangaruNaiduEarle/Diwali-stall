"""Only manifest-verified isolated backup/baseline and a fresh chain fixture."""
import hashlib
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

root, directory = (Path(value).resolve(strict=True) for value in sys.argv[1:3])
assert root in directory.parents and directory.name.startswith('chain-')
manifest = json.loads((root / 'isolation.json').read_text())
backup = Path(manifest['verifiedBackup']).resolve(strict=True)
baseline = Path(manifest['disposableDatabaseFile']).resolve(strict=True)
assert root / 'backup' in backup.parents and root / 'persist' in baseline.parents
assert str(backup) != manifest['original'] and str(baseline) != manifest['original']
state = json.loads((directory / 'state.json').read_text())
target = Path(state['databaseFile']).resolve(strict=True)
assert directory / 'persist' in target.parents and target not in (backup, baseline)

def rows(db, name, columns):
    quote = lambda s: '"' + s.replace('"', '""') + '"'
    values = db.execute('SELECT ' + ','.join(map(quote, columns)) + ' FROM ' + quote(name))
    return sorted(hashlib.sha256(json.dumps(list(row), ensure_ascii=True).encode()).hexdigest() for row in values)

def inspect(file):
    with sqlite3.connect(file.as_uri() + '?mode=ro', uri=True) as db:
        db.execute('BEGIN')
        schema = [list(row) for row in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name")]
        tables = {}
        for typ, name, _, _ in schema:
            if typ == 'table':
                columns = [r[1] for r in db.execute('PRAGMA table_info("' + name.replace('"','""') + '")')]
                tables[name] = {'columns': columns, 'rowHashes': rows(db,name,columns)}
        return {'schema':schema,'tables':tables,'integrity':[list(r) for r in db.execute('PRAGMA integrity_check')],
                'foreignKeys':[list(r) for r in db.execute('PRAGMA foreign_key_check')]}

def output(name, data):
    (directory / name).write_text(json.dumps(data, indent=2))

mode = sys.argv[3]
if mode == 'clone':
    assert not (directory / 'pre-chain.json').exists()
    before = inspect(backup)
    assert 'revision' not in before['tables']['customer_requests']['columns']
    assert len(before['tables']['d1_migrations']['rowHashes']) == 21
    with sqlite3.connect(target) as dest:
        assert not list(dest.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'"))
        with sqlite3.connect(backup.as_uri() + '?mode=ro', uri=True) as src:
            src.backup(dest)
    assert inspect(target) == before
    output('pre-chain.json', before)
    output('sources-before.json', {'backupSha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'baseline':inspect(baseline)})
    print(json.dumps({'freshClone':True,'preMigrationRecords':21,'tables':len(before['tables']),'rows':sum(len(t['rowHashes']) for t in before['tables'].values()),'originalOpened':False}))
else:
    before = json.loads((directory / 'pre-chain.json').read_text())
    current = inspect(target)
    source_before = json.loads((directory / 'sources-before.json').read_text())
    result = {'integrity':current['integrity'],'foreignKeys':current['foreignKeys'],'schemaObjects':len(current['schema']),
      'tables':{name:len(value['rowHashes']) for name,value in current['tables'].items()},'originalColumnPreservation':{},
      'backupUnchanged':hashlib.sha256(backup.read_bytes()).hexdigest() == source_before['backupSha256'],
      'establishedBaselineUnchanged':inspect(baseline) == source_before['baseline']}
    actual_objects = {(row[0], row[1]) for row in current['schema']}
    expected_objects = []
    for migration_file in sorted((directory / 'migrations').glob('*.sql')):
        for kind, name in re.findall(r'CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\s+(\w+)', migration_file.read_text(), re.I):
            expected_objects.append({'migration':migration_file.name,'type':kind.lower(),'name':name,'present':(kind.lower(),name) in actual_objects})
    result['expectedSchemaObjects'] = expected_objects
    result['allExpectedSchemaObjectsPresent'] = all(row['present'] for row in expected_objects)
    with sqlite3.connect(target.as_uri() + '?mode=ro', uri=True) as db:
        for name, old in before['tables'].items():
            original_rows = Counter(old['rowHashes'])
            projected = Counter(rows(db,name,old['columns']))
            result['originalColumnPreservation'][name] = {'rows':sum(original_rows.values()),'missingOrModified':sum((original_rows-projected).values())}
        result['migrationNames'] = [row[0] for row in db.execute('SELECT name FROM d1_migrations ORDER BY id')]
        for table in ['request_workflow_events','request_payment_accounts','request_payment_ledger','offline_sync_devices','offline_sync_receipts','handover_device_keys','request_handover_claims','bill_item_purchase_costs','location_settings','location_season_settings','location_settings_events']:
            if table in current['tables']:
                result.setdefault('newTableRows',{})[table] = len(current['tables'][table]['rowHashes'])
    result['status'] = 'PASS' if result['integrity'] == [['ok']] and not result['foreignKeys'] and result['backupUnchanged'] and result['establishedBaselineUnchanged'] and result['allExpectedSchemaObjectsPresent'] and all(v['missingOrModified'] == 0 for v in result['originalColumnPreservation'].values()) else 'FAIL'
    output('verification-' + mode + '.json', result)
    print(json.dumps({k:result[k] for k in ['status','schemaObjects','newTableRows','backupUnchanged','establishedBaselineUnchanged']}))
    assert result['status'] == 'PASS'
