import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  resolveSeasonScopedAuthorizationFromContext,
  seasonAuthorizationAllows,
  seasonAuthorizationCapabilities,
} from '../src/lib/adminSeasonAuthorization.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

/** @param {Partial<import('../src/services/adminSeasonContext.js').AdminSeasonContext>} overrides */
function context(overrides) {
  return /** @type {import('../src/services/adminSeasonContext.js').AdminSeasonContext} */ ({
    userId: 'u-1',
    platformAdmin: false,
    activeSeasonId: DEFAULT_ADMIN_SEASON_ID,
    seasonRole: 'admin',
    memberships: [],
    ...overrides,
  })
}

describe('adminSeasonAuthorization', () => {
  it('fails closed when context is missing', () => {
    const result = resolveSeasonScopedAuthorizationFromContext(null)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
    assert.equal(result.code, 'forbidden')
    assert.equal(result.platformAdmin, false)
  })

  it('fails closed when active season is missing', () => {
    const result = resolveSeasonScopedAuthorizationFromContext(
      context({ activeSeasonId: null, seasonRole: 'owner' }),
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.message, /season/i)
  })

  it('fails closed when season membership role is missing', () => {
    const result = resolveSeasonScopedAuthorizationFromContext(
      context({ seasonRole: null, activeSeasonId: DEFAULT_ADMIN_SEASON_ID }),
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.message, /membership/i)
  })

  it('fails closed on invalid season role values', () => {
    const bad = context({ seasonRole: 'admin' })
    bad.seasonRole = /** @type {typeof bad.seasonRole} */ (/** @type {unknown} */ ('root'))
    const result = resolveSeasonScopedAuthorizationFromContext(bad)
    assert.equal(result.ok, false)
  })

  it('platform admin without membership does not receive owner season permissions', () => {
    const result = resolveSeasonScopedAuthorizationFromContext(
      context({
        platformAdmin: true,
        activeSeasonId: null,
        seasonRole: null,
      }),
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.platformAdmin, true)
    assert.equal(seasonAuthorizationAllows(result, 'deleteAdminProducts'), false)
    assert.equal(seasonAuthorizationAllows(result, 'viewSensitiveProductPricing'), false)
  })

  it('owner season role receives full season capabilities', () => {
    const result = resolveSeasonScopedAuthorizationFromContext(context({ seasonRole: 'owner' }))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.seasonRole, 'owner')
    assert.equal(result.platformAdmin, false)
    const caps = seasonAuthorizationCapabilities(result)
    assert.equal(caps.viewSensitiveProductPricing, true)
    assert.equal(caps.finalizeQuickBillCustomerRequests, true)
    assert.equal(caps.assignQuickBillCustomerRequests, true)
    assert.equal(caps.deleteAdminProducts, true)
    assert.equal(caps.manageSeasonUsers, true)
  })

  it('super_admin season role matches sensitive and finalize but not product delete', () => {
    const result = resolveSeasonScopedAuthorizationFromContext(context({ seasonRole: 'super_admin' }))
    assert.equal(result.ok, true)
    if (!result.ok) return
    const caps = seasonAuthorizationCapabilities(result)
    assert.equal(caps.viewSensitiveProductPricing, true)
    assert.equal(caps.finalizeQuickBillCustomerRequests, true)
    assert.equal(caps.assignQuickBillCustomerRequests, true)
    assert.equal(caps.deleteAdminProducts, false)
    assert.equal(caps.manageSeasonUsers, true)
  })

  it('admin season role is daily operations only', () => {
    const result = resolveSeasonScopedAuthorizationFromContext(context({ seasonRole: 'admin' }))
    assert.equal(result.ok, true)
    if (!result.ok) return
    const caps = seasonAuthorizationCapabilities(result)
    assert.equal(caps.viewSensitiveProductPricing, false)
    assert.equal(caps.finalizeQuickBillCustomerRequests, false)
    assert.equal(caps.assignQuickBillCustomerRequests, true)
    assert.equal(caps.deleteAdminProducts, false)
    assert.equal(caps.manageSeasonUsers, false)
  })

  it('uses seasonRole per active season when memberships differ across seasons', () => {
    const season2026 = context({
      activeSeasonId: DEFAULT_ADMIN_SEASON_ID,
      seasonRole: 'owner',
      memberships: [
        {
          seasonId: DEFAULT_ADMIN_SEASON_ID,
          code: '2026',
          label: '2026',
          status: 'active',
          role: 'owner',
          disabled: false,
          createdAt: '2026-01-01',
        },
        {
          seasonId: 'season-2027',
          code: '2027',
          label: '2027',
          status: 'active',
          role: 'admin',
          disabled: false,
          createdAt: '2026-01-02',
        },
      ],
    })
    const season2027 = context({
      activeSeasonId: 'season-2027',
      seasonRole: 'admin',
      memberships: season2026.memberships,
    })

    const auth2026 = resolveSeasonScopedAuthorizationFromContext(season2026)
    const auth2027 = resolveSeasonScopedAuthorizationFromContext(season2027)
    assert.equal(auth2026.ok, true)
    assert.equal(auth2027.ok, true)
    if (!auth2026.ok || !auth2027.ok) return

    assert.equal(seasonAuthorizationAllows(auth2026, 'deleteAdminProducts'), true)
    assert.equal(seasonAuthorizationAllows(auth2027, 'deleteAdminProducts'), false)
    assert.equal(seasonAuthorizationAllows(auth2026, 'viewSensitiveProductPricing'), true)
    assert.equal(seasonAuthorizationAllows(auth2027, 'viewSensitiveProductPricing'), false)
  })

  it('platform admin with season membership uses seasonRole only for capabilities', () => {
    const result = resolveSeasonScopedAuthorizationFromContext(
      context({
        platformAdmin: true,
        seasonRole: 'admin',
      }),
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.platformAdmin, true)
    assert.equal(seasonAuthorizationAllows(result, 'deleteAdminProducts'), false)
    assert.equal(seasonAuthorizationAllows(result, 'assignQuickBillCustomerRequests'), true)
  })
})
