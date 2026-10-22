import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canManageAdminUsers,
  canViewSensitiveProductPricing,
  normalizeAdminRole,
  strictParseAdminRole,
} from '../src/lib/adminRoles.js'

describe('adminRoles', () => {
  it('normalizes known roles', () => {
    assert.equal(normalizeAdminRole('owner'), 'owner')
    assert.equal(normalizeAdminRole('SUPER_ADMIN'), 'super_admin')
    assert.equal(normalizeAdminRole('admin'), 'admin')
  })

  it('strictParseAdminRole accepts only known roles', () => {
    assert.equal(strictParseAdminRole('owner'), 'owner')
    assert.equal(strictParseAdminRole('super_admin'), 'super_admin')
    assert.equal(strictParseAdminRole('admin'), 'admin')
    assert.equal(strictParseAdminRole('root'), null)
    assert.equal(strictParseAdminRole(''), null)
  })

  it('maps unknown or missing roles to restrictive admin', () => {
    assert.equal(normalizeAdminRole(''), 'admin')
    assert.equal(normalizeAdminRole('guest'), 'admin')
    assert.equal(normalizeAdminRole(null), 'admin')
  })

  it('grants sensitive product pricing only to owner and super_admin', () => {
    assert.equal(canViewSensitiveProductPricing('owner'), true)
    assert.equal(canViewSensitiveProductPricing('super_admin'), true)
    assert.equal(canViewSensitiveProductPricing('admin'), false)
    assert.equal(canViewSensitiveProductPricing('unknown'), false)
  })

  it('grants user management only to owner', () => {
    assert.equal(canManageAdminUsers('owner'), true)
    assert.equal(canManageAdminUsers('super_admin'), false)
    assert.equal(canManageAdminUsers('admin'), false)
  })
})
