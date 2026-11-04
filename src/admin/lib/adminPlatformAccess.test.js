import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canAccessPlatformAdminDashboard,
  platformDashboardAccessBlockReason,
  shouldShowPlatformAdminNav,
} from './adminPlatformAccess.js'

describe('adminPlatformAccess', () => {
  it('allows dashboard access only for platformAdmin session flag', () => {
    assert.equal(canAccessPlatformAdminDashboard({ platformAdmin: true }), true)
    assert.equal(canAccessPlatformAdminDashboard({ platformAdmin: false }), false)
    assert.equal(canAccessPlatformAdminDashboard({}), false)
  })

  it('does not grant platform access from legacy owner or super_admin role alone', () => {
    assert.equal(
      canAccessPlatformAdminDashboard({ platformAdmin: false, role: 'owner' }),
      false,
    )
    assert.equal(
      canAccessPlatformAdminDashboard({ platformAdmin: false, role: 'super_admin' }),
      false,
    )
    assert.equal(platformDashboardAccessBlockReason({ status: 'authenticated', platformAdmin: false }), 'platform_admin_required')
  })

  it('allows platform admin without season membership', () => {
    const session = {
      status: 'authenticated',
      platformAdmin: true,
      activeSeasonId: null,
      memberships: [],
    }
    assert.equal(canAccessPlatformAdminDashboard(session), true)
    assert.equal(platformDashboardAccessBlockReason(session), null)
  })

  it('shows Platform nav only for platform admins', () => {
    assert.equal(shouldShowPlatformAdminNav({ platformAdmin: true }), true)
    assert.equal(shouldShowPlatformAdminNav({ platformAdmin: false }), false)
    assert.equal(shouldShowPlatformAdminNav({ platformAdmin: false, role: 'owner' }), false)
  })

  it('requires authenticated session before platform dashboard', () => {
    assert.equal(
      platformDashboardAccessBlockReason({ status: 'loading', platformAdmin: true }),
      'auth_required',
    )
    assert.equal(
      platformDashboardAccessBlockReason({ status: 'denied', platformAdmin: true }),
      'auth_required',
    )
  })
})
