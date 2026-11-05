import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { locationMembersDb, season, smKey, lmKey } from './helpers/mockLocationMembersDb.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { createSeasonAdminUser, updateSeasonMemberRole, setSeasonMemberDisabled, removeLocationMember } from '../src/services/adminUsersManagement.js'
import { MAX_LOCATION_ADMIN_USERS } from '../src/services/adminLocationMembers.js'

// Actual SQLite constraints, changes(), correlated guards and rollback. Only :memory: is used.
const foundation = readFileSync(new URL('../database/migrations/0020_business_location_foundation.sql', import.meta.url), 'utf8')
const seasonFoundation = readFileSync(new URL('../database/migrations/0018_business_seasons_foundation.sql', import.meta.url), 'utf8')
const schema = `CREATE TABLE admin_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT,
  role TEXT NOT NULL CHECK(role IN ('owner','super_admin','admin')), password_hash TEXT, disabled_at TEXT,
  created_at TEXT DEFAULT '2026', updated_at TEXT DEFAULT '2026');
  CREATE TABLE business_seasons (id TEXT PRIMARY KEY, code TEXT, label TEXT, status TEXT);
  ${seasonFoundation.match(/CREATE TABLE season_members \([\s\S]*?\n\);/)[0]}
  ${foundation.slice(foundation.indexOf('CREATE TABLE businesses ('), foundation.indexOf('-- Membership existence'))}`

const sqliteScript = `
import json, sqlite3, sys
payload = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.execute('PRAGMA foreign_keys=ON')
db.executescript(payload['schema'])
for table, rows in payload['tables'].items():
    for row in rows:
        fields = list(row)
        db.execute('INSERT INTO ' + table + ' (' + ','.join(fields) + ') VALUES (' + ','.join('?' for _ in fields) + ')', list(row.values()))
db.commit()
results = []
try:
    db.execute('BEGIN')
    for statement in payload['statements']:
        db.execute(statement['sql'], statement['values'])
        results.append({'meta': {'changes': db.execute('SELECT changes()').fetchone()[0]}})
    db.commit()
    print(json.dumps({'results': results, 'tables': {table: [dict(row) for row in db.execute('SELECT * FROM ' + table)] for table in payload['tables']}}))
except sqlite3.Error as error:
    db.rollback()
    print(json.dumps({'error': str(error)}))
`

function database() {
  const db = locationMembersDb()
  const names = { users: 'admin_users', seasons: 'business_seasons', businesses: 'businesses', locations: 'business_locations', associations: 'location_seasons', seasonMembers: 'season_members', locationMembers: 'location_members' }
  db.batch = async statements => {
    db.beforeBatch?.(db.state)
    const tables = Object.fromEntries(Object.entries(names).map(([key, table]) => [table, [...db.state[key].values()]]))
    const python = process.platform === 'win32' ? 'py' : 'python3'
    const args = process.platform === 'win32' ? ['-3', '-c', sqliteScript] : ['-c', sqliteScript]
    const output = JSON.parse(execFileSync(python, args, { input: JSON.stringify({ schema, tables, statements: statements.map(({ sql, values }) => ({ sql, values })) }), encoding: 'utf8', windowsHide: true }))
    if (output.error) throw Error(output.error)
    for (const [key, table] of Object.entries(names)) {
      db.state[key] = new Map(output.tables[table].map(row => [key === 'seasonMembers' ? smKey(row.admin_user_id, row.season_id) : key === 'locationMembers' ? lmKey(row.admin_user_id, row.location_id, row.season_id) : key === 'associations' ? `${row.location_id}:${row.season_id}` : row.id, row]))
    }
    return output.results
  }
  return db
}

async function context(db, actor = 'owner', location = 'loc-a') {
  const request = new Request('https://fixture.test/api/admin/users', { headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': location } })
  const attached = await attachAdminRequestContext(request, db, { userId: actor, email: `${actor}@test.com`, role: 'owner' }, { ADMIN_LOCATION_MODE: true })
  assert.equal(attached.ok, true)
  return getAdminContext(request)
}

test('SQLite: owner handover promotes season and selected stall; former owner steps down without changing sibling roles', async () => {
  const db = database(), auth = await context(db)
  const sibling = structuredClone(db.state.locationMembers.get(lmKey('staff', 'loc-b')))
  await updateSeasonMemberRole(db, season, 'owner', 'staff', 'owner', auth)
  assert.equal(db.state.seasonMembers.get(smKey('staff')).role, 'owner')
  assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'owner')
  assert.equal(db.state.locationMembers.get(lmKey('staff', 'loc-b')).role, sibling.role)
  const successor = await context(db, 'staff')
  await updateSeasonMemberRole(db, season, 'owner', 'owner', 'admin', successor)
  await removeLocationMember(db, season, 'owner', successor)
  await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'staff', 'admin', successor), error => error.status === 400)
  assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'owner')
  assert.equal(db.state.locationMembers.get(lmKey('owner', 'loc-b')).role, 'owner')
})

test('SQLite: final zero-row membership write rolls back its preceding season promotion', async () => {
  const db = database(), auth = await context(db)
  db.beforeBatch = state => { state.locationMembers.get(lmKey('staff')).role = 'super_admin' }
  await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'staff', 'owner', auth), error => error.status === 409)
  assert.equal(db.state.seasonMembers.get(smKey('staff')).role, 'super_admin')
})

test('SQLite: concurrent actor revocation, target disabling and sibling elevation abort promotions', async () => {
  for (const change of [
    state => { state.locationMembers.get(lmKey('owner')).disabled_at = 'disabled' },
    state => { state.users.get('staff').disabled_at = 'disabled' },
    state => { state.locationMembers.get(lmKey('staff', 'loc-b')).role = 'owner' },
  ]) {
    const db = database(), auth = await context(db)
    db.beforeBatch = change
    await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'staff', 'owner', auth), error => error.status === 409)
    assert.equal(db.state.seasonMembers.get(smKey('staff')).role, 'super_admin')
    assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'admin')
  }
})

test('SQLite: Owner grants to existing and new logins are local and preserve existing credentials', async () => {
  const db = database(), auth = await context(db)
  await createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com', role: 'owner', existingOnly: true }, auth)
  assert.equal(db.state.users.get('invite').password_hash, 'original-hash')
  assert.equal(db.state.locationMembers.get(lmKey('invite')).role, 'owner')
  assert.equal(db.state.locationMembers.has(lmKey('invite', 'loc-b')), false)
  const result = await createSeasonAdminUser(db, season, 'owner', { email: 'new@test.com', role: 'owner', password: 'twelvecharspw' }, auth)
  assert.equal(db.state.users.get(result.user.id).role, 'admin')
  assert.equal(db.state.locationMembers.get(lmKey(result.user.id)).role, 'owner')
  assert.equal(db.state.locationMembers.has(lmKey(result.user.id, 'loc-b')), false)
})

test('SQLite: the last enabled owner cannot be disabled or removed and disabled alternatives do not count', async () => {
  const db = database(), auth = await context(db)
  await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'owner', 'admin', auth), error => error.status === 400)
  await createSeasonAdminUser(db, season, 'owner', { email: 'other@test.com', role: 'owner', existingOnly: true }, auth)
  const other = await context(db, 'other')
  await setSeasonMemberDisabled(db, season, 'owner', true, other)
  await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'other', 'admin', other), error => error.status === 400)
  await removeLocationMember(db, season, 'owner', other)
  assert.equal(db.state.locationMembers.get(lmKey('owner', 'loc-b')).disabled_at, null)
  assert.equal(db.state.seasonMembers.get(smKey('owner')).disabled_at, null)
})

test('SQLite: account cap rechecks inside the batch and rolls back the entire new-user grant', async () => {
  const db = database(), auth = await context(db)
  db.beforeBatch = state => {
    while (state.users.size < MAX_LOCATION_ADMIN_USERS) {
      const id = `extra-${state.users.size}`
      state.users.set(id, { id, email: `${id}@test.com`, role: 'admin', disabled_at: null })
    }
  }
  await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'overflow@test.com', password: 'twelvecharspw' }, auth), error => error.status === 409)
  assert.ok(![...db.state.users.values()].some(user => user.email === 'overflow@test.com'))
  assert.ok(![...db.state.seasonMembers.keys()].some(key => key.includes('admin-')))
})
