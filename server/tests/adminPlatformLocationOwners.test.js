import assert from 'node:assert/strict'
import { test } from 'node:test'
import { updatePlatformSeasonMemberRole, setPlatformSeasonMemberDisabled, PLATFORM_EFFECTIVE_OWNER_GUARD_SQL } from '../src/services/adminPlatformSeasonMembers.js'
import { locationMembersDb, season, lmKey, smKey } from './helpers/mockLocationMembersDb.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { removeLocationMember } from '../src/services/adminUsersManagement.js'
import { handleAdminPlatformRoutes } from '../src/routes/adminPlatformRoutes.js'

const env = { ADMIN_LOCATION_MODE: 'true' }
const enabled = value => value == null || value === ''
function fixture() {
  const db = locationMembersDb(), original = db.prepare.bind(db)
  db.beforeUpdate = null
  // Two locations, each with a different sole effective owner.
  db.state.locationMembers.delete(lmKey('owner', 'loc-b'))
  db.state.locationMembers.set(lmKey('other', 'loc-b'), { location_id: 'loc-b', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  const effective = (uid, s) => {
    const sm = db.state.seasonMembers.get(smKey(uid, s)), user = db.state.users.get(uid)
    return sm?.role === 'owner' && enabled(sm.disabled_at) && user && enabled(user.disabled_at)
  }
  db.prepare = raw => {
    const sql = raw.replace(/\s+/g, ' ').trim()
    if (!/FROM business_seasons WHERE|SELECT role, disabled_at|SELECT COUNT\(\*\) AS n FROM season_members|^SELECT sm.admin_user_id, sm.role|^UPDATE season_members/.test(sql)) return original(raw)
    return { bind(...v) {
      assert.equal((sql.match(/\?/g) ?? []).length, v.length, sql)
      return {
        async first() {
          db.calls.push({ sql, v, mode: 'first' })
          if (sql.includes('FROM business_seasons WHERE')) return { ...db.state.seasons.get(v[0]) }
          const sm = db.state.seasonMembers.get(smKey(v[1], v[0]))
          if (sql.startsWith('SELECT role,')) return sm ? { ...sm } : null
          if (sql.startsWith('SELECT COUNT')) return { n: [...db.state.seasonMembers.values()].filter(m => m.season_id === v[0] && m.admin_user_id !== v[1] && m.role === 'owner' && m.disabled_at == null).length }
          const u = db.state.users.get(v[1])
          return sm && u ? { ...sm, email: u.email, display_name: u.display_name, user_disabled_at: u.disabled_at } : null
        },
        async run() {
          db.beforeUpdate?.(db.state)
          db.calls.push({ sql, v, mode: 'run' })
          const [value, s, uid, role, disabled] = v
          const sm = db.state.seasonMembers.get(smKey(uid, s))
          if (!sm) return { meta: { changes: 0 } }
          if (sql.includes('mutable_season')) {
            assert.match(sql, /AND role = \? AND disabled_at IS \?/)
            if (sm.role !== role || (sm.disabled_at ?? null) !== disabled || db.state.seasons.get(s)?.status !== 'active') return { meta: { changes: 0 } }
            if (sql.includes('affected') && effective(uid, s)) {
              assert.ok(sql.includes(PLATFORM_EFFECTIVE_OWNER_GUARD_SQL.replace(/\s+/g, ' ').trim()))
              if (![...db.state.seasonMembers.values()].some(other => other.season_id === s && other.admin_user_id !== uid && effective(other.admin_user_id, s))) return { meta: { changes: 0 } }
              for (const lm of db.state.locationMembers.values()) {
                if (lm.admin_user_id !== uid || lm.season_id !== s || lm.role !== 'owner' || !enabled(lm.disabled_at)) continue
                const loc = db.state.locations.get(lm.location_id), biz = db.state.businesses.get(loc?.business_id), association = db.state.associations.get(`${lm.location_id}:${s}`)
                if (![loc, biz, association].every(r => r && ['active', 'archived'].includes(r.status))) continue
                const alternative = [...db.state.locationMembers.values()].some(other => other.location_id === lm.location_id && other.season_id === s && other.admin_user_id !== uid && other.role === 'owner' && enabled(other.disabled_at) && effective(other.admin_user_id, s))
                if (!alternative) return { meta: { changes: 0 } }
              }
            }
          }
          if (sql.startsWith('UPDATE season_members SET role')) sm.role = value
          else sm.disabled_at = value
          return { meta: { changes: 1 } }
        },
      }
    } }
  }
  return db
}

for (const action of ['demote', 'disable']) test(`platform ${action} cannot remove either location's sole effective owner`, async () => {
  const db = fixture(), before = structuredClone(db.state)
  for (const uid of ['owner', 'other']) {
    const result = action === 'demote' ? await updatePlatformSeasonMemberRole(db, season, uid, 'admin', env) : await setPlatformSeasonMemberDisabled(db, season, uid, true, env)
    assert.equal(result.status, 409)
  }
  assert.deepEqual(db.state, before)
})

test('another enabled owner must remain in every affected location and the same operating season', async () => {
  const db = fixture()
  db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  assert.equal((await updatePlatformSeasonMemberRole(db, season, 'owner', 'admin', env)).ok, true)
  assert.equal(db.state.seasonMembers.get(smKey('other')).role, 'owner')
  // Other still exclusively owns loc-b; loc-a cannot provide an alternative.
  assert.equal((await setPlatformSeasonMemberDisabled(db, season, 'other', true, env)).ok, false)
})

test('platform disable succeeds with another effective owner in the same location/season', async () => {
  const db = fixture()
  db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  assert.equal((await setPlatformSeasonMemberDisabled(db, season, 'owner', true, env)).ok, true)
  assert.ok(db.state.seasonMembers.get(smKey('owner')).disabled_at)
  assert.equal(db.state.seasonMembers.get(smKey('other')).disabled_at, null)
})

for (const invalid of ['locationDisabled', 'seasonDisabled', 'userDisabled', 'seasonRole', 'otherSeason']) test(`invalid alternative owner (${invalid}) cannot satisfy protection`, async () => {
  const db = fixture()
  db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  if (invalid === 'locationDisabled') db.state.locationMembers.get(lmKey('other')).disabled_at = 'disabled'
  if (invalid === 'seasonDisabled') db.state.seasonMembers.get(smKey('other')).disabled_at = 'disabled'
  if (invalid === 'userDisabled') db.state.users.get('other').disabled_at = 'disabled'
  if (invalid === 'seasonRole') db.state.seasonMembers.get(smKey('other')).role = 'super_admin'
  if (invalid === 'otherSeason') db.state.locationMembers.get(lmKey('other')).season_id = 'season-2026'
  assert.equal((await updatePlatformSeasonMemberRole(db, season, 'owner', 'admin', env)).ok, false)
  assert.equal(db.state.seasonMembers.get(smKey('owner')).role, 'owner')
})

test('owner guard covers all of a target owner’s locations, including archived associations', async () => {
  const db = fixture()
  db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  db.state.locationMembers.set(lmKey('owner', 'loc-b'), { location_id: 'loc-b', season_id: season, admin_user_id: 'owner', role: 'owner', disabled_at: null })
  db.state.locationMembers.delete(lmKey('other', 'loc-b'))
  db.state.associations.get(`loc-b:${season}`).status = 'archived'
  assert.equal((await updatePlatformSeasonMemberRole(db, season, 'owner', 'admin', env)).status, 409)
})

test('competing demotions are evaluated at the conditional UPDATE: exactly one wins', async () => {
  const db = fixture()
  db.state.locationMembers.delete(lmKey('other', 'loc-b'))
  db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  const results = await Promise.all(['owner', 'other'].map(uid => updatePlatformSeasonMemberRole(db, season, uid, 'admin', env)))
  assert.equal(results.filter(r => r.ok).length, 1)
  assert.equal([...db.state.seasonMembers.values()].filter(m => m.role === 'owner').length, 1)
})

test('stale role/disable snapshots and losing an alternative owner before mutation fail closed', async () => {
  const db = fixture()
  db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  db.beforeUpdate = state => { db.beforeUpdate = null; state.locationMembers.get(lmKey('other')).disabled_at = 'disabled' }
  assert.equal((await setPlatformSeasonMemberDisabled(db, season, 'owner', true, env)).status, 409)
  assert.equal(db.state.seasonMembers.get(smKey('owner')).disabled_at, null)
})

for (const field of ['role', 'disabled_at']) test(`stale platform membership ${field} cannot be overwritten`, async () => {
  const db = fixture()
  db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  db.beforeUpdate = state => {
    db.beforeUpdate = null
    state.seasonMembers.get(smKey('owner'))[field] = field === 'role' ? 'super_admin' : 'disabled'
  }
  assert.equal((await updatePlatformSeasonMemberRole(db, season, 'owner', 'admin', env)).status, 409)
})

test('location removal succeeds with an effective owner remaining and preserves the other location', async () => {
  const db = fixture()
  db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  const req = new Request('https://example.test/api/admin/users', { headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': 'loc-a' } })
  assert.equal((await attachAdminRequestContext(req, db, { userId: 'owner', email: 'owner@test.com' }, env)).ok, true)
  assert.equal((await removeLocationMember(db, season, 'other', getAdminContext(req))).ok, true)
  assert.equal(db.state.locationMembers.has(lmKey('other')), false)
  assert.ok(db.state.locationMembers.has(lmKey('other', 'loc-b')))
})

test('location removal retains existing atomic last-owner protection and is isolated by location', async () => {
  const db = fixture()
  const req = new Request('https://example.test/api/admin/users', { headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': 'loc-a' } })
  assert.equal((await attachAdminRequestContext(req, db, { userId: 'owner', email: 'owner@test.com' }, env)).ok, true)
  const context = getAdminContext(req)
  // Authorize owner first, then make target the sole effective owner at mutation.
  db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
  db.beforeBatch = state => { db.beforeBatch = null; state.locationMembers.get(lmKey('owner')).role = 'super_admin' }
  await assert.rejects(removeLocationMember(db, season, 'other', context), e => e.status === 409)
  assert.ok(db.state.locationMembers.has(lmKey('other')))
  assert.ok(db.state.locationMembers.has(lmKey('other', 'loc-b')))
})

test('platform route passes location mode without requiring selector headers; OFF emits no location SQL', async () => {
  const db = fixture()
  const original = db.prepare.bind(db)
  db.prepare = sql => sql.includes('FROM platform_admins') ? { bind: () => ({ first: async () => ({ ok: 1 }) }) } : original(sql)
  const request = new Request('https://example.test/api/admin/platform/seasons/' + season + '/members/owner', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'admin' }),
  })
  const identity = { userId: 'owner', email: 'owner@test.com' }
  assert.equal((await attachAdminRequestContext(request, db, identity, env)).ok, true)
  const result = await handleAdminPlatformRoutes(request, new URL(request.url), { identity }, { ...env, DB: db })
  assert.equal(result.status, 409)
  assert.ok(db.calls.some(c => c.mode === 'run' && c.sql.includes('location_members affected')))
  const legacy = fixture()
  assert.equal((await updatePlatformSeasonMemberRole(legacy, season, 'owner', 'admin')).ok, true)
  assert.ok(legacy.calls.every(c => !/location_members|mutable_season/.test(c.sql)))
})

test('owner predicate has balanced SQL parentheses', () => {
  const stripped = PLATFORM_EFFECTIVE_OWNER_GUARD_SQL.replace(/'[^']*'/g, '')
  let depth = 0
  for (const ch of stripped) { if (ch === '(') depth++; if (ch === ')') depth--; assert.ok(depth >= 0) }
  assert.equal(depth, 0)
})
