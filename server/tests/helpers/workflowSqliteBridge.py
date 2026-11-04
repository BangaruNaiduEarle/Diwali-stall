"""Disposable in-memory SQLite adapter for workflow migration/service tests only."""
import json
import sqlite3
import sys

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

db = sqlite3.connect(':memory:', isolation_level=None)
db.row_factory = sqlite3.Row
db.execute('PRAGMA foreign_keys=ON')

for line in sys.stdin:
    try:
        message = json.loads(line)
        if message['op'] == 'script':
            db.executescript(message['sql'])
            result = None
        else:
            statements = message.get('statements', [message])
            batch = message['op'] == 'batch'
            if batch:
                db.execute('BEGIN')
            result = []
            try:
                for statement in statements:
                    cursor = db.execute(statement['sql'], statement.get('values', []))
                    rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
                    changes = db.execute('SELECT changes()').fetchone()[0]
                    result.append({'results': rows, 'meta': {'changes': changes}})
                if batch:
                    db.execute('COMMIT')
            except Exception:
                if batch:
                    db.execute('ROLLBACK')
                raise
            if not batch:
                result = result[0]
        print(json.dumps({'result': result}), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)}), flush=True)
