/** @typedef {'owner' | 'super_admin' | 'admin'} AdminRole */

const ADMIN_ROLES = /** @type {const} */ (['owner', 'super_admin', 'admin'])
export { canUpdateAdminMemberRole } from '../../../src/shared/adminUserRolePolicy.js'

/** @param {unknown} role @returns {AdminRole | null} */
export function strictParseAdminRole(role) {
  const r = String(role ?? '').trim().toLowerCase()
  if (r === 'owner' || r === 'super_admin' || r === 'admin') {
    return /** @type {AdminRole} */ (r)
  }
  return null
}

/** @param {unknown} role */
export function normalizeAdminRole(role) {
  const r = String(role ?? '').trim().toLowerCase()
  if (r === 'owner') return /** @type {AdminRole} */ ('owner')
  if (r === 'super_admin') return /** @type {AdminRole} */ ('super_admin')
  if (r === 'admin') return /** @type {AdminRole} */ ('admin')
  return /** @type {AdminRole} */ ('admin')
}

/** Owner and super_admin see purchase price and catalogue reference in admin product UI/API. */
/** @param {unknown} role */
export function canViewSensitiveProductPricing(role) {
  const r = normalizeAdminRole(role)
  return r === 'owner' || r === 'super_admin'
}

/** Admin, Owner, and Super Admin can assign pending manual Quick Bill requests. */
/** @param {unknown} role */
export function canAssignQuickBillCustomerRequests(role) {
  const r = normalizeAdminRole(role)
  return r === 'admin' || r === 'owner' || r === 'super_admin'
}

/** Owner / Super Admin finalize pending manual Quick Bill requests. */
/** @param {unknown} role */
export function canFinalizeQuickBillCustomerRequests(role) {
  return canViewSensitiveProductPricing(role)
}

/**
 * Owner-only: admin user CRUD (super_admin does not inherit this).
 * @deprecated Use season-scoped helpers (`canManageSeasonUsers`, `canChangeSeasonMemberRoles`) with `seasonRole`.
 * @param {unknown} role
 */
export function canManageAdminUsers(role) {
  return normalizeAdminRole(role) === 'owner'
}

/** Owner or Super Admin: list and invite users for the active business season. */
/** @param {unknown} role */
export function canManageSeasonUsers(role) {
  const r = normalizeAdminRole(role)
  return r === 'owner' || r === 'super_admin'
}

/** Owner-only: change season_members.role within a season. */
/** @param {unknown} actorSeasonRole */
export function canChangeSeasonMemberRoles(actorSeasonRole) {
  return normalizeAdminRole(actorSeasonRole) === 'owner'
}

/**
 * Whether actor may add a user to the season with targetRole (never owner).
 * @param {unknown} actorSeasonRole
 * @param {unknown} targetRole
 */
export function canCreateSeasonMemberWithRole(actorSeasonRole, targetRole) {
  const target = strictParseAdminRole(targetRole)
  if (!target || target === 'owner') return false
  const actor = normalizeAdminRole(actorSeasonRole)
  if (actor === 'owner') return target === 'admin'
  if (actor === 'super_admin') return target === 'admin'
  return false
}

/** Location grants require authority at this stall; legacy season policy is unchanged. */
export function canGrantLocationMemberRole(actorRole, targetRole) {
  const actor = strictParseAdminRole(actorRole), target = strictParseAdminRole(targetRole)
  return Boolean(target && ((actor === 'owner' && target !== 'super_admin') || (actor === 'super_admin' && target === 'admin')))
}

/** Owner-only: permanent product deletion (super_admin does not inherit this). */
/** @param {unknown} role */
export function canDeleteAdminProducts(role) {
  return normalizeAdminRole(role) === 'owner'
}
