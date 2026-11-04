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
export function canAssignQuickBillCustomerRequests(role) {
  const r = normalizeAdminRole(role)
  return r === 'admin' || r === 'owner' || r === 'super_admin'
}

/** @param {unknown} role */
export function canFinalizeQuickBillCustomerRequests(role) {
  return canViewSensitiveProductPricing(role)
}

/** @param {unknown} role */
export function adminRoleDisplayLabel(role) {
  const r = normalizeAdminRole(role)
  if (r === 'owner') return 'Owner'
  if (r === 'super_admin') return 'Super Admin'
  return 'Admin'
}

/**
 * Owner-only: legacy global `admin_users.role` gate (deprecated for season UI).
 * @deprecated Use `canManageSeasonUsers(seasonRole)` for Users page access.
 * @param {unknown} role
 */
export function canManageAdminUsers(role) {
  return normalizeAdminRole(role) === 'owner'
}

/** Owner or Super Admin: view Users list and invite members (matches GET/POST /api/admin/users gate). */
/** @param {unknown} role */
export function canManageSeasonUsers(role) {
  const r = normalizeAdminRole(role)
  return r === 'owner' || r === 'super_admin'
}

/** Owner-only: change season member role, disable, enable, reset password. */
/** @param {unknown} actorSeasonRole */
export function canChangeSeasonMemberRoles(actorSeasonRole) {
  return normalizeAdminRole(actorSeasonRole) === 'owner'
}

/** @param {unknown} role @returns {AdminRole | null} */
export function strictParseAdminRole(role) {
  const r = String(role ?? '').trim().toLowerCase()
  if (r === 'owner' || r === 'super_admin' || r === 'admin') {
    return /** @type {AdminRole} */ (r)
  }
  return null
}

/**
 * @param {unknown} actorSeasonRole
 * @param {unknown} targetRole
 */
export function canCreateSeasonMemberWithRole(actorSeasonRole, targetRole) {
  const target = strictParseAdminRole(targetRole)
  if (!target || target === 'owner') return false
  const actor = normalizeAdminRole(actorSeasonRole)
  if (actor === 'owner') return target === 'super_admin' || target === 'admin'
  if (actor === 'super_admin') return target === 'admin'
  return false
}

export function canGrantLocationMemberRole(actorRole, targetRole) {
  const actor = strictParseAdminRole(actorRole), target = strictParseAdminRole(targetRole)
  return Boolean(target && (actor === 'owner' || (actor === 'super_admin' && target === 'admin')))
}

/** Owner-only: permanent product deletion. */
/** @param {unknown} role */
export function canDeleteAdminProducts(role) {
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
