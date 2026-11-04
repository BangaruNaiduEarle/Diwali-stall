import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Miniflare } from 'miniflare'

const backup = join(process.env.TEMP, 'diwali-release-b38657123a324f3a9e7c02c159b82c79',
  'backup', '5264016ce8a63a3f1f9239770b32628020abc7fe1141bfbdd036d824a8f8ea73.sqlite')
const expectedHash = '30541ce6067a9c3eac588d433f8f04f2fbc31fd00ff820d5c0d013c8c5f9f3b5'
const sha = value => createHash('sha256').update(value).digest('hex')
const fields = {
  assigned_to_user_id: ['assignedToUserId', 'review-to-1', 'review-to-2'],
  assigned_to_name: ['assignedToName', 'Review To One', 'Review To Two'],
  assigned_to_role: ['assignedToRole', 'owner', 'super_admin'],
  assigned_to_email: ['assignedToEmail', 'one@example.test', 'two@example.test'],
  assigned_by_user_id: ['assignedByUserId', 'review-by-1', 'review-by-2'],
  assigned_by_name: ['assignedByName', 'Review By One', 'Review By Two'],
  assigned_by_role: ['assignedByRole', 'owner', 'super_admin'],
  assigned_at: ['assignedAt', '2026-11-04T10:00:00Z', '2026-11-04T11:00:00Z'],
}

// Open only the exact retained backup, immutable/read-only. Restore to :memory:
// before exporting rows privately through stdout to this test process. Nothing
// prints source rows or credentials; no file-backed destination is created.
const exportMemory = `import json,sqlite3,sys,pathlib
p=json.load(sys.stdin)
source=sqlite3.connect(pathlib.Path(p['backup']).as_uri()+'?mode=ro&immutable=1',uri=True)
source.execute('PRAGMA query_only=ON')
d=sqlite3.connect(':memory:');source.backup(d);source.close()
assert d.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert not d.execute('PRAGMA foreign_key_check').fetchall()
history=[r[0] for r in d.execute('SELECT name FROM d1_migrations ORDER BY id')]
assert len(history)==21 and history[-1]=='0020_business_location_foundation.sql'
schema=[r[0] for r in d.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name")]
tables=[]
for (name,) in d.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").fetchall():
 q='"'+name.replace('"','""')+'"'
 cursor=d.execute('SELECT * FROM '+q)
 tables.append({'name':name,'columns':[c[0] for c in cursor.description],'rows':cursor.fetchall()})
migrations=[]
for m in p['migrations']:
 statements=[];pending=''
 for ch in m['sql']:
  pending+=ch
  if ch==';' and sqlite3.complete_statement(pending):statements.append(pending);pending=''
 assert not pending.strip(), 'Unterminated migration SQL'
 migrations.append({'name':m['name'],'statements':statements})
print(json.dumps({'schema':schema,'tables':tables,'history':history,'migrations':migrations}))
`

test('restored 0020 backup accepts updated 0021 and later migrations in native memory-only D1', async t => {
  assert.ok(existsSync(backup), 'Approved retained 0020 backup must be available; never substitute an original D1')
  assert.equal(sha(readFileSync(backup)), expectedHash, 'Retained backup identity')
  const names = ['0021_request_workflow_history.sql', '0022_request_payment_ledger.sql',
    '0023_offline_sync_receipts.sql', '0024_qr_handover.sql', '0025_bill_purchase_cost_snapshots.sql',
    '0026_stall_settings.sql', '0027_location_final_rate_access.sql']
  const migrations = names.map(name => ({ name, sql: readFileSync(new URL('../database/migrations/' + name, import.meta.url), 'utf8') }))
  const installed = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python314', 'python.exe')
  const python = process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' && existsSync(installed) ? installed : 'python3')
  const source = JSON.parse(execFileSync(python, ['-c', exportMemory], {
    input: JSON.stringify({ backup, migrations }), encoding: 'utf8', windowsHide: true, maxBuffer: 12e6,
  }))
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated")}}',
    compatibilityDate: '2025-04-01', host: '127.0.0.1', port: 0, d1Databases: ['DB'],
    d1Persist: false, cachePersist: false, kvPersist: false, r2Persist: false, durableObjectsPersist: false })
  try {
    const db = await runtime.getD1Database('DB')
    // Load tables, then all retained rows in one deferred-FK batch, then original
    // triggers/indexes. Historical imports must not manufacture workflow events.
    const tables = source.schema.filter(sql => /^CREATE TABLE/i.test(sql))
    for (const sql of tables) await db.prepare(sql).run()
    await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'), ...source.tables.flatMap(table =>
      table.rows.map(row => db.prepare(`INSERT INTO "${table.name}" (${table.columns.map(c => `"${c}"`).join(',')}) VALUES (${row.map(() => '?').join(',')})`).bind(...row)))])
    for (const sql of source.schema.filter(sql => !/^CREATE TABLE/i.test(sql))) await db.prepare(sql).run()
    const query = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
    const fingerprint = rows => sha(JSON.stringify(rows.map(row => JSON.stringify(row)).sort()))
    const originals = new Map()
    for (const table of source.tables) originals.set(table.name, fingerprint(table.rows))
    const checkOriginals = async () => {
      for (const table of source.tables) {
        const rows = await query(`SELECT ${table.columns.map(c => `"${c}"`).join(',')} FROM "${table.name}"${table.name === 'customer_requests' ? " WHERE id!='review-assignment'" : table.name === 'd1_migrations' ? ' WHERE id<=?' : ''}`,
          ...(table.name === 'd1_migrations' ? [21] : []))
        assert.equal(fingerprint(rows.map(row => table.columns.map(column => row[column]))), originals.get(table.name), `Original columns preserved: ${table.name}`)
      }
    }
    await checkOriginals()
    const apply = async migration => db.batch([...migration.statements.map(sql => db.prepare(sql)),
      db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(migration.name)])
    await t.test('actual restored post-0020 schema/data accepts 0021 without fabricated history', async () => {
      await apply(source.migrations[0])
      assert.equal((await query('SELECT COUNT(*) AS n FROM request_workflow_events'))[0].n, 0)
      assert.equal((await query('SELECT COUNT(*) AS n FROM customer_requests WHERE revision!=0 OR creator_user_id IS NOT NULL'))[0].n, 0)
      await checkOriginals()
    })
    const exercise = async () => {
      const row = async () => (await query("SELECT * FROM customer_requests WHERE id='review-assignment'"))[0]
      for (const [column, [key, first, second]] of Object.entries(fields)) {
        for (const value of [first, second, null]) {
          const before = await row()
          await db.prepare(`UPDATE customer_requests SET ${column}=? WHERE id='review-assignment'`).bind(value).run()
          const after = await row()
          const events = await query("SELECT * FROM request_workflow_events WHERE request_id='review-assignment' AND revision>?", before.revision)
          assert.equal(events.length, 1, `${column}: one event`)
          assert.equal(after.revision, before.revision + 1)
          assert.equal(events[0].event_type, 'request_assigned')
          const changes = JSON.parse(events[0].metadata_json)
          for (const [field, [metadataKey]] of Object.entries(fields)) {
            assert.equal(changes.before[metadataKey], before[field])
            assert.equal(changes.after[metadataKey], after[field])
          }
          assert.equal(changes.after[key], value)
          assert.equal(changes.before.status, before.status)
          assert.equal(changes.after.status, before.status)
          assert.equal(events[0].revision, after.revision)
        }
      }
      const before = await row()
      await db.prepare("UPDATE customer_requests SET customer_note='Unrelated note',updated_at='2026-11-04' WHERE id='review-assignment'").run()
      for (const column of ['status', 'finalization_status', ...Object.keys(fields)]) {
        await db.prepare(`UPDATE customer_requests SET ${column}=${column} WHERE id='review-assignment'`).run()
      }
      assert.equal((await row()).revision, before.revision)
      assert.equal((await query("SELECT COUNT(*) AS n FROM request_workflow_events WHERE request_id='review-assignment' AND revision>?", before.revision))[0].n, 0)
    }
    await t.test('all eight assignment fields and no-op/unrelated updates work on native 0020→0021', async () => {
      await db.prepare(`INSERT INTO customer_requests(id,source,status,finalization_status,season_id,location_id)
        VALUES('review-assignment','manual','received','pending','season-2026','location-diwali-2026')`).run()
      await exercise()
    })
    await t.test('0022–0027 apply unchanged and preserve the updated workflow trigger and historical columns', async () => {
      for (const migration of source.migrations.slice(1)) await apply(migration)
      assert.deepEqual((await query('SELECT name FROM d1_migrations ORDER BY id')).map(row => row.name), [...source.history, ...names])
      await checkOriginals()
      await exercise()
      assert.deepEqual(await query('PRAGMA foreign_key_check'), [])
      assert.equal((await query('SELECT sql FROM sqlite_master WHERE name=?', 'request_changed_history'))[0].sql.includes('assigned_by_name'), true)
    })
  } finally {
    await runtime.dispose()
    assert.equal(sha(readFileSync(backup)), expectedHash, 'Source backup remains unchanged')
  }
})
