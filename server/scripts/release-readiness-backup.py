"""Read-only snapshots of existing local D1 files; never opens a source for writes."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def logical_snapshot(db):
    tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    result = {}
    for table in tables:
        quoted = '"' + table.replace('"', '""') + '"'
        rows = [json.dumps(row, ensure_ascii=False, default=lambda value: {'blob': value.hex()}, separators=(',', ':')) for row in db.execute('SELECT * FROM ' + quoted)]
        result[table] = {'count': len(rows), 'sha256': hashlib.sha256('\n'.join(sorted(rows)).encode()).hexdigest()}
    schema = list(db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name'))
    return {'tables': result, 'schemaSha256': hashlib.sha256(json.dumps(schema, ensure_ascii=False).encode()).hexdigest()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--run-root', required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    source = Path(args.source).resolve(strict=True)
    root = Path(args.run_root).resolve(strict=True)
    if source == root or source in root.parents or root in source.parents:
        raise RuntimeError('Backup/rehearsal paths must be separate from original persistence.')
    manifest_path = root / 'backup-verification.json'
    if args.verify:
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        comparisons = []
        for entry in manifest['databases']:
            path = Path(entry['source'])
            with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
                db.execute('BEGIN')
                current = logical_snapshot(db)
            comparisons.append({'source': str(path), 'logicalUnchanged': current == entry['snapshot'], 'mainUnchanged': file_hash(path) == entry['sourceMainSha256'], 'walUnchanged': file_hash(Path(str(path) + '-wal')) == entry['sourceWalSha256']})
        (root / 'original-preservation-final.json').write_text(json.dumps(comparisons, indent=2), encoding='utf-8')
        print(json.dumps(comparisons, indent=2))
        if not all(row['logicalUnchanged'] and row['mainUnchanged'] and row['walUnchanged'] for row in comparisons):
            raise RuntimeError('Original persistence changed; investigate external writers before claiming preservation.')
        return
    if manifest_path.exists():
        raise RuntimeError('Refusing to replace an earlier backup manifest.')
    backup_dir = root / 'backup'
    backup_dir.mkdir(exist_ok=False)
    entries = []
    for path in sorted(source.glob('*.sqlite')):
        main_before, wal_before = file_hash(path), file_hash(Path(str(path) + '-wal'))
        target = backup_dir / path.name
        with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
            db.execute('BEGIN')
            original = logical_snapshot(db)
            with sqlite3.connect(target) as backup:
                db.backup(backup)
                backup.execute('PRAGMA journal_mode=DELETE')
                integrity = backup.execute('PRAGMA integrity_check').fetchall()
                foreign = backup.execute('PRAGMA foreign_key_check').fetchall()
                copied = logical_snapshot(backup)
                migrations = [row[0] for row in backup.execute('SELECT name FROM d1_migrations ORDER BY id')] if 'd1_migrations' in copied['tables'] else []
        if original != copied or integrity != [('ok',)] or main_before != file_hash(path) or wal_before != file_hash(Path(str(path) + '-wal')):
            diagnostic = {'file':path.name,'logicalMatch':original==copied,'integrity':integrity,'mainMatch':main_before==file_hash(path),'walMatch':wal_before==file_hash(Path(str(path)+'-wal')),'differingTables':[name for name in original['tables'] if original['tables'][name]!=copied['tables'].get(name)],'schemaMatch':original['schemaSha256']==copied['schemaSha256']}
            (root/'backup-failure.json').write_text(json.dumps(diagnostic,indent=2),encoding='utf-8')
            raise RuntimeError('Backup verification failed: '+json.dumps(diagnostic))
        entries.append({'source': str(path), 'backup': str(target), 'sourceMainSha256': main_before, 'sourceWalSha256': wal_before, 'backupSha256': file_hash(target), 'integrity': 'ok', 'foreignKeyViolations': len(foreign), 'migrations': migrations, 'snapshot': copied})
    manifest_path.write_text(json.dumps({'sourceReadOnly': True, 'databases': entries}, indent=2), encoding='utf-8')
    print(json.dumps([{'file': Path(entry['source']).name, 'backup': entry['backup'], 'integrity': entry['integrity'], 'foreignKeyViolations': entry['foreignKeyViolations'], 'tables': {name: value['count'] for name, value in entry['snapshot']['tables'].items()}, 'migrations': entry['migrations']} for entry in entries], indent=2))


if __name__ == '__main__':
    main()
