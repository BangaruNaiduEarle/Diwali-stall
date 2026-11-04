import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Miniflare } from 'miniflare'

const sha = value => createHash('sha256').update(value).digest('hex')
const expected = '30541ce6067a9c3eac588d433f8f04f2fbc31fd00ff820d5c0d013c8c5f9f3b5'
const backup = join(process.env.TEMP, 'diwali-release-b38657123a324f3a9e7c02c159b82c79', 'backup',
  '5264016ce8a63a3f1f9239770b32628020abc7fe1141bfbdd036d824a8f8ea73.sqlite')

// Restore only the previously verified backup to memory. Applying the already
// qualified 0021–0027 files here initializes a fresh fixture; it is not another
// migration acceptance test. No 0020 SQL, existing persistence or config is used.
export async function verifiedDisposableRelease(t) {
  assert.equal(sha(readFileSync(backup)), expected, 'Exact authorized backup required')
  const names = ['0021_request_workflow_history.sql', '0022_request_payment_ledger.sql',
    '0023_offline_sync_receipts.sql', '0024_qr_handover.sql', '0025_bill_purchase_cost_snapshots.sql',
    '0026_stall_settings.sql', '0027_location_final_rate_access.sql']
  const migrations = names.map(name => ({ name, sql: readFileSync(new URL('../../database/migrations/' + name, import.meta.url), 'utf8') }))
  const installed = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python314', 'python.exe')
  const python = process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' && existsSync(installed) ? installed : 'python3')
  const code = `import json,sqlite3,sys,pathlib
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
p=json.load(sys.stdin);s=sqlite3.connect(pathlib.Path(p['backup']).as_uri()+'?mode=ro&immutable=1',uri=True)
s.execute('PRAGMA query_only=ON');d=sqlite3.connect(':memory:');s.backup(d);s.close()
assert d.execute("SELECT COUNT(*) FROM d1_migrations WHERE name='0020_business_location_foundation.sql'").fetchone()[0]==1
schema=[{'type':r[0],'sql':r[1]} for r in d.execute("SELECT type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(lower(name),1,4)!='_cf_' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name")]
tables=[]
for (name,) in d.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(lower(name),1,4)!='_cf_' ORDER BY name").fetchall():
 c=d.execute('SELECT * FROM "'+name+'"');tables.append({'name':name,'columns':[x[0] for x in c.description],'rows':c.fetchall()})
for m in p['migrations']:
 statements=[];pending=''
 for ch in m['sql']:
  pending+=ch
  if ch==';' and sqlite3.complete_statement(pending):statements.append(pending);pending=''
 assert not pending.strip()
 m['statements']=statements
print(json.dumps({'schema':schema,'tables':tables,'migrations':p['migrations']}))`
  const source = JSON.parse(execFileSync(python, ['-c', code], {
    input: JSON.stringify({ backup, migrations }), encoding: 'utf8', windowsHide: true, maxBuffer: 20e6,
  }))
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated")}}',
    compatibilityDate: '2025-04-01', host: '127.0.0.1', port: 0, d1Databases: ['DB'],
    d1Persist: false, cachePersist: false, kvPersist: false, r2Persist: false, durableObjectsPersist: false })
  t.after(async () => { await runtime.dispose(); assert.equal(sha(readFileSync(backup)), expected, 'Source remains unchanged') })
  const db = await runtime.getD1Database('DB')
  const query = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
  for (const item of source.schema.filter(item => item.type === 'table')) await db.prepare(item.sql).run()
  await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'), ...source.tables.flatMap(table => table.rows.map(row =>
    db.prepare(`INSERT INTO "${table.name}" (${table.columns.map(c => `"${c}"`).join(',')}) VALUES (${row.map(() => '?').join(',')})`).bind(...row)))])
  for (const item of source.schema.filter(item => item.type !== 'table')) await db.prepare(item.sql).run()
  for (const migration of source.migrations) await db.batch([...migration.statements.map(sql => db.prepare(sql)),
    db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(migration.name)])
  const baseline = []
  for (const { name } of await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(lower(name),1,4)!='_cf_' ORDER BY name")) {
    const columns = (await query(`PRAGMA table_info("${name}")`)).map(row => row.name)
    const rows = await query(`SELECT * FROM "${name}"`)
    baseline.push({ name, columns, rows })
  }
  const preserve = async () => {
    for (const table of baseline) {
      const current = await query(`SELECT ${table.columns.map(c => `"${c}"`).join(',')} FROM "${table.name}"`)
      const hashes = new Map()
      const key = row => sha(JSON.stringify(table.columns.map(column => row[column])))
      for (const row of current) hashes.set(key(row), (hashes.get(key(row)) ?? 0) + 1)
      for (const row of table.rows) {
        assert.ok(hashes.get(key(row)) > 0, `Retained row unchanged: ${table.name}`)
        hashes.set(key(row), hashes.get(key(row)) - 1)
      }
    }
    assert.deepEqual(await query('PRAGMA foreign_key_check'), [])
  }
  return { db, query, preserve, sourceSha256: expected,
    migrationHashes: Object.fromEntries(migrations.map(m => [m.name, sha(m.sql)])) }
}
