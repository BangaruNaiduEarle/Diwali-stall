import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adminDestination, adminRouteAccess, canAccessOwnerWorkspace, hasWorkspaceCapability,
  ownedWorkspaceLocations, resolveAdminLanding, resolveAdminLoginDestination } from './adminWorkspaceAccess.js'
import { parseAdminSessionPayload } from './adminSeasonSession.js'

const location = (id = 'stall-a', role = 'admin', season = 'season-2026') => ({
  business: { id: 'business-diwali', name: 'Diwali', type: 'seasonal', status: 'active' },
  location: { id, businessId: 'business-diwali', name: id, status: 'active' },
  operatingSeason: { id: season, label: season, status: 'active' },
  association: { locationId: id, seasonId: season, operatingYear: 2026, status: 'active' },
  seasonRole: 'owner', locationRole: role, effectiveRole: role,
  capabilities: { read: true, write: true, manageSeasonUsers: role !== 'admin' },
})
function session(rows = [location()], active = rows[0], extra = {}) {
  const parsed = parseAdminSessionPayload({ ok: true, email: 'user@example.test', role: 'owner', locationModeEnabled: true,
    activeSeasonId: active?.operatingSeason.id ?? 'season-2026', activeLocationId: active?.location.id ?? null,
    activeBusinessId: active?.business.id ?? null, effectiveRole: active?.effectiveRole, locationRole: active?.locationRole,
    seasonRole: 'owner', seasonStatus: 'active', authorizedLocations: rows,
    memberships: [{ seasonId: 'season-2026', role: 'owner', status: 'active' }], ...extra })
  assert.equal(parsed.ok, true)
  return { ...parsed, status: 'authenticated' }
}

test('central landing prioritizes platform, then authorized owners, then staff', () => {
  assert.equal(resolveAdminLanding(session([], null, { platformAdmin: true })), '/admin/platform')
  assert.equal(resolveAdminLanding(session([location('a', 'owner')])), '/admin/business')
  assert.equal(resolveAdminLanding(session()), '/admin/quick-bill')
  assert.equal(resolveAdminLanding(session([], null)), '/admin/context')
  assert.equal(resolveAdminLanding(session([location()], null)), '/admin/context')
})

test('mixed roles retain owner overview, staff operations and independent platform access', () => {
  const rows = [location('a', 'admin'), location('b', 'owner'), location('c', 'super_admin')]
  const mixed = session(rows, rows[0], { platformAdmin: true })
  assert.equal(resolveAdminLanding(mixed), '/admin/platform')
  assert.equal(adminRouteAccess(mixed, '/admin/business').allowed, true)
  assert.equal(adminRouteAccess(mixed, '/admin/quick-bill').allowed, true)
  assert.equal(adminRouteAccess(mixed, '/admin/users').allowed, false)
  assert.deepEqual(ownedWorkspaceLocations(mixed).map(row => row.location.id), ['b'])
  assert.equal(canAccessOwnerWorkspace(session([location()])), false)
})

test('direct operational URLs need an authorized active tuple; global or platform roles never bypass', () => {
  const platform = session([], null, { platformAdmin: true })
  for (const path of ['/admin/quick-bill', '/admin/products', '/admin/categories', '/admin/family-packs', '/admin/users', '/admin/customer-requests/CR001']) {
    assert.equal(adminRouteAccess(platform, path).allowed, false)
    assert.equal(adminRouteAccess(platform, path).reason, 'context_required')
  }
  assert.equal(adminRouteAccess(session(), '/admin/platform').allowed, false)
  assert.equal(adminRouteAccess(session(), '/admin/business').allowed, false)
  assert.equal(hasWorkspaceCapability({ ...session(), activeBusinessId: 'foreign' }, 'read'), false)
  assert.equal(hasWorkspaceCapability({ ...session(), activeLocationId: 'foreign' }, 'read'), false)
  assert.equal(hasWorkspaceCapability({ ...session(), activeSeasonId: 'season-2099' }, 'read'), false)
})

test('guards use confirmed read/write capabilities and preserve archived list access', () => {
  const row = location('a', 'owner')
  row.location.status = 'archived'
  row.capabilities.write = false
  const archived = session([row])
  for (const path of ['/admin/products', '/admin/family-packs', '/admin/users']) assert.equal(adminRouteAccess(archived, path).allowed, true)
  for (const path of ['/admin/products/new', '/admin/products/P001/edit', '/admin/family-packs/new', '/admin/family-packs/FP001/edit']) {
    assert.equal(adminRouteAccess(archived, path).allowed, false)
  }
  assert.equal(adminRouteAccess({ ...session(), capabilities: { read: false } }, '/admin/products').allowed, false)
  assert.equal(adminRouteAccess({ ...session(), seasonSwitching: true }, '/admin/products').reason, 'context_switching')
})

test('preserves valid internal deep links including query/hash, but rejects unauthorized or external redirects', () => {
  const staff = session()
  const path = '/admin/customer-requests/CR001?tab=bill#items'
  assert.equal(resolveAdminLoginDestination(staff, path), path)
  assert.equal(resolveAdminLoginDestination(staff, { pathname: '/admin/products', search: '?page=2', hash: '#list' }), '/admin/products?page=2#list')
  for (const path of ['https://evil.test/admin/products', '//evil.test/admin', '/admin/../public', '/admin/%2e%2e/products', '/admin\\products', '/admin/login', '/admin/unknown', '/api/admin', '/administrator', '/admin/products\n']) {
    assert.equal(adminDestination(path), null)
    assert.equal(resolveAdminLoginDestination(staff, path), '/admin/quick-bill')
  }
  for (const path of ['/admin/platform', '/admin/business', '/admin/users']) assert.equal(resolveAdminLoginDestination(staff, path), '/admin/quick-bill')
  assert.equal(resolveAdminLoginDestination(session([], null, { platformAdmin: true }), '/admin'), '/admin/platform')
})

test('missing, disabled or mismatched legacy memberships cannot inherit global owner authority', () => {
  const legacy = { status: 'authenticated', locationModeEnabled: false, role: 'owner', activeSeasonId: 'season-2026',
    seasonRole: 'admin', seasonStatus: 'active', memberships: [{ seasonId: 'season-2026', role: 'admin', status: 'active' }] }
  assert.equal(resolveAdminLanding(legacy), '/admin/quick-bill')
  assert.equal(adminRouteAccess(legacy, '/admin/products/P001/edit').allowed, true)
  assert.equal(adminRouteAccess(legacy, '/admin/users').allowed, false)
  const owner = { ...legacy, seasonRole: 'owner', memberships: [{ ...legacy.memberships[0], role: 'owner' }] }
  assert.equal(resolveAdminLanding(owner), '/admin/business')
  assert.equal(adminRouteAccess(owner, '/admin/users').allowed, true)
  for (const memberships of [[], [{ ...owner.memberships[0], membershipDisabled: true }], [{ ...owner.memberships[0], seasonId: 'other' }], [{ ...owner.memberships[0], role: 'invalid' }]]) {
    const denied = { ...owner, memberships }
    assert.equal(resolveAdminLanding(denied), '/admin/context')
    assert.equal(adminRouteAccess(denied, '/admin/products').allowed, false)
  }
})

test('authentication and unknown-route checks fail closed while the context page remains reachable', () => {
  assert.equal(resolveAdminLanding({ ...session(), status: 'denied', platformAdmin: true }), '/admin/login')
  assert.equal(adminRouteAccess({ ...session(), status: 'denied' }, '/admin/business').reason, 'auth_required')
  assert.equal(adminRouteAccess(session(), '/admin/unknown').reason, 'unknown_route')
  assert.equal(adminRouteAccess(session([], null), '/admin/context').allowed, true)
})

test('context selection can resume a valid deep link after server confirmation', () => {
  const requested = '/admin/customer-requests/CR001?tab=bill'
  const rows = [location()]
  assert.equal(resolveAdminLoginDestination(session(rows, null), requested), '/admin/context')
  assert.equal(resolveAdminLoginDestination(session(rows), requested), requested)
})
