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
assert str(target) != manifest['original'] and directory.name.startswith('p3-')
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
            output = directory / ('preservation-' + str(time.time_ns()) + '.json')
            with output.open('x') as out:
                json.dump(result, out, indent=2)
            print(json.dumps({'status': result['status'], 'rowsVerified': sum(t['before'] for t in tables.values()), 'tables': len(tables), 'output': str(output)}))
            assert result['status'] == 'PASS'
