"""Read-only verification of the existing disposable D1, never original storage."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sqlite3
import time


parser = argparse.ArgumentParser()
parser.add_argument('root')
args = parser.parse_args()
root = Path(args.root).resolve(strict=True)
manifest = json.loads((root / 'isolation.json').read_text())
directory = Path(json.loads((root / 'phase2-current.json').read_text())['directory']).resolve(strict=True)
target = Path(manifest['disposableDatabaseFile']).resolve(strict=True)
assert root in directory.parents and directory.name.startswith('p2-')
assert root / 'persist' in target.parents
baseline = directory / 'before.sqlite'
state = json.loads((directory / 'state.json').read_text())
tables = {}
with sqlite3.connect(baseline.as_uri() + '?mode=ro', uri=True) as before, sqlite3.connect(target.as_uri() + '?mode=ro', uri=True) as after:
    before.execute('BEGIN'); after.execute('BEGIN')
    schema_query = "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"
    original_schema = list(before.execute(schema_query))
    schema_equal = original_schema == list(after.execute(schema_query))
    names = [row[0] for row in before.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    for name in names:
        if name in ('_cf_METADATA', 'sqlite_sequence'):
            continue
        quoted = '"' + name.replace('"', '""') + '"'
        old_rows = Counter(before.execute('SELECT * FROM ' + quoted))
        new_rows = Counter(after.execute('SELECT * FROM ' + quoted))
        tables[name] = {'beforeRows': sum(old_rows.values()), 'afterRows': sum(new_rows.values()), 'missingOrChanged': sum((old_rows - new_rows).values())}
    migrations_equal = list(before.execute('SELECT * FROM d1_migrations ORDER BY id')) == list(after.execute('SELECT * FROM d1_migrations ORDER BY id'))
    integrity = list(after.execute('PRAGMA integrity_check'))
    foreign_keys = list(after.execute('PRAGMA foreign_key_check'))
    scope_rows = []
    for name, location in [('a', state['a']), ('b', state['b']), ('super', state['b']), ('admin', state['b'])]:
        request_id = state['requests'][name]['requestId']
        row = after.execute('SELECT location_id,season_id,creator_user_id,status,finalization_status FROM customer_requests WHERE id=?', (request_id,)).fetchone()
        assert row[0:2] == (location, state['season'])
        quotes = list(after.execute("SELECT location_id,season_id FROM quotations WHERE customer_request_id=? AND status!='void'", (request_id,)))
        assert quotes and all(quote == (location, state['season']) for quote in quotes)
        account = after.execute('SELECT business_id,location_id,season_id FROM request_payment_accounts WHERE request_id=?', (request_id,)).fetchone()
        if name != 'admin':
            assert account == (state['business'], location, state['season'])
            ledger = list(after.execute('SELECT business_id,location_id,season_id,actor_user_id FROM request_payment_ledger WHERE request_id=?', (request_id,)))
            assert len(ledger) == 1 and ledger[0][0:3] == account
        scope_rows.append({'fixture': name, 'requestId': request_id, 'locationId': row[0], 'seasonId': row[1], 'creatorUserId': row[2], 'status': row[3], 'paymentBusinessScope': list(account) if account else None})
result = {
    'status': 'PASS' if schema_equal and migrations_equal and all(row['missingOrChanged'] == 0 for row in tables.values()) and integrity == [('ok',)] and not foreign_keys else 'FAIL',
    'database': str(target), 'baseline': str(baseline), 'originalDatabasesAccessed': False,
    'schemaUnchanged': schema_equal, 'migrationsUnchanged': migrations_equal,
    'baselineSchemaSha256': hashlib.sha256(json.dumps(original_schema, sort_keys=True).encode()).hexdigest(),
    'integrity': integrity, 'foreignKeyViolations': len(foreign_keys), 'tables': tables,
    'transactionScopeChecks': scope_rows,
}
output = directory / ('preservation-' + str(time.time_ns()) + '.json')
with output.open('x', encoding='utf-8') as file:
    json.dump(result, file, indent=2)
print(json.dumps({'status': result['status'], 'schemaUnchanged': schema_equal, 'migrationsUnchanged': migrations_equal, 'tablesVerified': len(tables), 'baselineRowsVerified': sum(row['beforeRows'] for row in tables.values()), 'output': str(output)}))
assert result['status'] == 'PASS', 'Pre-existing disposable data or migration state changed'
