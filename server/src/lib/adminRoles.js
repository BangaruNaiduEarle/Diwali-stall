/** @typedef {'owner' | 'super_admin' | 'admin'} AdminRole */

const ADMIN_ROLES = /** @type {const} */ (['owner', 'super_admin', 'admin'])

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

/** Owner-only: admin user CRUD (super_admin does not inherit this). */
/** @param {unknown} role */
export function canManageAdminUsers(role) {
  return normalizeAdminRole(role) === 'owner'
}
