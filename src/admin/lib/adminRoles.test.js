import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_USER_CREATE_ROLES,
  ADMIN_USER_EDIT_ROLES,
  adminRoleDisplayLabel,
  canDeleteAdminProducts,
  canManageAdminUsers,
  canManageSeasonUsers,
  canViewSensitiveProductPricing,
  normalizeAdminRole,
} from './adminRoles.js'
import {
  showAdminProductMappingColumn,
  showAdminProductSensitiveColumns,
  showAdminProductUnitColumn,
} from './adminProductTableColumns.js'

describe('adminRoles (frontend)', () => {
  it('normalizes roles and defaults unknown to admin', () => {
    assert.equal(normalizeAdminRole('super_admin'), 'super_admin')
    assert.equal(normalizeAdminRole('bogus'), 'admin')
  })

  it('controls sensitive product table columns by role', () => {
    assert.equal(showAdminProductSensitiveColumns('owner'), true)
    assert.equal(showAdminProductSensitiveColumns('super_admin'), true)
    assert.equal(showAdminProductSensitiveColumns('admin'), false)
    assert.equal(showAdminProductSensitiveColumns(undefined), false)
    assert.equal(showAdminProductUnitColumn('admin'), false)
    assert.equal(showAdminProductMappingColumn('admin'), false)
    assert.equal(canViewSensitiveProductPricing('guest'), false)
  })

  it('labels roles for display', () => {
    assert.equal(adminRoleDisplayLabel('owner'), 'Owner')
    assert.equal(adminRoleDisplayLabel('super_admin'), 'Super Admin')
    assert.equal(adminRoleDisplayLabel('admin'), 'Admin')
  })

  it('exposes create and edit role option lists', () => {
    assert.deepEqual(ADMIN_USER_CREATE_ROLES, ['admin', 'super_admin'])
    assert.deepEqual(ADMIN_USER_EDIT_ROLES, ['admin', 'super_admin', 'owner'])
  })

  it('grants legacy user management nav only to global owner role', () => {
    assert.equal(canManageAdminUsers('owner'), true)
    assert.equal(canManageAdminUsers('super_admin'), false)
    assert.equal(canManageAdminUsers('admin'), false)
    assert.equal(canManageAdminUsers(''), false)
    assert.equal(canManageAdminUsers('guest'), false)
  })

  it('grants season Users access to owner and super_admin season roles', () => {
    assert.equal(canManageSeasonUsers('owner'), true)
    assert.equal(canManageSeasonUsers('super_admin'), true)
    assert.equal(canManageSeasonUsers('admin'), false)
  })

  it('grants product delete only to owner', () => {
    assert.equal(canDeleteAdminProducts('owner'), true)
    assert.equal(canDeleteAdminProducts('super_admin'), false)
    assert.equal(canDeleteAdminProducts('admin'), false)
  })
})
