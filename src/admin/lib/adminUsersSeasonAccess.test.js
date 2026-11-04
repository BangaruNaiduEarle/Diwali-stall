import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canManageAdminUsers, canManageSeasonUsers } from './adminRoles.js'
import {
  canShowAdminUserCreateForm,
  canShowAdminUserOwnerActions,
  canViewAdminUsersPage,
  creatableAdminUserRoles,
  adminUserAssignmentPayload,
} from './adminUsersSeasonAccess.js'

describe('adminUsersSeasonAccess', () => {
  it('allows owner and super_admin seasonRole to view Users page', () => {
    assert.equal(canViewAdminUsersPage('owner'), true)
    assert.equal(canViewAdminUsersPage('super_admin'), true)
    assert.equal(canViewAdminUsersPage('admin'), false)
  })

  it('ignores legacy global owner role when seasonRole is admin', () => {
    assert.equal(canManageAdminUsers('owner'), true)
    assert.equal(canViewAdminUsersPage('admin'), false)
  })

  it('allows super_admin seasonRole despite legacy admin role mismatch', () => {
    assert.equal(canManageAdminUsers('admin'), false)
    assert.equal(canViewAdminUsersPage('super_admin'), true)
  })

  it('restricts owner-only actions to season owner', () => {
    assert.equal(canShowAdminUserOwnerActions('owner', false), true)
    assert.equal(canShowAdminUserOwnerActions('super_admin', false), false)
    assert.equal(canShowAdminUserOwnerActions('admin', false), false)
  })

  it('hides create and owner actions in archived read-only season', () => {
    assert.equal(canShowAdminUserCreateForm('owner', true), false)
    assert.equal(canShowAdminUserCreateForm('super_admin', true), false)
    assert.equal(canShowAdminUserOwnerActions('owner', true), false)
    assert.equal(canViewAdminUsersPage('owner'), true)
  })

  it('filters creatable roles by actor season role', () => {
    assert.deepEqual(creatableAdminUserRoles('owner'), ['admin', 'super_admin'])
    assert.deepEqual(creatableAdminUserRoles('super_admin'), ['admin'])
    assert.deepEqual(creatableAdminUserRoles('admin'), [])
  })

  it('allows all stall roles for Owners and only Admin for Super Admins without changing legacy policy', () => {
    assert.deepEqual(creatableAdminUserRoles('owner', true), ['admin', 'super_admin', 'owner'])
    assert.deepEqual(creatableAdminUserRoles('super_admin', true), ['admin'])
    assert.deepEqual(creatableAdminUserRoles('admin', true), [])
    assert.deepEqual(creatableAdminUserRoles('platform_admin', true), [])
    assert.deepEqual(creatableAdminUserRoles('owner', false), ['admin', 'super_admin'])
  })

  it('omits credentials for an existing login and marks the request as existing-only', () => {
    const form = { email: 'member@test.com', role: 'owner', password: 'must-not-be-sent', displayName: 'Ignored' }
    assert.deepEqual(adminUserAssignmentPayload(form, true, true), { email: form.email, role: 'owner', existingOnly: true })
    assert.deepEqual(adminUserAssignmentPayload(form, true, false), { ...form, existingOnly: false })
    assert.deepEqual(adminUserAssignmentPayload(form, false, true), form)
  })

  it('canManageSeasonUsers matches list API gate only', () => {
    assert.equal(canManageSeasonUsers('owner'), true)
    assert.equal(canManageSeasonUsers('super_admin'), true)
    assert.equal(canManageSeasonUsers('admin'), false)
  })
})
