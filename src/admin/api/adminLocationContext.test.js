import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { parseAdminSessionPayload, adminOperationalContextKey } from '../lib/adminSeasonSession.js'
import { performAdminSeasonSwitch } from '../lib/adminSeasonSelector.js'
import { clearAdminActiveSeasonId, setAdminActiveSeasonId, setAdminLocationSelection, setAdminContextSwitching,
  getAdminRequestContext } from './adminSeasonRequest.js'
import { apiRequest } from './client.js'
import { checkoutQuickBill } from './adminApi.js'
import { createQuickBillRetryKeys } from '../lib/quickBillCheckoutKey.js'

const originalFetch = globalThis.fetch
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const season = 'season-2026'
function authorized(id = 'stall-a', role = 'owner', seasonId = season) {
  return { business: { id: `business-${id}`, name: `Business ${id}`, type: 'seasonal', status: 'active' },
    location: { id, businessId: `business-${id}`, name: `Stall ${id}`, status: 'active' },
    operatingSeason: { id: seasonId, label: seasonId, status: 'active' },
    association: { locationId: id, seasonId, operatingYear: 2026, status: 'active' },
    seasonRole: 'owner', locationRole: role, effectiveRole: role,
    capabilities: { read: true, write: true, viewSensitiveProductPricing: role !== 'admin', manageSeasonUsers: role !== 'admin' } }
}
const locations = [authorized(), authorized('stall-b', 'admin')]
function session(id = 'stall-a', overrides = {}) {
  const row = locations.find(row => row.location.id === id)
  return { ok: true, email: 'owner@example.test', role: 'owner', userId: 'u1', activeSeasonId: season,
    seasonRole: 'owner', seasonStatus: 'active', memberships: [{ seasonId: season, role: 'owner' }],
    locationModeEnabled: true, activeLocationId: id, activeBusinessId: row?.business.id ?? null,
    locationRole: row?.locationRole ?? null, effectiveRole: row?.effectiveRole ?? null, authorizedLocations: locations, ...overrides }
}
function select(id = 'stall-a') {
  setAdminActiveSeasonId(season)
  setAdminLocationSelection({ locationModeEnabled: true, activeLocationId: id, activeBusinessId: `business-${id}` })
}
function switchInput(overrides = {}) {
  return { seasonId: season, locationId: 'stall-b', locationModeEnabled: true, authorizedLocations: locations,
    memberships: [{ seasonId: season, role: 'owner' }], platformAdmin: false,
    previousSeasonId: season, previousLocationId: 'stall-a', previousBusinessId: 'business-stall-a',
    setSeasonHeader: setAdminActiveSeasonId, setLocationHeader: setAdminLocationSelection,
    fetchSession: async () => parseAdminSessionPayload(session(getAdminRequestContext().activeLocationId)), ...overrides }
}
beforeEach(() => clearAdminActiveSeasonId())
afterEach(() => { clearAdminActiveSeasonId(); globalThis.fetch = originalFetch })

describe('location-aware session parsing', () => {
  it('retains authorized metadata, lower effective role and capabilities', () => {
    const parsed = parseAdminSessionPayload(session('stall-b'))
    assert.equal(parsed.ok, true)
    assert.equal(parsed.seasonRole, 'owner')
    assert.equal(parsed.effectiveRole, 'admin')
    assert.equal(parsed.business.id, 'business-stall-b')
    assert.equal(parsed.location.id, 'stall-b')
    assert.equal(parsed.capabilities.viewSensitiveProductPricing, false)
    assert.equal(parsed.authorizedLocations.length, 2)
  })
  it('requires selection instead of inventing an active stall', () => {
    const parsed = parseAdminSessionPayload(session(null))
    assert.equal(parsed.ok, true)
    assert.equal(parsed.activeLocationId, null)
    assert.equal(parsed.locationSelectionRequired, true)
  })
  for (const [name, change] of [
    ['unauthorized location', { activeLocationId: 'foreign' }],
    ['mismatched business', { activeBusinessId: 'foreign-business' }],
    ['elevated effective role', { effectiveRole: 'owner' }],
  ]) it(`rejects ${name}`, () => assert.equal(parseAdminSessionPayload(session('stall-b', change)).ok, false))
  it('rejects ambiguous and malformed authorized tuples', () => {
    for (const bad of [{ ...locations[0], location: { ...locations[0].location, businessId: 'foreign' } },
      { ...locations[0], seasonRole: 'invalid' }, { ...locations[0], capabilities: { read: false } }]) {
      assert.equal(parseAdminSessionPayload(session('stall-a', { authorizedLocations: [bad] })).ok, false)
    }
    assert.equal(parseAdminSessionPayload(session('stall-a', { authorizedLocations: [locations[0], locations[0]] })).ok, false)
  })
  it('forces archived parent/association scopes read-only', () => {
    const row = { ...locations[0], business: { ...locations[0].business, status: 'archived' } }
    assert.equal(parseAdminSessionPayload(session('stall-a', { authorizedLocations: [row] })).capabilities.write, false)
  })
  it('ignores location fields with the server gate OFF', () => {
    const parsed = parseAdminSessionPayload(session('foreign', { locationModeEnabled: false }))
    assert.equal(parsed.ok, true)
    assert.equal(parsed.locationModeEnabled, false)
    assert.deepEqual(parsed.authorizedLocations, [])
    assert.equal(parsed.activeLocationId, null)
    assert.equal(parsed.locationSelectionRequired, false)
  })
  it('changes the reset key for stall/season/permission changes but keeps gate-OFF behavior', () => {
    const a = parseAdminSessionPayload(session()), b = parseAdminSessionPayload(session('stall-b'))
    assert.notEqual(adminOperationalContextKey(a), adminOperationalContextKey(b))
    assert.notEqual(adminOperationalContextKey(a), adminOperationalContextKey({ ...a, activeSeasonId: 'another-season' }))
    assert.notEqual(adminOperationalContextKey(a), adminOperationalContextKey({ ...a, effectiveRole: 'admin' }))
    assert.equal(adminOperationalContextKey({ ...a, locationModeEnabled: false }), adminOperationalContextKey({ ...b, locationModeEnabled: false }))
  })
})

describe('existing season switch extended to authorized stalls', () => {
  it('keeps a server-confirmed cross-business selection', async () => {
    select()
    const result = await performAdminSeasonSwitch(switchInput())
    assert.equal(result.ok, true)
    assert.equal(result.session.activeLocationId, 'stall-b')
    assert.equal(getAdminRequestContext().activeBusinessId, 'business-stall-b')
  })
  it('rejects unauthorized selection locally without fetching or changing headers', async () => {
    select(); const before = getAdminRequestContext()
    const result = await performAdminSeasonSwitch(switchInput({ locationId: 'foreign', fetchSession: () => assert.fail('must not fetch') }))
    assert.equal(result.code, 'invalid_location')
    assert.deepEqual(getAdminRequestContext(), before)
  })
  for (const failure of ['denied', 'mismatch', 'network']) it(`restores both headers and verifies previous scope after ${failure}`, async () => {
    select(); let calls = 0
    const result = await performAdminSeasonSwitch(switchInput({ fetchSession: async () => {
      if (++calls === 1) {
        if (failure === 'network') throw Error('offline')
        return failure === 'denied' ? { ok: false, status: 403 } : parseAdminSessionPayload(session('stall-a'))
      }
      return parseAdminSessionPayload(session('stall-a'))
    } }))
    assert.equal(result.ok, false)
    assert.equal(result.restoredSession.activeLocationId, 'stall-a')
    assert.equal(getAdminRequestContext().activeLocationId, 'stall-a')
    assert.equal(getAdminRequestContext().activeSeasonId, season)
  })
  it('reports an unverifiable restoration instead of trusting old session data', async () => {
    select()
    const result = await performAdminSeasonSwitch(switchInput({ fetchSession: async () => ({ ok: false }) }))
    assert.equal(result.attempted, true)
    assert.equal(result.restoredSession, null)
  })
  it('does not restore headers after logout invalidates the switch', async () => {
    select(); let current = true
    const result = await performAdminSeasonSwitch(switchInput({ isCurrent: () => current, fetchSession: async () => {
      current = false; clearAdminActiveSeasonId(); return { ok: false }
    } }))
    assert.equal(result.code, 'stale_context')
    assert.equal(getAdminRequestContext().activeLocationId, null)
  })
  it('selects an authorized location when moving to a season with a single stall', async () => {
    select()
    const row = authorized('stall-next', 'admin', 'season-next')
    const result = await performAdminSeasonSwitch(switchInput({ seasonId: 'season-next', locationId: undefined,
      memberships: [{ seasonId: 'season-next' }], authorizedLocations: [row], fetchSession: async () => ({ ok: true,
        locationModeEnabled: true, activeSeasonId: 'season-next', activeLocationId: 'stall-next', activeBusinessId: row.business.id, authorizedLocations: [row] }) }))
    assert.equal(result.ok, true)
    assert.equal(getAdminRequestContext().activeLocationId, 'stall-next')
  })
})

describe('scoped API requests and stale response rejection', () => {
  it('adds trusted season/location headers and keeps platform/auth requests location-free', async () => {
    select(); const seen = []
    globalThis.fetch = async (url, init) => { seen.push([url, new Headers(init.headers), init.credentials]); return json({}) }
    for (const path of ['/api/admin/products', '/api/admin/session', '/api/admin/platform/seasons', '/api/admin/auth/logout']) {
      await apiRequest(path, { headers: { 'X-Admin-Location-Id': 'foreign' } })
    }
    assert.equal(seen[0][1].get('X-Admin-Location-Id'), 'stall-a')
    assert.equal(seen[1][1].get('X-Admin-Location-Id'), 'stall-a')
    assert.equal(seen[2][1].has('X-Admin-Location-Id'), false)
    assert.equal(seen[2][1].has('X-Admin-Season-Id'), false)
    assert.equal(seen[3][1].has('X-Admin-Location-Id'), false)
    assert.ok(seen.every(row => row[2] === 'include'))
  })
  it('keeps gate-OFF requests season-only', async () => {
    setAdminActiveSeasonId(season)
    globalThis.fetch = async (_url, init) => {
      assert.equal(new Headers(init.headers).get('X-Admin-Season-Id'), season)
      assert.equal(new Headers(init.headers).has('X-Admin-Location-Id'), false)
      return json({})
    }
    assert.equal((await apiRequest('/api/admin/products')).ok, true)
  })
  it('blocks operational requests while selecting or switching, including mutations', async () => {
    setAdminActiveSeasonId(season); setAdminLocationSelection({ locationModeEnabled: true })
    globalThis.fetch = () => assert.fail('must not send operational requests')
    assert.equal((await apiRequest('/api/admin/products')).error, 'location_context_required')
    select(); setAdminContextSwitching(true)
    assert.equal((await apiRequest('/api/admin/quick-bill/checkout', { method: 'POST' })).error, 'location_context_required')
  })
  for (const action of ['switch', 'logout', 'failed-switch']) it(`discards an old-location response after ${action}`, async () => {
    select(); let resolve
    globalThis.fetch = () => new Promise(done => { resolve = done })
    const pending = apiRequest('/api/admin/products')
    setAdminContextSwitching(true)
    if (action === 'logout') clearAdminActiveSeasonId()
    else { select('stall-b'); if (action === 'failed-switch') select('stall-a'); setAdminContextSwitching(false) }
    resolve(json({ products: [{ id: 'OLD-LOCATION' }] }))
    const result = await pending
    assert.equal(result.error, 'stale_context')
    assert.equal(result.data, undefined)
  })
  it('checks generation after reading a delayed response body, not just after fetch', async () => {
    select(); let finish
    globalThis.fetch = async () => ({ ok: true, status: 200, text: () => new Promise(resolve => { finish = resolve }) })
    const request = apiRequest('/api/admin/users')
    await Promise.resolve()
    select('stall-b')
    finish('{"users":[{"id":"old"}]}')
    assert.equal((await request).error, 'stale_context')
  })
})

describe('Quick Bill checkout retry keys', () => {
  const payload = { customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 1 }] }
  it('keeps one key for retries and rotates on changed bill, context, or successful completion', () => {
    let count = 0
    const keys = createQuickBillRetryKeys(() => `key-${++count}`)
    assert.equal(keys.forCheckout(payload, 'a'), 'key-1')
    assert.equal(keys.forCheckout(structuredClone(payload), 'a'), 'key-1')
    assert.equal(keys.forCheckout({ ...payload, customer: { ...payload.customer, name: 'Another' } }, 'a'), 'key-2')
    assert.equal(keys.forCheckout(payload, 'b'), 'key-3')
    keys.complete()
    assert.equal(keys.forCheckout(payload, 'b'), 'key-4')
  })
  it('sends the same key after an ambiguous failure and preserves replay information', async () => {
    select(); const headers = []; let calls = 0
    const keys = createQuickBillRetryKeys(() => 'retry-key')
    globalThis.fetch = async (_url, init) => {
      headers.push(new Headers(init.headers))
      return ++calls === 1 ? json({ error: 'checkout_failed' }, 503) : json({ request: { id: 'r1' }, quotation: { id: 'q1' }, idempotentReplay: true })
    }
    assert.equal((await checkoutQuickBill(payload, { idempotencyKey: keys.forCheckout(payload, 'a') })).ok, false)
    const retry = await checkoutQuickBill(payload, { idempotencyKey: keys.forCheckout(payload, 'a') })
    assert.equal(retry.idempotentReplay, true)
    assert.deepEqual(headers.map(h => h.get('Idempotency-Key')), ['retry-key', 'retry-key'])
    assert.ok(headers.every(h => h.get('X-Admin-Location-Id') === 'stall-a'))
  })
})
