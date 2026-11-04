import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Miniflare } from 'miniflare'
import { hashPassword } from '../src/lib/passwordHash.js'
import { loginWithPassword, resolveSessionIdentity } from '../src/services/adminPasswordAuth.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { listLocationAdminUsers } from '../src/services/adminLocationMembers.js'
import { listAdminCustomerRequests, getAdminCustomerRequestById } from '../src/services/adminCustomerRequests.js'

const sha = value => createHash('sha256').update(value).digest('hex')
const expected = '30541ce6067a9c3eac588d433f8f04f2fbc31fd00ff820d5c0d013c8c5f9f3b5'
const backup = join(process.env.TEMP, 'diwali-release-b38657123a324f3a9e7c02c159b82c79', 'backup',
  '5264016ce8a63a3f1f9239770b32628020abc7fe1141bfbdd036d824a8f8ea73.sqlite')
const installed = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python314', 'python.exe')
const python = process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' && existsSync(installed) ? installed : 'python3')
const restore = `import json,sqlite3,sys,pathlib
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
p=json.load(sys.stdin);s=sqlite3.connect(pathlib.Path(p['backup']).as_uri()+'?mode=ro&immutable=1',uri=True)
s.execute('PRAGMA query_only=ON');d=sqlite3.connect(':memory:');s.backup(d);s.close()
assert d.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert not d.execute('PRAGMA foreign_key_check').fetchall()
history=[r[0] for r in d.execute('SELECT name FROM d1_migrations ORDER BY id')]
assert len(history)==21 and history[-1]=='0020_business_location_foundation.sql'
schema=[{'type':r[0],'sql':r[1]} for r in d.execute("SELECT type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(lower(name),1,4)!='_cf_' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name")]
tables=[]
for (name,) in d.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(lower(name),1,4)!='_cf_' ORDER BY name").fetchall():
 c=d.execute('SELECT * FROM "'+name+'"');tables.append({'name':name,'columns':[x[0] for x in c.description],'rows':c.fetchall()})
migrations=[]
for m in p['migrations']:
 statements=[];pending=''
 for ch in m['sql']:
  pending+=ch
  if ch==';' and sqlite3.complete_statement(pending):statements.append(pending);pending=''
 assert not pending.strip()
 migrations.append({'name':m['name'],'statements':statements})
print(json.dumps({'schema':schema,'tables':tables,'history':history,'migrations':migrations}))`
const integrity = `import json,sqlite3,sys
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
p=json.load(sys.stdin);d=sqlite3.connect(':memory:');d.execute('PRAGMA foreign_keys=ON')
for item in p['schema']:
 if item['type']=='table':d.execute(item['sql'])
d.execute('BEGIN');d.execute('PRAGMA defer_foreign_keys=ON')
for table in p['tables']:
 for row in table['rows']:d.execute('INSERT INTO "'+table['name']+'" ('+','.join('"'+c+'"' for c in table['columns'])+') VALUES ('+','.join('?' for c in table['columns'])+')',row)
d.commit()
for item in p['schema']:
 if item['type']!='table':d.execute(item['sql'])
assert d.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
assert not d.execute('PRAGMA foreign_key_check').fetchall()
print(json.dumps({'integrity':'ok','foreignKeyViolations':0}))`
const runPython = (code, data) => JSON.parse(execFileSync(python, ['-c', code], {
  input: JSON.stringify(data), encoding: 'utf8', windowsHide: true, maxBuffer: 20e6,
}))

test('final 0020-backup→0027 rehearsal preserves data and five memberships per stall', async t => {
  assert.ok(existsSync(backup), 'Exact approved backup required; no substitution')
  assert.equal(sha(readFileSync(backup)), expected)
  const names = ['0021_request_workflow_history.sql', '0022_request_payment_ledger.sql',
    '0023_offline_sync_receipts.sql', '0024_qr_handover.sql', '0025_bill_purchase_cost_snapshots.sql',
    '0026_stall_settings.sql', '0027_location_final_rate_access.sql']
  const migrations = names.map(name => ({ name, sql: readFileSync(new URL('../database/migrations/' + name, import.meta.url), 'utf8') }))
  const source = runPython(restore, { backup, migrations })
  const evidence = { runId: randomUUID(), compatibilityDate: '2025-04-01', sourceSha256: expected,
    sourceMigrationCount: source.history.length, sourceEndsAt: source.history.at(-1),
    migrationSha256: Object.fromEntries(migrations.map(m => [m.name, sha(m.sql)])), checks: [] }
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated")}}',
    compatibilityDate: evidence.compatibilityDate, host: '127.0.0.1', port: 0, d1Databases: ['DB'],
    d1Persist: false, cachePersist: false, kvPersist: false, r2Persist: false, durableObjectsPersist: false })
  const check = async (name, fn) => t.test(name, async () => { await fn(); evidence.checks.push({ name, status: 'PASS' }) })
  try {
    const db = await runtime.getD1Database('DB')
    const query = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
    for (const item of source.schema.filter(item => item.type === 'table')) await db.prepare(item.sql).run()
    await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'), ...source.tables.flatMap(table => table.rows.map(row =>
      db.prepare(`INSERT INTO "${table.name}" (${table.columns.map(c => `"${c}"`).join(',')}) VALUES (${row.map(() => '?').join(',')})`).bind(...row)))])
    for (const item of source.schema.filter(item => item.type !== 'table')) await db.prepare(item.sql).run()
    const extras = new Map()
    const add = (table, count = 1) => extras.set(table, (extras.get(table) ?? 0) + count)
    const canonical = rows => rows.map(row => JSON.stringify(row)).sort()
    const preserve = async () => {
      for (const table of source.tables) {
        const current = (await query(`SELECT ${table.columns.map(c => `"${c}"`).join(',')} FROM "${table.name}"`)).map(row => table.columns.map(c => row[c]))
        const remaining = new Map()
        for (const row of canonical(current)) remaining.set(row, (remaining.get(row) ?? 0) + 1)
        for (const row of canonical(table.rows)) {
          assert.ok(remaining.get(row) > 0, `Every original row/column retained: ${table.name}`)
          remaining.set(row, remaining.get(row) - 1)
        }
        assert.equal([...remaining.values()].reduce((a, b) => a + b, 0), extras.get(table.name) ?? 0,
          `Only accounted disposable additions: ${table.name}`)
      }
    }
    await check('source restored exactly; 0020 recorded and excluded from replay', async () => {
      await preserve()
      assert.deepEqual((await query('SELECT name FROM d1_migrations ORDER BY id')).map(r => r.name), source.history)
      const applied = new Set(source.history)
      assert.ok(applied.has('0020_business_location_foundation.sql'))
      assert.deepEqual(source.migrations.filter(m => !applied.has(m.name)).map(m => m.name), names)
      assert.ok(!source.migrations.some(m => m.name.startsWith('0020_')))
      evidence.skippedMigration = '0020_business_location_foundation.sql'
    })
    await check('0021–0027 commit sequentially with preserved original rows and clean foreign keys', async () => {
      evidence.appliedMigrations = []
      for (const migration of source.migrations) {
        assert.equal((await query('SELECT COUNT(*) AS n FROM d1_migrations WHERE name=?', migration.name))[0].n, 0)
        await db.batch([...migration.statements.map(sql => db.prepare(sql)), db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(migration.name)])
        add('d1_migrations')
        evidence.appliedMigrations.push(migration.name)
        await preserve()
        assert.deepEqual(await query('PRAGMA foreign_key_check'), [])
        assert.equal((await query('SELECT COUNT(*) AS n FROM request_workflow_events'))[0].n, 0)
      }
      assert.deepEqual((await query('SELECT name FROM d1_migrations ORDER BY id')).map(r => r.name), [...source.history, ...names])
      assert.equal((await query("SELECT COUNT(*) AS n FROM sqlite_master WHERE substr(name,1,6)='_0020_'"))[0].n, 0)
      evidence.finalMigrationCount = 28
    })
    const stalls = (await query("SELECT location_id FROM location_seasons WHERE season_id='season-2026' AND status='active' ORDER BY location_id")).map(row => row.location_id)
    assert.equal(stalls.length, 2)
    const synthetic = [], password = 'Disposable-final-rehearsal-only-2026', passwordHash = await hashPassword(password)
    await check('both retained stalls support five active memberships without altering original memberships', async () => {
      evidence.memberships = []
      for (const [index, stall] of stalls.entries()) {
        const current = (await query("SELECT COUNT(*) AS n FROM location_members WHERE location_id=? AND season_id='season-2026'", stall))[0].n
        assert.ok(current <= 5)
        for (let n = current; n < 5; n++) {
          const id = `final-rehearsal-${index}-${n}`, email = `${id}@example.test`
          await db.batch([
            db.prepare('INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(?,?,?,?,?)').bind(id, email, 'Disposable rehearsal account', 'admin', passwordHash),
            db.prepare("INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2026',?,'admin')").bind(id),
            db.prepare("INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(?,'season-2026',?,'admin')").bind(stall, id),
          ])
          for (const table of ['admin_users', 'season_members', 'location_members']) add(table)
          synthetic.push({ id, email, stall })
        }
        const members = await query(`SELECT lm.admin_user_id FROM location_members lm JOIN season_members sm
          ON sm.season_id=lm.season_id AND sm.admin_user_id=lm.admin_user_id JOIN admin_users au ON au.id=lm.admin_user_id
          WHERE lm.location_id=? AND lm.season_id='season-2026'
          AND (lm.disabled_at IS NULL OR lm.disabled_at='') AND (sm.disabled_at IS NULL OR sm.disabled_at='')
          AND (au.disabled_at IS NULL OR au.disabled_at='')`, stall)
        assert.equal(members.length, 5)
        evidence.memberships.push({ stall: index === 0 ? 'B' : 'A', activeMembers: members.length, addedSyntheticMembers: 5 - current })
      }
      await preserve()
    })
    await check('new disposable accounts authenticate through real password/session services', async () => {
      for (const actor of synthetic) {
        const result = await loginWithPassword(new Request('https://rehearsal.example.test/api/admin/auth/login'), db, {}, { email: actor.email, password })
        assert.equal(result.ok, true)
        assert.equal((await resolveSessionIdentity(db, result.identity.sub)).userId, actor.id)
        add('admin_sessions'); add('admin_login_attempts')
      }
      evidence.syntheticPasswordLoginsPassed = synthetic.length
      await preserve()
    })
    await check('all ten membership contexts read only their selected stall; foreign-only accounts are denied', async () => {
      for (const [index, stall] of stalls.entries()) {
        await db.prepare(`INSERT INTO customer_requests(id,status,source,season_id,location_id)
          VALUES(?,'received','manual','season-2026',?)`).bind(`final-rehearsal-request-${index}`, stall).run()
        add('customer_requests')
      }
      let contexts = 0, deniedSwitches = 0
      const managedStalls = new Set()
      for (const [index, stall] of stalls.entries()) {
        const members = await query("SELECT au.id,au.email FROM admin_users au JOIN location_members lm ON lm.admin_user_id=au.id WHERE lm.location_id=? AND lm.season_id='season-2026'", stall)
        const expectedIds = (await query("SELECT id FROM customer_requests WHERE location_id=? AND season_id='season-2026'", stall)).map(r => r.id).sort()
        for (const member of members) {
          const request = new Request('https://rehearsal.example.test/api/admin/customer-requests', { headers: { 'X-Admin-Season-Id': 'season-2026', 'X-Admin-Location-Id': stall } })
          const attached = await attachAdminRequestContext(request, db, { userId: member.id, email: member.email }, { ADMIN_LOCATION_MODE: true })
          assert.equal(attached.ok, true)
          const context = getAdminContext(request)
          const result = await listAdminCustomerRequests(db, { limit: 100, offset: 0, seasonId: 'season-2026', context })
          assert.equal(result.total, expectedIds.length)
          assert.deepEqual(result.requests.map(r => r.id).sort(), expectedIds)
          assert.equal(await getAdminCustomerRequestById(db, `final-rehearsal-request-${1 - index}`, 'season-2026', context), null)
          if (context.locationContext.capabilities.manageSeasonUsers) {
            const listed = await listLocationAdminUsers(db, 'season-2026', context)
            assert.equal(listed.length, 5)
            assert.ok(listed.every(user => members.some(m => m.id === user.id)))
            managedStalls.add(stall)
          }
          contexts++
        }
      }
      for (const actor of synthetic) {
        const foreign = stalls.find(stall => stall !== actor.stall)
        const request = new Request('https://rehearsal.example.test/api/admin/customer-requests', { headers: { 'X-Admin-Season-Id': 'season-2026', 'X-Admin-Location-Id': foreign } })
        const result = await attachAdminRequestContext(request, db, { userId: actor.id, email: actor.email }, { ADMIN_LOCATION_MODE: true })
        assert.equal(result.ok, false); assert.equal(result.status, 403); deniedSwitches++
      }
      assert.equal(contexts, 10)
      assert.equal(managedStalls.size, 2)
      evidence.authorizedMembershipContexts = contexts
      evidence.deniedForeignStallSwitches = deniedSwitches
      evidence.stallScopedManagementListsPassed = managedStalls.size
      await preserve()
    })
    await check('final schema/foreign keys/integrity and original records remain valid', async () => {
      await preserve()
      assert.deepEqual(await query('PRAGMA foreign_key_check'), [])
      assert.equal((await query('SELECT COUNT(*) AS n FROM location_members WHERE can_view_final_rate!=0'))[0].n, 0)
      const schema = await query("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(lower(name),1,4)!='_cf_' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name")
      const tables = []
      for (const item of schema.filter(item => item.type === 'table')) {
        const rows = await query(`SELECT * FROM "${item.name}"`)
        const columns = (await query(`PRAGMA table_info("${item.name}")`)).map(c => c.name)
        tables.push({ name: item.name, columns, rows: rows.map(row => columns.map(c => row[c])) })
      }
      evidence.finalLogicalIntegrity = runPython(integrity, { schema, tables })
      evidence.finalSchemaObjects = schema.length
      evidence.finalApplicationTables = tables.length
      evidence.originalTablesPreserved = source.tables.length
      evidence.originalRowsPreserved = source.tables.reduce((n, table) => n + table.rows.length, 0)
      evidence.sourceUnchanged = sha(readFileSync(backup)) === expected
      assert.equal(evidence.sourceUnchanged, true)
    })
    assert.equal(evidence.checks.length, 6)
    const folder = new URL('../../docs/report-evidence/final-migration-rehearsal-2026-11-04/', import.meta.url)
    mkdirSync(folder, { recursive: true })
    const output = new URL(`${evidence.runId}.json`, folder)
    writeFileSync(output, JSON.stringify({ status: 'PASS', ...evidence }, null, 2), { flag: 'wx' })
    console.log(`Sanitized evidence: ${output.pathname}`)
  } finally {
    await runtime.dispose()
    assert.equal(sha(readFileSync(backup)), expected, 'Retained backup unchanged')
  }
})
