import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_USER_CREATE_ROLES,
  ADMIN_USER_EDIT_ROLES,
  adminRoleDisplayLabel,
  canManageAdminUsers,
  canViewSensitiveProductPricing,
  normalizeAdminRole,
} from './adminRoles.js'
import {
  showAdminProductCatalogueReferenceColumn,
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
    assert.equal(showAdminProductCatalogueReferenceColumn('owner'), true)
    assert.equal(showAdminProductCatalogueReferenceColumn('super_admin'), false)
    assert.equal(showAdminProductCatalogueReferenceColumn('admin'), false)
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

  it('grants user management nav only to owner', () => {
    assert.equal(canManageAdminUsers('owner'), true)
    assert.equal(canManageAdminUsers('super_admin'), false)
    assert.equal(canManageAdminUsers('admin'), false)
    assert.equal(canManageAdminUsers(''), false)
    assert.equal(canManageAdminUsers('guest'), false)
  })
})
