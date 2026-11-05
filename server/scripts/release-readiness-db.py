"""Clone/inspect only the database named by a verified disposable isolation manifest."""
import argparse
from collections import Counter
import hashlib
import json
import re
import runpy
import sqlite3
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('root')
    parser.add_argument('action', choices=['clone', 'inspect'])
    args = parser.parse_args()
    root = Path(args.root).resolve(strict=True)
    isolation_path = root / 'isolation.json'
    isolation = json.loads(isolation_path.read_text())
    persist = Path(isolation['persist']).resolve(strict=True)
    if root not in persist.parents or not root.name.startswith('diwali-release-'):
        raise RuntimeError('Unsafe disposable persistence path')
    candidates = [path.resolve() for path in persist.rglob('*.sqlite') if path.name != 'metadata.sqlite']
    if len(candidates) != 1 or persist not in candidates[0].parents or str(candidates[0]) == isolation['original']:
        raise RuntimeError('Disposable target must be one distinct database')
    target = candidates[0]
    helpers = runpy.run_path(str(Path(__file__).with_name('release-readiness-backup.py')))
    snapshot = helpers['logical_snapshot']
    if args.action == 'clone':
        verified = json.loads((root / 'backup-verification.json').read_text())
        entry = next(item for item in verified['databases'] if item['backup'] == isolation['verifiedBackup'])
        backup_path = Path(entry['backup']).resolve(strict=True)
        if hashlib.sha256(backup_path.read_bytes()).hexdigest() != entry['backupSha256']:
            raise RuntimeError('Verified backup bytes changed')
        with sqlite3.connect(target) as dest:
            inventory = [row[0] for row in dest.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            if any(name not in ('_cf_METADATA', 'sqlite_sequence') for name in inventory):
                raise RuntimeError('Refusing to overwrite non-empty disposable database')
            with sqlite3.connect(backup_path.as_uri() + '?mode=ro', uri=True) as source:
                source.backup(dest)
            assert snapshot(dest) == entry['snapshot']
            assert dest.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
        isolation['disposableDatabaseFile'] = str(target)
        isolation_path.write_text(json.dumps(isolation, indent=2))
        print(json.dumps({'isolated': True, 'target': str(target), 'baseMatchesVerifiedBackup': True}))
        return
    with sqlite3.connect(target.as_uri() + '?mode=ro', uri=True) as db:
        objects = list(db.execute("SELECT type,name,sql FROM sqlite_master ORDER BY type,name"))
        expected = []
        for file in sorted((root / 'migrations').glob('*.sql')):
            expected.extend(re.findall(r'CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\s+(\w+)', file.read_text(encoding='utf-8'), re.I))
        names = {(kind.lower(), name) for kind, name, _sql in objects}
        missing = [(kind, name) for kind, name in expected if (kind.lower(), name) not in names]
        migration_records = list(db.execute('SELECT name,applied_at FROM d1_migrations ORDER BY id'))
        fk = list(db.execute('PRAGMA foreign_key_check'))
        integrity = list(db.execute('PRAGMA integrity_check'))
        historical_rows = {}
        backup_path = Path(isolation['verifiedBackup']).resolve(strict=True)
        with sqlite3.connect(backup_path.as_uri() + '?mode=ro', uri=True) as baseline:
            tables = [row[0] for row in baseline.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            for table in tables:
                if table in ('_cf_METADATA', 'sqlite_sequence'):
                    continue
                columns = [row[1] for row in baseline.execute(f'PRAGMA table_info("{table}")')]
                projection = ','.join('"' + column.replace('"', '""') + '"' for column in columns)
                query = f'SELECT {projection} FROM "{table}"'
                before = Counter(baseline.execute(query).fetchall())
                after = Counter(db.execute(query).fetchall())
                historical_rows[table] = {'originalRows': sum(before.values()), 'missingOrChanged': sum((before - after).values())}
        (root / 'historical-preservation.json').write_text(json.dumps(historical_rows, indent=2))
        assert all(row['missingOrChanged'] == 0 for row in historical_rows.values()), historical_rows
        result = {'database': str(target), 'integrity': integrity, 'foreignKeyViolations': len(fk), 'expectedObjects': len(expected), 'missingObjects': missing, 'objects': [{'type': kind, 'name': name} for kind, name, _sql in objects], 'migrations': migration_records, 'counts': {name: count['count'] for name, count in snapshot(db)['tables'].items()}}
        (root / 'migration-verification.json').write_text(json.dumps(result, indent=2))
        print(json.dumps({key: result[key] for key in ['database', 'integrity', 'foreignKeyViolations', 'expectedObjects', 'missingObjects', 'migrations', 'counts']}, indent=2))
        assert not missing and not fk and integrity == [('ok',)]
        assert all(name in [row[0] for row in migration_records] for name in isolation['migrations'])


if __name__ == '__main__':
    main()
