import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  adminLocationMode, attachAdminRequestContext, attachAdminSeasonContext,
  getAdminContext, getAdminLocationContext, requireAdmin, adminAuthErrorResponse,
} from '../src/middleware/requireAdmin.js'
import {
  requireLocationMembership, requireLocationRole, requireWritableLocation,
  resolveLocationScopedAuthorizationFromContext,
} from '../src/middleware/adminLocationGuards.js'
import {
  requireActiveSeason, requireSeasonMembership, requireSeasonRole,
  requireWritableSeason, requirePlatformAdmin,
} from '../src/middleware/adminSeasonGuards.js'
import { seasonAuthorizationAllows } from '../src/lib/adminSeasonAuthorization.js'
import { ADMIN_LOCATION_CONTEXT_SQL } from '../src/services/adminLocationContext.js'
import { CORS_ALLOW_HEADERS, handleCorsPreflight } from '../src/lib/cors.js'

const identity = { userId: 'u-1', email: 'owner@test.com', role: 'owner' }
const enabled = { ADMIN_LOCATION_MODE: 'true' }
const seasonId = 'season-2026', locationId = 'location-diwali-2026'

function request({ method = 'GET', path = '/api/admin/products', location = locationId, season = seasonId, cookie = true } = {}) {
  const headers = new Headers()
  if (location !== null) headers.set('X-Admin-Location-Id', location)
  if (season !== null) headers.set('X-Admin-Season-Id', season)
  if (cookie) headers.set('Cookie', 'diwali_admin_session=test-session')
  return new Request('https://example.test' + path, { method, headers })
}

function createDb(opts = {}) {
  const queries = [], writes = []
  const role = opts.seasonRole ?? 'owner', status = opts.seasonStatus ?? 'active'
  const membership = {
    season_id: seasonId, role, status, code: '2026', label: '2026',
    disabled_at: opts.seasonDisabled ? '2026-11-01' : null, created_at: '2026-01-01',
  }
  const row = {
    season_user_id: 'u-1', member_season_id: seasonId, season_role: role,
    season_disabled_at: membership.disabled_at, season_id: seasonId,
    season_code: '2026', season_label: '2026', season_status: status,
    location_user_id: 'u-1', member_location_id: locationId,
    location_member_season_id: seasonId, location_role: opts.locationRole ?? 'owner',
    location_disabled_at: opts.locationDisabled ? '2026-11-01' : null,
    location_id: locationId, location_business_id: 'business-diwali',
    location_slug: 'diwali-2026', location_name: 'Stall', location_status: opts.locationStatus ?? 'active',
    business_id: 'business-diwali', business_slug: 'diwali', business_name: 'Diwali',
    business_type: 'seasonal', business_status: opts.businessStatus ?? 'active',
    association_location_id: locationId, association_season_id: seasonId,
    operating_year: 2026, association_status: opts.associationStatus ?? 'active',
  }
  return {
    queries, writes,
    prepare(sql) {
      queries.push(sql)
      if (sql === ADMIN_LOCATION_CONTEXT_SQL && opts.missingSchema) throw new Error('no such table: location_members [private diagnostic]')
      return {
        bind(...params) {
          return {
            async first() {
              if (sql.includes('FROM admin_sessions s')) {
                if (opts.invalidSession) return null
                return { id: 'u-1', email: identity.email, role: 'owner', disabled_at: null, password_hash: 'unused', session_id: 'test-session', expires_at: '2999-01-01T00:00:00.000Z' }
              }
              if (sql.includes('FROM platform_admins')) return opts.platformAdmin ? { ok: 1 } : null
              throw new Error('Unexpected SELECT first: ' + sql)
            },
            async all() {
              if (sql === ADMIN_LOCATION_CONTEXT_SQL) {
                assert.deepEqual(params, ['u-1', seasonId])
                return { results: opts.locationRows ?? [row] }
              }
              if (sql.includes('FROM season_members')) return { results: opts.noSeasonMembership ? [] : [membership] }
              throw new Error('Unexpected SELECT all: ' + sql)
            },
            async run() {
              // Authentication's existing last_seen_at update is mocked only.
              assert.match(sql, /UPDATE admin_sessions SET last_seen_at/)
              writes.push(sql)
              return { success: true }
            },
          }
        },
      }
    },
  }
}

describe('gated admin location middleware (mocked D1 only)', () => {
  it('keeps disabled mode identical to legacy attachment without querying 0020 tables', async () => {
    for (const flag of [undefined, '', 'false', false, '0', 0]) {
      const db = createDb({ missingSchema: true })
      const legacy = await attachAdminSeasonContext(request(), db, identity)
      const req = request({ location: 'invalid-location' })
      const attached = await attachAdminRequestContext(req, db, identity, { ADMIN_LOCATION_MODE: flag })
      assert.equal(attached.ok, true)
      assert.deepEqual(getAdminContext(req), legacy)
      assert.equal(getAdminLocationContext(req), null)
      assert.equal(requireWritableSeason(req).ok, true)
      assert.equal(requireSeasonRole(req, ['owner']).ok, true)
      assert.equal(db.queries.includes(ADMIN_LOCATION_CONTEXT_SQL), false)
    }
  })

  it('parses enabled values explicitly and rejects invalid gate configuration', async () => {
    for (const value of ['true', 'TRUE', '1', true, 1]) assert.equal(adminLocationMode({ ADMIN_LOCATION_MODE: value }), true)
    const db = createDb()
    const req = request()
    const result = await attachAdminRequestContext(req, db, identity, { ADMIN_LOCATION_MODE: 'tru' })
    assert.equal(result.status, 503)
    assert.equal(requireSeasonMembership(req).ok, false)
    assert.equal(db.queries.includes(ADMIN_LOCATION_CONTEXT_SQL), false)
  })

  it('authenticates as before and attaches the validated scope using the request WeakMap', async () => {
    const db = createDb(), req = request()
    const auth = await requireAdmin(req, { DB: db, ...enabled })
    assert.equal(auth.ok, true)
    assert.equal(auth.identity.role, 'owner')
    assert.equal(auth.adminContext, getAdminContext(req))
    const scope = getAdminLocationContext(req)
    assert.equal(scope.activeLocationId, locationId)
    assert.equal(scope.businessId, 'business-diwali')
    assert.equal(scope.activeSeasonId, seasonId)
    assert.equal(requireLocationMembership(req).ok, true)
    assert.equal(requireWritableLocation(req).ok, true)
    assert.equal(requireActiveSeason(req).ok, true)
    assert.equal(requireSeasonMembership(req).auth.activeLocationId, locationId)
    assert.equal(requireSeasonRole(req, ['owner']).ok, true)
    assert.equal(db.writes.length, 1)
  })

  it('denies unauthenticated requests before any location query', async () => {
    const db = createDb()
    const result = await requireAdmin(request({ cookie: false }), { DB: db, ...enabled })
    assert.equal(result.status, 401)
    assert.equal(db.queries.length, 0)
  })

  for (const [name, options, reqOptions] of [
    ['invalid location', {}, { location: 'foreign-location' }],
    ['disabled location membership', { locationDisabled: true }, {}],
    ['disabled season membership', { seasonDisabled: true }, {}],
    ['missing season membership', { noSeasonMembership: true }, {}],
    ['missing location membership', { locationRows: [] }, {}],
    ['invalid operating season', {}, { season: 'season-2099' }],
    ['empty explicit location', {}, { location: '' }],
  ]) {
    it(`fails closed for ${name} even for a platform owner`, async () => {
      const db = createDb({ ...options, platformAdmin: true }), req = request(reqOptions)
      const result = await requireAdmin(req, { DB: db, ...enabled })
      assert.equal(result.ok, false)
      assert.equal(result.status, 403)
      assert.equal(getAdminLocationContext(req), null)
      for (const guard of [requireActiveSeason, requireSeasonMembership, requireWritableSeason, requireLocationMembership]) {
        assert.equal(guard(req).ok, false)
      }
    })
  }

  it('returns a safe 503 for missing schema, with no fallback or SQL details', async () => {
    const db = createDb({ missingSchema: true }), req = request()
    const result = await requireAdmin(req, { DB: db, ...enabled })
    assert.equal(result.status, 503)
    assert.equal(result.code, 'location_context_unavailable')
    assert.doesNotMatch(JSON.stringify(result), /location_members|private diagnostic/)
    assert.equal(getAdminLocationContext(req), null)
    assert.equal(requireSeasonMembership(req).ok, false)
    const response = adminAuthErrorResponse(result)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  })

  it('requires attached enabled context; missing or mismatched context cannot bypass guards', async () => {
    const req = request()
    assert.equal(requireLocationMembership(req).ok, false)
    assert.equal(resolveLocationScopedAuthorizationFromContext({ locationModeEnabled: true }).ok, false)
    await attachAdminRequestContext(req, createDb(), identity, enabled)
    const ctx = getAdminContext(req), valid = structuredClone(ctx.locationContext)
    for (const corrupt of [
      scope => { scope.userId = 'another-user' },
      scope => { scope.activeSeasonId = 'season-2099' },
      scope => { scope.locationMembership.disabledAt = '2026-11-01' },
      scope => { scope.locationMembership.locationId = 'foreign-location' },
      scope => { scope.location.businessId = 'foreign-business' },
      scope => { scope.association.seasonId = 'season-2099' },
      scope => { scope.capabilities = null },
    ]) {
      ctx.locationContext = structuredClone(valid)
      corrupt(ctx.locationContext)
      assert.equal(requireSeasonMembership(req).ok, false)
      assert.equal(requireActiveSeason(req).ok, false)
    }
    ctx.locationContext = null
    assert.equal(requireWritableSeason(req).ok, false)
  })

  it('clears a previous scope when re-resolution fails', async () => {
    const req = request()
    assert.equal((await attachAdminRequestContext(req, createDb(), identity, enabled)).ok, true)
    assert.equal((await attachAdminRequestContext(req, createDb({ missingSchema: true }), identity, enabled)).ok, false)
    assert.equal(getAdminLocationContext(req), null)
    assert.equal(requireLocationMembership(req).ok, false)
  })

  it('requires explicit location selection when membership is ambiguous', async () => {
    const row = {
      season_user_id: 'u-1', member_season_id: seasonId, season_id: seasonId,
      season_role: 'owner', season_status: 'active', season_disabled_at: null,
      member_location_id: locationId,
    }
    const req = request({ location: null })
    const result = await attachAdminRequestContext(req, createDb({ locationRows: [row, { ...row, member_location_id: 'second-location' }] }), identity, enabled)
    assert.equal(result.status, 403)
    assert.equal(getAdminLocationContext(req), null)
  })

  it('permits the existing unambiguous 2026 selection in enabled mode', async () => {
    const req = request({ location: null })
    assert.equal((await attachAdminRequestContext(req, createDb(), identity, enabled)).ok, true)
    assert.equal(getAdminLocationContext(req).selection, 'legacy-2026')
  })

  for (const [seasonRole, locationRole, effective] of [
    ['owner', 'admin', 'admin'], ['admin', 'owner', 'admin'],
    ['owner', 'super_admin', 'super_admin'], ['super_admin', 'owner', 'super_admin'],
  ]) {
    it(`does not elevate ${seasonRole}/${locationRole} in existing or new role guards`, async () => {
      const req = request(), db = createDb({ seasonRole, locationRole, platformAdmin: true })
      assert.equal((await attachAdminRequestContext(req, db, identity, enabled)).ok, true)
      const auth = requireSeasonMembership(req).auth
      assert.equal(auth.seasonRole, effective)
      assert.equal(getAdminContext(req).seasonRole, seasonRole)
      assert.equal(requireSeasonRole(req, ['owner']).ok, false)
      assert.equal(requireLocationRole(req, ['owner']).ok, false)
      assert.equal(seasonAuthorizationAllows(auth, 'deleteAdminProducts'), false)
      assert.equal(seasonAuthorizationAllows(auth, 'viewSensitiveProductPricing'), effective === 'super_admin')
      assert.equal(requirePlatformAdmin(req).ok, true)
    })
  }

  for (const key of ['seasonStatus', 'locationStatus', 'associationStatus', 'businessStatus']) {
    it(`allows reads but rejects writes with archived ${key}`, async () => {
      const db = createDb({ [key]: 'archived' }), read = request()
      assert.equal((await requireAdmin(read, { DB: db, ...enabled })).ok, true)
      assert.equal(requireLocationMembership(read).ok, true)
      assert.equal(requireWritableLocation(read).ok, false)
      assert.equal(requireWritableSeason(read).ok, false)
      assert.equal(seasonAuthorizationAllows(requireSeasonMembership(read).auth, 'deleteAdminProducts'), false)
      const result = await requireAdmin(request({ method: 'PATCH' }), { DB: db, ...enabled })
      assert.equal(result.status, 403)
    })
  }

  it('preserves session inspection and platform-only authorization without location schema queries', async () => {
    for (const path of ['/api/admin/session', '/api/admin/platform/seasons']) {
      const db = createDb({ missingSchema: true, noSeasonMembership: true, platformAdmin: true }), req = request({ path })
      const result = await requireAdmin(req, { DB: db, ...enabled })
      assert.equal(result.ok, true)
      assert.equal(db.queries.includes(ADMIN_LOCATION_CONTEXT_SQL), false)
      assert.equal(getAdminLocationContext(req), null)
      assert.equal(requirePlatformAdmin(req).ok, true)
      assert.equal(requireSeasonMembership(req).ok, false)
    }
  })

  it('allows both selector headers in CORS preflights while preserving existing headers', () => {
    const headers = CORS_ALLOW_HEADERS.toLowerCase().split(',').map(h => h.trim())
    for (const header of ['x-admin-season-id', 'x-admin-location-id', 'content-type', 'idempotency-key', 'cf-access-jwt-assertion', 'cookie']) assert.ok(headers.includes(header))
    const req = new Request('https://example.test/api/admin/products', {
      method: 'OPTIONS', headers: { Origin: 'https://shop.test', 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'X-Admin-Season-Id, X-Admin-Location-Id' },
    })
    const response = handleCorsPreflight(req, new Set(['https://shop.test']))
    assert.equal(response.status, 204)
    assert.match(response.headers.get('Access-Control-Allow-Headers'), /X-Admin-Season-Id/)
    assert.match(response.headers.get('Access-Control-Allow-Headers'), /X-Admin-Location-Id/)
  })
})
