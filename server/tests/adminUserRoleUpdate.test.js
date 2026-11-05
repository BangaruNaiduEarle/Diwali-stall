import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { locationMembersDb, season, lmKey, smKey } from './helpers/mockLocationMembersDb.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { handleAdminUsersRoutes } from '../src/routes/adminUsersRoutes.js'

const foundation = readFileSync(new URL('../database/migrations/0020_business_location_foundation.sql', import.meta.url), 'utf8')
const seasonFoundation = readFileSync(new URL('../database/migrations/0018_business_seasons_foundation.sql', import.meta.url), 'utf8')
const schema = `CREATE TABLE admin_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT,
  role TEXT NOT NULL, password_hash TEXT, disabled_at TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE business_seasons (id TEXT PRIMARY KEY, code TEXT, label TEXT, status TEXT);
  CREATE TABLE admin_sessions (id TEXT PRIMARY KEY, admin_user_id TEXT);
  CREATE TABLE platform_admins (admin_user_id TEXT PRIMARY KEY);
  ${seasonFoundation.match(/CREATE TABLE season_members \([\s\S]*?\n\);/)[0]}
  ${foundation.slice(foundation.indexOf('CREATE TABLE businesses ('), foundation.indexOf('-- Membership existence'))}`

// Every statement runs against a newly constructed SQLite :memory: database.
// Tables are returned as fixture state; no database files or services are used.
const python = `import json,sqlite3,sys
p=json.load(sys.stdin);db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
db.execute('PRAGMA foreign_keys=ON');db.executescript(p['schema'])
for table,rows in p['tables'].items():
 for row in rows:
  fields=list(row);db.execute('INSERT INTO '+table+' ('+','.join(fields)+') VALUES ('+','.join('?' for _ in fields)+')',list(row.values()))
db.commit();out=[]
try:
 db.execute('BEGIN')
 for s in p['statements']:
  cursor=db.execute(s['sql'],s['values']);rows=[dict(r) for r in cursor.fetchall()]
  out.append({'results':rows,'meta':{'changes':db.execute('SELECT changes()').fetchone()[0]}})
 db.commit();print(json.dumps({'results':out,'tables':{t:[dict(r) for r in db.execute('SELECT * FROM '+t)] for t in p['tables']}}))
except sqlite3.Error as error:
 db.rollback();print(json.dumps({'error':str(error)}))`

function database() {
  const { state } = locationMembersDb()
  state.sessions = new Map([['staff-session', { id: 'staff-session', admin_user_id: 'staff' }]])
  const tables = { users: 'admin_users', seasons: 'business_seasons', businesses: 'businesses', locations: 'business_locations', associations: 'location_seasons', seasonMembers: 'season_members', locationMembers: 'location_members', sessions: 'admin_sessions' }
  const db = { state, calls: [], beforeWrite: null }
  function execute(statements) {
    if (statements.some(s => !/^SELECT/i.test(s.sql.trim()))) { const hook = db.beforeWrite; db.beforeWrite = null; hook?.(state) }
    db.calls.push(...statements)
    const payload = { schema, tables: Object.fromEntries(Object.entries(tables).map(([key, table]) => [table, [...state[key].values()]])), statements }
    const output = JSON.parse(execFileSync(process.platform === 'win32' ? 'py' : 'python3', process.platform === 'win32' ? ['-3', '-c', python] : ['-c', python], {
      input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true,
    }))
    if (output.error) throw Error(output.error)
    for (const [key, table] of Object.entries(tables)) state[key] = new Map(output.tables[table].map(row => [
      key === 'seasonMembers' ? smKey(row.admin_user_id, row.season_id) : key === 'locationMembers' ? lmKey(row.admin_user_id, row.location_id, row.season_id) : key === 'associations' ? `${row.location_id}:${row.season_id}` : row.id, row,
    ]))
    return output.results
  }
  db.prepare = sql => {
    const bind = (...values) => ({ sql, values, first: async () => execute([{ sql, values }])[0].results[0] ?? null,
      all: async () => execute([{ sql, values }])[0], run: async () => execute([{ sql, values }])[0] })
    return { ...bind(), bind }
  }
  db.batch = async statements => execute(statements.map(({ sql, values }) => ({ sql, values })))
  return db
}

async function request(db, { actor = 'owner', target = 'staff', role = 'owner', action = 'role', location = 'loc-a', locationMode = true, body } = {}) {
  const req = new Request(`https://fixture.test/api/admin/users${action === 'create' ? '' : action === 'remove' ? `/${target}` : `/${target}/${action}`}`, {
    method: action === 'remove' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': location },
    body: JSON.stringify(body ?? (action === 'role' ? { role } : {})),
  })
  const auth = { identity: { userId: actor, email: `${actor}@test.com`, role: db.state.users.get(actor)?.role ?? 'admin' } }
  const attached = await attachAdminRequestContext(req, db, auth.identity, { ADMIN_LOCATION_MODE: locationMode })
  if (!attached.ok) return Response.json(attached, { status: attached.status })
  return handleAdminUsersRoutes(req, { DB: db }, auth)
}

test('role update: Super Admin promotes and demotes within its hierarchy; Owner promotes to Owner locally', async () => {
  const db = database()
  const globals = structuredClone([...db.state.users.values()])
  assert.equal((await request(db, { actor: 'super', role: 'super_admin' })).status, 200)
  assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'super_admin')
  assert.equal((await request(db, { actor: 'super', role: 'admin' })).status, 200)
  assert.equal((await request(db, { role: 'owner' })).status, 200)
  assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'owner')
  assert.equal(db.state.locationMembers.get(lmKey('staff', 'loc-b')).role, 'super_admin')
  assert.deepEqual([...db.state.users.values()], globals, 'global roles and credentials stay unchanged')
})

test('role update: season-only Owner can promote Admin to Owner without changing global login role', async () => {
  const db = database()
  db.state.seasonMembers.get(smKey('staff')).role = 'admin'
  assert.equal((await request(db, { role: 'owner', locationMode: false })).status, 200)
  assert.equal(db.state.seasonMembers.get(smKey('staff')).role, 'owner')
  assert.equal(db.state.users.get('staff').role, 'admin')
})

test('role update: Super Admin can raise a season ceiling only when sibling stalls retain their authority', async () => {
  const db = database()
  db.state.seasonMembers.get(smKey('staff')).role = 'admin'
  db.state.locationMembers.get(lmKey('staff', 'loc-b')).role = 'admin'
  assert.equal((await request(db, { actor: 'super', role: 'super_admin' })).status, 200)
  assert.equal(db.state.seasonMembers.get(smKey('staff')).role, 'super_admin')
  assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'super_admin')
  assert.equal(db.state.locationMembers.get(lmKey('staff', 'loc-b')).role, 'admin')
})

test('role update: Owner cannot create or assign Super Admin; Super Admin cannot modify an Owner', async () => {
  for (const locationMode of [true, false]) {
    const db = database()
    assert.equal((await request(db, { role: 'super_admin', locationMode })).status, 403)
    assert.equal((await request(db, { action: 'create', locationMode, body: { email: 'invite@test.com', role: 'super_admin', existingOnly: true } })).status, 403)
    assert.equal((await request(db, { actor: 'super', target: 'owner', role: 'admin', locationMode })).status, 403)
  }
})

test('role update: rejects Admin, unauthenticated, invalid bodies and self changes', async () => {
  const db = database()
  db.state.seasonMembers.get(smKey('staff')).role = 'admin'
  db.state.locationMembers.get(lmKey('staff', 'loc-b')).role = 'admin'
  assert.equal((await request(db, { actor: 'staff', target: 'super', role: 'admin' })).status, 403)
  for (const locationMode of [true, false]) {
    const scoped = database()
    assert.equal((await request(scoped, { target: 'owner', role: 'admin', locationMode })).status, 400)
    assert.equal((await request(scoped, { actor: 'super', target: 'super', role: 'admin', locationMode })).status, 400)
    for (const body of [{ role: 'root' }, { role: 'admin', businessId: 'another' }, [], { role: 3 }]) {
      assert.equal((await request(scoped, { body, locationMode })).status, 400)
    }
  }
  const denied = await handleAdminUsersRoutes(new Request('https://fixture.test/api/admin/users/staff/role', { method: 'POST' }), { DB: db }, { identity: {} })
  assert.equal(denied.status, 403)
})

test('role update: last enabled Super Admin cannot be demoted, disabled or removed in a stall', async () => {
  for (const action of ['role', 'disable', 'remove']) {
    const db = database()
    assert.equal((await request(db, { target: 'super', role: 'admin', action })).status, 409)
    assert.equal(db.state.locationMembers.get(lmKey('super')).role, 'super_admin')
    assert.equal(db.state.locationMembers.get(lmKey('super')).disabled_at, null)
  }
})

test('role update: last-Super-Admin protection is atomic and ignores disabled alternatives', async () => {
  const db = database()
  db.state.locationMembers.get(lmKey('staff')).role = 'super_admin'
  db.beforeWrite = state => { state.users.get('staff').disabled_at = 'disabled' }
  assert.equal((await request(db, { target: 'super', role: 'admin' })).status, 409)
  assert.equal(db.state.locationMembers.get(lmKey('super')).role, 'super_admin')
})

test('role update: other businesses, stalls and seasons cannot supply target memberships or successor Super Admins', async () => {
  const db = database()
  db.state.locationMembers.delete(lmKey('staff'))
  db.state.associations.set('loc-a:season-2026', { location_id: 'loc-a', season_id: 'season-2026', operating_year: 2026, status: 'active' })
  db.state.seasonMembers.set(smKey('staff', 'season-2026'), { ...db.state.seasonMembers.get(smKey('staff')), season_id: 'season-2026' })
  db.state.locationMembers.set(lmKey('staff', 'loc-a', 'season-2026'), { location_id: 'loc-a', season_id: 'season-2026', admin_user_id: 'staff', role: 'super_admin', disabled_at: null })
  assert.equal((await request(db, { role: 'admin' })).status, 404)
  db.state.businesses.set('other-shop', { ...db.state.businesses.get('shop'), id: 'other-shop', slug: 'other-shop' })
  db.state.locations.get('loc-b').business_id = 'other-shop'
  assert.equal((await request(db, { target: 'super', role: 'admin' })).status, 409)
  const before = structuredClone([...db.state.locationMembers.values()])
  assert.equal((await request(db, { location: 'loc-b', target: 'invite', role: 'admin' })).status, 404)
  assert.deepEqual([...db.state.locationMembers.values()], before)
})

test('role update: sibling-authority and actor-revocation guards remain atomic', async () => {
  const db = database()
  db.state.seasonMembers.get(smKey('staff')).role = 'admin'
  assert.equal((await request(db, { actor: 'super', role: 'super_admin' })).status, 409)
  db.state.seasonMembers.get(smKey('staff')).role = 'super_admin'
  db.beforeWrite = state => { state.locationMembers.get(lmKey('super')).disabled_at = 'disabled' }
  assert.equal((await request(db, { actor: 'super', role: 'super_admin' })).status, 409)
  assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'admin')
})

test('role update: season-only API enforces transitions, self and atomic last-Super-Admin guards', async () => {
  const db = database()
  db.state.seasonMembers.get(smKey('staff')).role = 'admin'
  assert.equal((await request(db, { actor: 'super', role: 'super_admin', locationMode: false })).status, 200)
  assert.equal((await request(db, { role: 'admin', locationMode: false })).status, 200)
  assert.equal((await request(db, { target: 'super', role: 'admin', locationMode: false })).status, 409)
  assert.equal((await request(db, { target: 'super', action: 'disable', locationMode: false })).status, 409)
  assert.equal((await request(db, { actor: 'super', target: 'super', role: 'admin', locationMode: false })).status, 400)
})

test('role update: empty disabled timestamps remain active and globally disabled Super Admins are not counted', async () => {
  const db = database()
  db.state.seasonMembers.get(smKey('staff')).role = 'admin'
  db.state.seasonMembers.get(smKey('super')).disabled_at = ''
  assert.equal((await request(db, { target: 'super', role: 'admin', locationMode: false })).status, 409)
  assert.equal((await request(db, { target: 'super', action: 'disable', locationMode: false })).status, 409)
  const location = database()
  location.state.users.get('super').disabled_at = 'disabled'
  assert.equal((await request(location, { target: 'super', action: 'remove' })).status, 200)
})
