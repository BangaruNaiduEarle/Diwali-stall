/** @typedef {'owner' | 'super_admin' | 'admin'} AdminRole */

/** @param {unknown} role */
export function normalizeAdminRole(role) {
  const r = String(role ?? '').trim().toLowerCase()
  if (r === 'owner') return /** @type {AdminRole} */ ('owner')
  if (r === 'super_admin') return /** @type {AdminRole} */ ('super_admin')
  if (r === 'admin') return /** @type {AdminRole} */ ('admin')
  return /** @type {AdminRole} */ ('admin')
}

/** @param {unknown} role */
export function canViewSensitiveProductPricing(role) {
  const r = normalizeAdminRole(role)
  return r === 'owner' || r === 'super_admin'
}

/** @param {unknown} role */
export function adminRoleDisplayLabel(role) {
  const r = normalizeAdminRole(role)
  if (r === 'owner') return 'Owner'
  if (r === 'super_admin') return 'Super Admin'
  return 'Admin'
}

/** Owner-only: user management (not granted to super_admin). */
/** @param {unknown} role */
export function canManageAdminUsers(role) {
  return normalizeAdminRole(role) === 'owner'
}

/** Roles assignable when creating a user (owner must be promoted). */
export const ADMIN_USER_CREATE_ROLES = /** @type {const} */ (['admin', 'super_admin'])

/** Roles editable on the Users page. */
export const ADMIN_USER_EDIT_ROLES = /** @type {const} */ (['admin', 'super_admin', 'owner'])

/** @param {AdminRole} role */
export function adminUserRoleSelectLabel(role) {
  return adminRoleDisplayLabel(role)
}
