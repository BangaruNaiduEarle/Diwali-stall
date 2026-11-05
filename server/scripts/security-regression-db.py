"""Exact read-only preservation check of the established disposable D1 only."""
import json
import sqlite3
import sys
import time
from pathlib import Path
from collections import Counter

root,directory=(Path(value).resolve(strict=True) for value in sys.argv[1:3])
manifest=json.loads((root/'isolation.json').read_text())
target=Path(manifest['disposableDatabaseFile']).resolve(strict=True)
assert root/'persist' in target.parents and root in directory.parents
assert directory.name.startswith('p7-') and str(target)!=manifest['original']
baseline=directory/'before.sqlite'
with sqlite3.connect(target.as_uri()+'?mode=ro',uri=True) as current:
    if sys.argv[3]=='snapshot':
        assert not baseline.exists()
        with sqlite3.connect(baseline) as out:
            current.backup(out)
        print(json.dumps({'snapshot':str(baseline)}))
    else:
        current.execute('BEGIN')
        with sqlite3.connect(baseline.as_uri()+'?mode=ro',uri=True) as before:
            tables={}
            for (name,) in before.execute("SELECT name FROM sqlite_master WHERE type='table'"):
                quoted='"'+name.replace('"','""')+'"'
                old=Counter(before.execute('SELECT * FROM '+quoted))
                new=Counter(current.execute('SELECT * FROM '+quoted))
                tables[name]={'beforeRows':sum(old.values()),'afterRows':sum(new.values()),'missingOrChanged':sum((old-new).values()),'added':sum((new-old).values())}
            schema='SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name'
            result={'database':str(target),'tables':tables,'schemaUnchanged':list(before.execute(schema))==list(current.execute(schema)),
                    'migrationsUnchanged':list(before.execute('SELECT * FROM d1_migrations'))==list(current.execute('SELECT * FROM d1_migrations')),
                    'integrity':list(current.execute('PRAGMA integrity_check')),'foreignKeys':list(current.execute('PRAGMA foreign_key_check')),
                    'originalDatabasesOpened':False}
            result['status']='PASS' if result['schemaUnchanged'] and result['migrationsUnchanged'] and result['integrity']==[('ok',)] and not result['foreignKeys'] and all(not t['added'] and not t['missingOrChanged'] for t in tables.values()) else 'FAIL'
            output=directory/('preservation-'+str(time.time_ns())+'.json')
            with output.open('x') as out:
                json.dump(result,out,indent=2)
            print(json.dumps({'status':result['status'],'tables':len(tables),'rows':sum(t['beforeRows'] for t in tables.values()),'businessTables':len([n for n in tables if n not in ('sqlite_sequence','_cf_METADATA')]),'businessRows':sum(t['beforeRows'] for n,t in tables.items() if n not in ('sqlite_sequence','_cf_METADATA')),'output':str(output)}))
            assert result['status']=='PASS'
