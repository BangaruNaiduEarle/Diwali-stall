"""Read-only inspection of manifest-verified disposable D1; no original DB access."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

root, directory = (Path(p).resolve(strict=True) for p in sys.argv[1:3])
assert root in directory.parents and directory.name.startswith('p25-')
manifest = json.loads((root / 'isolation.json').read_text())
source = Path(manifest['disposableDatabaseFile']).resolve(strict=True)
assert root / 'persist' in source.parents and str(source) != manifest['original']

def inspect(file):
    with sqlite3.connect(file.as_uri() + '?mode=ro', uri=True) as db:
        db.execute('BEGIN')
        schema = list(db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name"))
        tables = {}
        for typ, name, _, _ in schema:
            if typ != 'table':
                continue
            quoted = '"' + name.replace('"', '""') + '"'
            rows = sorted(json.dumps(list(row), ensure_ascii=True) for row in db.execute('SELECT * FROM ' + quoted))
            tables[name] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(rows).encode()).hexdigest()}
        return db, [list(row) for row in schema], tables

def snapshot(file):
    _, schema, tables = inspect(file)
    return {'schema': schema, 'tables': tables}

mode = sys.argv[3]
if mode == 'export':
    assert not (directory / 'schema-export.json').exists()
    result = snapshot(source)
    assert not any(row[1] == 'bill_item_purchase_costs' for row in result['schema'])
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as db:
        migrations = list(db.execute('SELECT id,name,applied_at FROM d1_migrations ORDER BY id'))
    (directory / 'schema-export.json').write_text(json.dumps({'schema': result['schema'], 'migrations': migrations}, indent=2))
    (directory / 'established-baseline-before.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({'schemaObjects': len(result['schema']), 'migrationRecords': len(migrations), 'businessDataCopied': False}))
elif mode in ('freeze', 'verify-migration', 'verify-final'):
    state = json.loads((directory / 'state.json').read_text())
    target = Path(state['databaseFile']).resolve(strict=True)
    assert directory / 'persist' in target.parents and target != source
    result = snapshot(target)
    with sqlite3.connect(target.as_uri() + '?mode=ro', uri=True) as db:
        result['integrity'] = list(db.execute('PRAGMA integrity_check'))
        result['foreignKeys'] = list(db.execute('PRAGMA foreign_key_check'))
    if mode == 'freeze':
        assert not (directory / 'pre-migration.json').exists()
        (directory / 'pre-migration.json').write_text(json.dumps(result, indent=2))
    else:
        before = json.loads((directory / 'pre-migration.json').read_text())
        result['oldTablesUnchanged'] = all(result['tables'].get(name) == values for name, values in before['tables'].items() if name != 'd1_migrations') if mode == 'verify-migration' else None
        if mode == 'verify-migration':
            assert result['oldTablesUnchanged']
            result['oldSchemaUnchanged'] = all(row in result['schema'] for row in before['schema'])
            assert result['oldSchemaUnchanged']
        established_before = json.loads((directory / 'established-baseline-before.json').read_text())
        established_now = snapshot(source)
        result['establishedBaselineUnchanged'] = established_before == established_now
        assert result['establishedBaselineUnchanged']
        assert result['integrity'] == [('ok',)] and result['foreignKeys'] == []
        (directory / (mode + '.json')).write_text(json.dumps(result, indent=2))
    print(json.dumps({'mode': mode, 'tables': len(result['tables']), 'rows': sum(t['rows'] for t in result['tables'].values()), 'integrity': result['integrity'], 'foreignKeyViolations': len(result['foreignKeys']), 'oldTablesUnchanged': result.get('oldTablesUnchanged'), 'establishedBaselineUnchanged': result.get('establishedBaselineUnchanged')}))
else:
    raise ValueError('Unknown inspection mode')
