import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { locationMembersDb, season, smKey, lmKey } from './helpers/mockLocationMembersDb.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { listSeasonAdminUsers, listSeasonAssignees, createSeasonAdminUser, updateSeasonMemberRole, setSeasonMemberDisabled, removeLocationMember, resetAdminUserPassword } from '../src/services/adminUsersManagement.js'
import { handleAdminUsersRoutes } from '../src/routes/adminUsersRoutes.js'
import { handleAdminSession } from '../src/routes/admin.js'
import { verifyPassword } from '../src/lib/passwordHash.js'
import { MAX_LOCATION_ADMIN_USERS } from '../src/services/adminLocationMembers.js'

async function requestContext(db, { actor = 'owner', location = 'loc-a', operatingSeason = season, mode = true, path = '/api/admin/users', method = 'GET', body } = {}) {
  const request = new Request('https://example.test' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(location == null ? {} : { 'X-Admin-Location-Id': location }), ...(operatingSeason == null ? {} : { 'X-Admin-Season-Id': operatingSeason }) },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  })
  const identity = { userId: actor, email: `${actor}@test.com`, role: 'owner' }
  const attached = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: mode })
  return { request, context: getAdminContext(request), identity, attached }
}
const denied = e => e.status === 403
const unchangedGlobals = state => structuredClone({ users: state.users, seasons: state.seasonMembers, sessions: state.sessions })

describe('location-scoped admin membership management (mocked D1)', () => {
  it('lists only the selected location/season and retains distinct roles', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    const a = await listSeasonAdminUsers(db, season, context)
    assert.equal(a.find(u => u.id === 'staff').role, 'admin')
    const { context: b } = await requestContext(db, { location: 'loc-b' })
    assert.equal((await listSeasonAdminUsers(db, season, b)).find(u => u.id === 'staff').role, 'super_admin')
    db.state.locationMembers.delete(lmKey('staff', 'loc-a'))
    assert.ok(!(await listSeasonAdminUsers(db, season, context)).some(u => u.id === 'staff'))
    assert.ok((await listSeasonAdminUsers(db, season, b)).some(u => u.id === 'staff'))
  })

  it('disables/enables one location membership without changing global sessions or season memberships', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db), before = unchangedGlobals(db.state)
    assert.equal((await setSeasonMemberDisabled(db, season, 'staff', true, context)).ok, true)
    assert.ok(db.state.locationMembers.get(lmKey('staff')).disabled_at)
    assert.equal(db.state.locationMembers.get(lmKey('staff', 'loc-b')).disabled_at, null)
    assert.ok(!(await listSeasonAssignees(db, season, context)).some(u => u.id === 'staff'))
    assert.equal((await setSeasonMemberDisabled(db, season, 'staff', false, context)).ok, true)
    assert.ok((await listSeasonAssignees(db, season, context)).some(u => u.id === 'staff'))
    assert.deepEqual(unchangedGlobals(db.state), before)
  })

  it('grants an existing identity without changing password, global role, or other locations', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    db.state.locationMembers.delete(lmKey('staff'))
    const before = unchangedGlobals(db.state), other = structuredClone(db.state.locationMembers.get(lmKey('staff', 'loc-b')))
    const result = await createSeasonAdminUser(db, season, 'owner', { email: 'staff@test.com', role: 'admin', password: 'ignored', displayName: 'Ignored' }, context)
    assert.equal(result.ok, true)
    assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'admin')
    assert.deepEqual(db.state.locationMembers.get(lmKey('staff', 'loc-b')), other)
    assert.deepEqual(unchangedGlobals(db.state), before)
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'staff@test.com', role: 'admin' }, context), e => e.status === 409)
  })

  it('invites a new login atomically using existing password policy and hashing', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    db.state.users.delete('invite')
    const result = await createSeasonAdminUser(db, season, 'owner', { email: 'new@test.com', password: 'twelvecharspw', role: 'super_admin' }, context)
    assert.equal(result.ok, true)
    const user = db.state.users.get(result.user.id)
    assert.equal(await verifyPassword('twelvecharspw', user.password_hash), true)
    assert.equal(db.state.seasonMembers.get(smKey(user.id)).role, 'super_admin')
    assert.equal(db.state.locationMembers.get(lmKey(user.id)).role, 'super_admin')
    assert.equal(db.state.locationMembers.has(lmKey(user.id, 'loc-b')), false)
    assert.ok(!('passwordHash' in result.user))
  })

  it('retains password validation and rolls back a new account if actor authorization changes', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'new@test.com', password: 'x' }, context), e => e.status === 400)
    db.beforeBatch = state => { state.locationMembers.get(lmKey('owner')).disabled_at = 'disabled' }
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'new@test.com', password: 'twelvecharspw' }, context), e => e.status === 409)
    assert.ok(![...db.state.users.values()].some(u => u.email === 'new@test.com'))
    assert.ok(![...db.state.seasonMembers.values()].some(sm => sm.admin_user_id.startsWith('admin-')))
  })

  it('rejects season promotion that would elevate another stall, and never re-enables disabled authority', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    db.state.seasonMembers.get(smKey('staff')).role = 'admin'
    await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'staff', 'super_admin', context), e => e.code === 'season_authority_conflict')
    db.state.locationMembers.delete(lmKey('staff'))
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'staff@test.com', role: 'super_admin' }, context), e => e.code === 'season_authority_conflict')
    db.state.seasonMembers.get(smKey('staff')).disabled_at = 'disabled'
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'staff@test.com' }, context), denied)
    db.state.users.get('invite').disabled_at = 'disabled'
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com' }, context), denied)
    assert.equal(db.state.seasonMembers.get(smKey('staff')).role, 'admin')
    assert.equal(db.state.seasonMembers.get(smKey('staff')).disabled_at, 'disabled')
  })

  it('retains owner-only changes and limits super_admin invitations to admin', async () => {
    const db = locationMembersDb(), { context: superContext } = await requestContext(db, { actor: 'super' })
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com', role: 'super_admin' }, superContext), denied)
    for (const fn of [() => updateSeasonMemberRole(db, season, 'owner', 'staff', 'admin', superContext), () => setSeasonMemberDisabled(db, season, 'staff', true, superContext), () => removeLocationMember(db, season, 'staff', superContext)]) await assert.rejects(fn(), denied)
    assert.equal((await createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com', role: 'admin' }, superContext)).ok, true)
    const { context: staff } = await requestContext(db, { actor: 'staff' })
    await assert.rejects(listSeasonAdminUsers(db, season, staff), denied)
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com' }, staff), denied)
    assert.ok((await listSeasonAssignees(db, season, staff)).some(u => u.id === 'owner'))
  })

  it('changes/removes only the selected membership and prevents self-lockout', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db), before = unchangedGlobals(db.state)
    assert.equal((await updateSeasonMemberRole(db, season, 'owner', 'staff', 'super_admin', context)).ok, true)
    assert.equal((await removeLocationMember(db, season, 'staff', context)).ok, true)
    assert.ok(db.state.locationMembers.has(lmKey('staff', 'loc-b')))
    await assert.rejects(setSeasonMemberDisabled(db, season, 'staff', true, context), e => e.status === 404)
    await assert.rejects(setSeasonMemberDisabled(db, season, 'owner', true, context), e => e.status === 400)
    await assert.rejects(removeLocationMember(db, season, 'owner', context), e => e.status === 400)
    await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'owner', 'admin', context), e => e.status === 409)
    assert.deepEqual(unchangedGlobals(db.state), before)
  })

  it('promotes a successor including its season ceiling, then permits the old owner to step down', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    const globals = structuredClone({ users: db.state.users, sessions: db.state.sessions })
    const sibling = structuredClone(db.state.locationMembers.get(lmKey('staff', 'loc-b')))
    assert.equal((await updateSeasonMemberRole(db, season, 'owner', 'staff', 'owner', context)).ok, true)
    assert.equal(db.state.seasonMembers.get(smKey('staff')).role, 'owner')
    assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'owner')
    assert.deepEqual(db.state.locationMembers.get(lmKey('staff', 'loc-b')), sibling)
    assert.deepEqual({ users: db.state.users, sessions: db.state.sessions }, globals)
    assert.equal((await updateSeasonMemberRole(db, season, 'owner', 'owner', 'admin', context)).ok, true)
    const { context: successor } = await requestContext(db, { actor: 'staff' })
    assert.equal((await removeLocationMember(db, season, 'owner', successor)).ok, true)
    await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'staff', 'admin', successor), e => e.status === 409)
    assert.ok(db.state.locationMembers.has(lmKey('owner', 'loc-b')))
  })

  it('grants an existing login Owner without a password, but never creates an unknown existing login', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    assert.equal((await createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com', role: 'owner', existingOnly: true }, context)).ok, true)
    assert.equal(db.state.seasonMembers.get(smKey('invite')).role, 'owner')
    assert.equal(db.state.locationMembers.get(lmKey('invite')).role, 'owner')
    assert.equal(db.state.users.get('invite').password_hash, 'original-hash')
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'missing@test.com', existingOnly: true, password: 'twelvecharspw' }, context), e => e.status === 404)
    assert.ok(![...db.state.users.values()].some(user => user.email === 'missing@test.com'))
  })

  it('creates an Owner login without granting global owner or another-stall authority', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    const result = await createSeasonAdminUser(db, season, 'owner', { email: 'new-owner@test.com', role: 'owner', password: 'twelvecharspw' }, context)
    assert.equal(db.state.users.get(result.user.id).role, 'admin')
    assert.equal(db.state.seasonMembers.get(smKey(result.user.id)).role, 'owner')
    assert.equal(db.state.locationMembers.get(lmKey(result.user.id)).role, 'owner')
    const { attached } = await requestContext(db, { actor: result.user.id, location: 'loc-b' })
    assert.equal(attached.ok, false)
  })

  it('supports more than five accounts and enforces the larger location-mode cap', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    const created = await createSeasonAdminUser(db, season, 'owner', { email: 'sixth@test.com', password: 'twelvecharspw' }, context)
    assert.equal(created.ok, true)
    while (db.state.users.size < MAX_LOCATION_ADMIN_USERS) {
      const id = `extra-${db.state.users.size}`
      db.state.users.set(id, { id, email: `${id}@test.com`, role: 'admin', disabled_at: '' })
    }
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'overflow@test.com', password: 'twelvecharspw' }, context), e => e.code === 'limit_reached')
    assert.equal((await createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com', existingOnly: true }, context)).ok, true)
  })

  it('routes existing-only Owner assignment and rejects missing accounts without writes', async () => {
    const db = locationMembersDb()
    for (const [body, expected] of [
      [{ email: 'missing@test.com', existingOnly: true, password: 'twelvecharspw' }, 404],
      [{ email: 'invite@test.com', existingOnly: 'yes' }, 400],
      [{ email: 'invite@test.com', existingOnly: true, role: 'owner' }, 201],
    ]) {
      const { request, identity } = await requestContext(db, { method: 'POST', body })
      const response = await handleAdminUsersRoutes(request, { DB: db }, { identity })
      assert.equal(response.status, expected)
    }
    assert.equal(db.state.locationMembers.get(lmKey('invite')).role, 'owner')
    assert.ok(![...db.state.users.values()].some(user => user.email === 'missing@test.com'))
  })

  it('only effective stall Owners can grant Owner despite a global or season Owner label', async () => {
    const db = locationMembersDb()
    for (const actor of ['super', 'staff']) {
      const { context } = await requestContext(db, { actor })
      await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com', role: 'owner', existingOnly: true }, context), denied)
      await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'staff', 'owner', context), denied)
    }
    db.state.seasonMembers.get(smKey('owner')).role = 'owner'
    db.state.locationMembers.get(lmKey('owner')).role = 'admin'
    const { context } = await requestContext(db)
    await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com', role: 'owner' }, context), denied)
  })

  it('allows the sole Owner to retain Owner without requiring a second Owner', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    assert.equal((await updateSeasonMemberRole(db, season, 'owner', 'owner', 'owner', context)).ok, true)
  })

  it('rolls back season promotion when the selected membership changes before the batch', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    const previous = db.state.seasonMembers.get(smKey('staff')).role
    db.beforeBatch = state => { state.locationMembers.get(lmKey('staff')).role = 'super_admin' }
    await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'staff', 'owner', context), e => e.status === 409)
    assert.equal(db.state.seasonMembers.get(smKey('staff')).role, previous)
  })

  it('rechecks sibling roles inside the promotion transaction', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    db.state.seasonMembers.get(smKey('staff')).role = 'admin'
    db.state.locationMembers.get(lmKey('staff', 'loc-b')).role = 'admin'
    db.beforeBatch = state => { state.locationMembers.get(lmKey('staff', 'loc-b')).role = 'owner' }
    await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'staff', 'owner', context), e => e.status === 409)
    assert.equal(db.state.seasonMembers.get(smKey('staff')).role, 'admin')
    assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'admin')
  })

  it('allows owner demotion only while another enabled owner remains at the same location/season', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    db.state.locationMembers.set(lmKey('other', 'loc-b'), { location_id: 'loc-b', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
    await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'owner', 'admin', context), e => e.status === 409)
    db.state.locationMembers.set(lmKey('other'), { location_id: 'loc-a', season_id: season, admin_user_id: 'other', role: 'owner', disabled_at: null })
    assert.equal((await updateSeasonMemberRole(db, season, 'owner', 'owner', 'admin', context)).ok, true)
    assert.equal(db.state.seasonMembers.get(smKey('owner')).role, 'owner')
  })

  it('rejects missing association, archived context, stale actor membership and season mismatch', async () => {
    for (const mutate of [db => db.state.associations.delete(`loc-a:${season}`), db => { db.state.associations.get(`loc-a:${season}`).status = 'archived' }, db => { db.state.locationMembers.get(lmKey('owner')).disabled_at = 'disabled' }, db => { db.state.users.get('owner').disabled_at = 'disabled' }]) {
      const db = locationMembersDb(), { context } = await requestContext(db); mutate(db)
      await assert.rejects(createSeasonAdminUser(db, season, 'owner', { email: 'invite@test.com' }, context), denied)
    }
    const db = locationMembersDb(), { context } = await requestContext(db)
    await assert.rejects(listSeasonAdminUsers(db, 'season-2026', context), denied)
    db.state.associations.get(`loc-a:${season}`).status = 'archived'
    assert.deepEqual(await listSeasonAssignees(db, season, context), [])
  })

  it('rechecks target season role and enabled state inside mutation predicates', async () => {
    const db = locationMembersDb(), { context } = await requestContext(db)
    db.beforeBatch = state => { state.seasonMembers.get(smKey('staff')).role = 'admin' }
    await assert.rejects(updateSeasonMemberRole(db, season, 'owner', 'staff', 'super_admin', context), e => e.status === 409)
    assert.equal(db.state.locationMembers.get(lmKey('staff')).role, 'admin')
    db.beforeBatch = state => { state.associations.get(`loc-a:${season}`).status = 'archived' }
    await assert.rejects(setSeasonMemberDisabled(db, season, 'staff', true, context), e => e.status === 409)
    assert.equal(db.state.locationMembers.get(lmKey('staff')).disabled_at, null)
  })

  it('routes grants/role/disable/enable/removal by request context, rejecting global password changes', async () => {
    const db = locationMembersDb()
    for (const [path, method, body, status] of [
      ['/api/admin/users', 'GET', null, 200],
      ['/api/admin/users', 'POST', { email: 'invite@test.com', role: 'admin', locationId: 'loc-b' }, 201],
      ['/api/admin/users/staff/role', 'POST', { role: 'super_admin' }, 200],
      ['/api/admin/users/staff/disable', 'POST', null, 200],
      ['/api/admin/users/staff/enable', 'POST', null, 200],
      ['/api/admin/users/staff/reset-password', 'POST', { password: 'twelvecharspw' }, 403],
      ['/api/admin/users/staff', 'DELETE', null, 200],
    ]) {
      const { request, identity, attached } = await requestContext(db, { path, method, body })
      assert.equal(attached.ok, true)
      assert.equal((await handleAdminUsersRoutes(request, { DB: db }, { identity })).status, status, path)
    }
    assert.equal(db.state.locationMembers.has(lmKey('invite', 'loc-b')), false)
    assert.equal(db.state.users.get('staff').password_hash, 'original-hash')
    assert.equal(db.state.sessions.size, 3)
  })

  it('preserves global password reset hashing and revocation of all target sessions', async () => {
    const db = locationMembersDb(), memberships = structuredClone(db.state.locationMembers)
    assert.equal((await resetAdminUserPassword(db, 'staff', 'changed-password-123')).ok, true)
    assert.equal(await verifyPassword('changed-password-123', db.state.users.get('staff').password_hash), true)
    assert.deepEqual([...db.state.sessions.keys()], ['owner-session'])
    assert.deepEqual(db.state.locationMembers, memberships)
  })
})

describe('enabled admin session authorized locations (mocked D1)', () => {
  it('exposes distinct location roles and only enabled authorized associations without auto-selection', async () => {
    const db = locationMembersDb(), { request, identity } = await requestContext(db, { actor: 'staff', path: '/api/admin/session', location: null })
    const response = await handleAdminSession(request, { identity }, { DB: db, ADMIN_LOCATION_MODE: true })
    const session = await response.json()
    assert.equal(response.status, 200)
    assert.equal(session.activeLocationId, null); assert.equal(session.locationSelectionRequired, true)
    assert.deepEqual(session.authorizedLocations.map(m => [m.location.id, m.locationRole, m.effectiveRole]), [['loc-a', 'admin', 'admin'], ['loc-b', 'super_admin', 'super_admin']])
    assert.ok(session.authorizedLocations.every(m => m.business.id === 'shop' && m.association.seasonId === season))
    db.state.locationMembers.get(lmKey('staff', 'loc-b')).disabled_at = 'disabled'
    const after = await handleAdminSession(request, { identity }, { DB: db, ADMIN_LOCATION_MODE: true })
    assert.deepEqual((await after.json()).authorizedLocations.map(m => m.location.id), ['loc-a'])
  })

  it('does not expose disabled seasons or unrelated/invalid associations, or auto-map 2099', async () => {
    const db = locationMembersDb()
    db.state.seasonMembers.set(smKey('owner', 'season-2099'), { season_id: 'season-2099', admin_user_id: 'owner', role: 'owner', disabled_at: 'disabled' })
    db.state.associations.delete(`loc-b:${season}`)
    const { request, identity } = await requestContext(db, { path: '/api/admin/session', location: null })
    const session = await (await handleAdminSession(request, { identity }, { DB: db, ADMIN_LOCATION_MODE: true })).json()
    assert.deepEqual(session.authorizedLocations.map(m => m.location.id), ['loc-a'])
    assert.deepEqual(session.memberships.map(m => m.seasonId), [season])
    assert.equal(session.activeLocationId, null)
  })

  it('advertises archived read-only associations and no location for an enabled unmapped 2099 season', async () => {
    const db = locationMembersDb()
    db.state.associations.get(`loc-a:${season}`).status = 'archived'
    const { request, identity } = await requestContext(db, { path: '/api/admin/session' })
    const session = await (await handleAdminSession(request, { identity }, { DB: db, ADMIN_LOCATION_MODE: true })).json()
    assert.equal(session.authorizedLocations.find(m => m.location.id === 'loc-a').capabilities.write, false)
    db.state.seasonMembers.set(smKey('owner', 'season-2099'), { season_id: 'season-2099', admin_user_id: 'owner', role: 'owner', disabled_at: null })
    const other = await requestContext(db, { path: '/api/admin/session', operatingSeason: 'season-2099', location: null })
    const unmapped = await (await handleAdminSession(other.request, { identity: other.identity }, { DB: db, ADMIN_LOCATION_MODE: true })).json()
    assert.equal(unmapped.activeLocationId, null)
    assert.ok(unmapped.authorizedLocations.every(m => m.operatingSeason.id !== 'season-2099'))
  })

  it('rejects disabled global identities without exposing memberships', async () => {
    const db = locationMembersDb(), { request, identity } = await requestContext(db, { path: '/api/admin/session' })
    db.state.users.get('owner').disabled_at = 'disabled'
    const response = await handleAdminSession(request, { identity }, { DB: db, ADMIN_LOCATION_MODE: true })
    assert.equal(response.status, 403)
    assert.ok(!('authorizedLocations' in await response.json()))
  })

  it('honors explicit selection and rejects foreign/empty selections without substitution', async () => {
    const db = locationMembersDb()
    for (const [location, expected] of [['loc-b', 200], ['foreign', 403], ['', 403]]) {
      const { request, identity } = await requestContext(db, { path: '/api/admin/session', location, actor: 'staff' })
      const response = await handleAdminSession(request, { identity }, { DB: db, ADMIN_LOCATION_MODE: true })
      assert.equal(response.status, expected)
      if (expected === 200) { const body = await response.json(); assert.equal(body.activeLocationId, 'loc-b'); assert.equal(body.effectiveRole, 'super_admin') }
    }
  })

  it('reports the freshly resolved effective role after a concurrent location-role change', async () => {
    const db = locationMembersDb(), { request, identity } = await requestContext(db, { path: '/api/admin/session', actor: 'staff', location: 'loc-b' })
    const prepare = db.prepare.bind(db); let resolutions = 0
    db.prepare = sql => ({ bind(...values) {
      const statement = prepare(sql).bind(...values)
      return { ...statement, async all() {
        if (sql.includes('AS season_user_id') && ++resolutions === 4) db.state.locationMembers.get(lmKey('staff', 'loc-b')).role = 'admin'
        return statement.all()
      } }
    } })
    const session = await (await handleAdminSession(request, { identity }, { DB: db, ADMIN_LOCATION_MODE: true })).json()
    assert.equal(session.activeLocationId, 'loc-b')
    assert.equal(session.locationRole, 'admin'); assert.equal(session.effectiveRole, 'admin')
  })

  it('preserves the unique 2026 compatibility mapping without modifying membership roles', async () => {
    const db = locationMembersDb(), old = 'season-2026', loc = 'location-diwali-2026'
    db.state.businesses.set('business-diwali', { id: 'business-diwali', business_type: 'seasonal', status: 'active' })
    db.state.locations.set(loc, { id: loc, business_id: 'business-diwali', status: 'active' })
    db.state.associations.set(`${loc}:${old}`, { location_id: loc, season_id: old, operating_year: 2026, status: 'active' })
    db.state.seasonMembers.set(smKey('owner', old), { season_id: old, admin_user_id: 'owner', role: 'owner', disabled_at: null })
    db.state.locationMembers.set(lmKey('owner', loc, old), { location_id: loc, season_id: old, admin_user_id: 'owner', role: 'owner', disabled_at: null })
    const before = structuredClone(db.state), { request, identity } = await requestContext(db, { path: '/api/admin/session', location: null, operatingSeason: old })
    const session = await (await handleAdminSession(request, { identity }, { DB: db, ADMIN_LOCATION_MODE: true })).json()
    assert.equal(session.activeLocationId, loc); assert.equal(session.locationRole, 'owner')
    assert.deepEqual(db.state, before)
  })

  it('keeps disabled-mode session fields/queries unchanged and fails closed on missing enabled schema', async () => {
    const db = locationMembersDb(), { request, identity } = await requestContext(db, { path: '/api/admin/session', mode: false })
    db.calls.length = 0
    const session = await (await handleAdminSession(request, { identity }, { DB: db })).json()
    assert.ok(!('authorizedLocations' in session)); assert.ok(!('activeLocationId' in session))
    assert.ok(db.calls.every(c => !c.sql.includes('location_members')))
    const prepare = db.prepare.bind(db)
    db.prepare = sql => { if (sql.includes('location_members')) throw Error('no such table: location_members'); return prepare(sql) }
    const response = await handleAdminSession(request, { identity }, { DB: db, ADMIN_LOCATION_MODE: true })
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('no such table'))
  })
})
