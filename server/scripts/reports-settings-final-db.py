"""Guarded pre-migrated disposable clone and preservation; never runs migrations."""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import time

ROOT = Path(r'C:\Users\naidu\AppData\Local\Temp\diwali-release-b38657123a324f3a9e7c02c159b82c79')
WORKSPACE = Path(r'C:\naidu\Diwali')
directory = Path(sys.argv[1]).resolve(strict=True)
assert directory.parent == ROOT.resolve(strict=True)
assert directory.name.startswith('reports-settings-final-')
manifest = json.loads((ROOT / 'isolation.json').read_text())
source_state = json.loads((ROOT / 'chain-687017a4/state.json').read_text())
source = Path(source_state['databaseFile']).resolve(strict=True)
assert ROOT / 'chain-687017a4/persist' in source.parents


def guarded(file):
    resolved = file.resolve(strict=True)
    assert ROOT in resolved.parents
    assert str(resolved).casefold() != manifest['original'].casefold()
    assert resolved.stat().st_nlink == 1, 'Hard-linked database/artifact'
    for item in [resolved, *resolved.parents]:
        assert not item.is_symlink() and not item.is_junction(), 'Linked ancestry'
    return resolved


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def snapshot(file):
    file = guarded(file)
    with sqlite3.connect(file.as_uri() + '?mode=ro', uri=True) as db:
        db.execute('BEGIN')
        schema = [list(row) for row in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name")]
        tables = {}
        for kind, name, _, _ in schema:
            if kind == 'table':
                tables[name] = sorted(json.dumps(list(row), ensure_ascii=True) for row in db.execute('SELECT * FROM "' + name.replace('"', '""') + '"'))
        return {'schema': schema, 'tables': tables,
                'integrity': [list(row) for row in db.execute('PRAGMA integrity_check')],
                'foreignKeys': [list(row) for row in db.execute('PRAGMA foreign_key_check')]}


def inventory():
    files = [ROOT / 'isolation.json']
    for name in ['chain-687017a4', 'settings-ui-ac7f6ffb', 'reports-backend-18da0f10', 'reports-ui-e25c1111']:
        fixture = ROOT / name
        state = json.loads((fixture / 'state.json').read_text())
        files += [guarded(Path(state['databaseFile']))]
        files += [f for f in fixture.iterdir() if f.is_file() and f.suffix in ['.json', '.toml']]
        # Private profiles are inspected/hashed, never launched or cleared.
        for profile in fixture.glob('browser-*'):
            if profile.is_dir():
                files += [f for f in profile.rglob('*') if f.is_file()]
    files += list((WORKSPACE / 'docs').rglob('*.md'))
    files += list((WORKSPACE / 'src').rglob('*.js')) + list((WORKSPACE / 'src').rglob('*.jsx'))
    files += list((WORKSPACE / 'server/src').rglob('*.js'))
    files += list((WORKSPACE / 'server/database/migrations').glob('*.sql'))
    files += [WORKSPACE / f for f in ['package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json', 'server/wrangler.toml', 'vite.config.js']]
    return {str(f): digest(f) for f in files}


state = json.loads((directory / 'state.json').read_text())
target = guarded(Path(state['databaseFile']))
assert directory / 'persist' in target.parents and target != source
assert state['databaseId'] != source_state['databaseId']

if sys.argv[2] == 'clone':
    assert not (directory / 'source-before.json').exists()
    before = snapshot(source)
    assert len(before['tables']) == 35
    assert 'location_settings_events' in before['tables']
    with sqlite3.connect(target) as destination:
        assert not list(destination.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"))
        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as origin:
            origin.backup(destination)
    assert snapshot(target) == before
    (directory / 'source-before.json').write_text(json.dumps(before))
    (directory / 'preserved-files-before.json').write_text(json.dumps(inventory(), indent=2))
    safety = {'status': 'PASS', 'sourceDatabase': str(source), 'databaseFile': str(target),
              'binding': 'DB', 'databaseId': state['databaseId'], 'sourceDatabaseId': source_state['databaseId'],
              'originalPathComparedAsTextOnly': True, 'noLinkedAncestryOrHardlinks': True,
              'sourceReadOnly': True, 'cloneExact': True, 'migrationsApplied': False,
              'tables': len(before['tables']), 'schemaObjects': len(before['schema']),
              'sourceSha256': digest(source)}
    (directory / 'safety.json').write_text(json.dumps(safety, indent=2))
    print(json.dumps(safety))
else:
    before = json.loads((directory / 'source-before.json').read_text())
    current = snapshot(target)
    authentication = {'admin_users', 'admin_sessions', 'admin_login_attempts'}
    # Every original row must survive byte-for-byte; new fixture rows are allowed.
    retained = {name: set(rows).issubset(set(current['tables'][name])) for name, rows in before['tables'].items() if name not in authentication}
    original_files = json.loads((directory / 'preserved-files-before.json').read_text())
    changed = [file for file, sha in original_files.items() if digest(Path(file)) != sha]
    result = {'sourceUnchanged': snapshot(source) == before,
              'schemaUnchanged': current['schema'] == before['schema'],
              'migrationHistoryUnchanged': current['tables']['d1_migrations'] == before['tables']['d1_migrations'],
              'preexistingRowsPreserved': retained,
              'integrity': current['integrity'], 'foreignKeys': current['foreignKeys'],
              'preservedFileCount': len(original_files), 'changedPreservedFiles': changed,
              'authenticationBookkeepingExemptOnlyInNewCopy': True}
    result['status'] = 'PASS' if result['sourceUnchanged'] and result['schemaUnchanged'] and result['migrationHistoryUnchanged'] and all(retained.values()) and current['integrity'] == [['ok']] and not current['foreignKeys'] and not changed else 'FAIL'
    previous = directory / 'preservation.json'
    if previous.exists():
        (directory / ('preservation-attempt-' + str(time.time_ns()) + '.json')).write_bytes(previous.read_bytes())
    previous.write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
    assert result['status'] == 'PASS'
