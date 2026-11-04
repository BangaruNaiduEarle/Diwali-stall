import {
  canAssignQuickBillCustomerRequests,
  canDeleteAdminProducts,
  canFinalizeQuickBillCustomerRequests,
  canManageSeasonUsers,
  canViewSensitiveProductPricing,
  strictParseAdminRole,
} from './adminRoles.js'
import { getAdminContext } from '../middleware/requireAdmin.js'
import { resolveLocationScopedAuthorizationFromContext } from '../middleware/adminLocationGuards.js'

/** @typedef {import('./adminRoles.js').AdminRole} AdminRole */
/** @typedef {import('../services/adminSeasonContext.js').AdminSeasonContext} AdminSeasonContext */

/**
 * @typedef {{
 *   ok: true,
 *   userId: string,
 *   activeSeasonId: string,
 *   seasonRole: AdminRole,
 *   platformAdmin: boolean,
 * }} SeasonScopedAuthorization
 */

/**
 * @typedef {{
 *   ok: false,
 *   status: number,
 *   code: string,
 *   message: string,
 *   platformAdmin: boolean,
 * }} SeasonScopedAuthorizationDenied
 */

/** @typedef {SeasonScopedAuthorization | SeasonScopedAuthorizationDenied} SeasonScopedAuthorizationResult */

/**
 * Resolve season-scoped authorization from the request's admin context.
 * Uses season_members role (`seasonRole`) only — never JWT/session `identity.role`.
 *
 * @param {Request} request
 * @returns {SeasonScopedAuthorizationResult}
 */
export function resolveSeasonScopedAuthorization(request) {
  return resolveSeasonScopedAuthorizationFromContext(getAdminContext(request))
}

/**
 * @param {AdminSeasonContext | null | undefined} context
 * @returns {SeasonScopedAuthorizationResult}
 */
export function resolveSeasonScopedAuthorizationFromContext(context) {
  if (!context) {
    return deny('Admin season context is required.', false)
  }

  const platformAdmin = Boolean(context.platformAdmin)
  if (context.locationModeEnabled) {
    return resolveLocationScopedAuthorizationFromContext(context)
  }
  const activeSeasonId = String(context.activeSeasonId ?? '').trim()
  if (!activeSeasonId) {
    return deny('Active business season is required.', platformAdmin)
  }

  const seasonRole = strictParseAdminRole(context.seasonRole)
  if (!seasonRole) {
    return deny('Season membership is required for this operation.', platformAdmin)
  }

  return {
    ok: true,
    userId: String(context.userId ?? '').trim(),
    activeSeasonId,
    seasonRole,
    platformAdmin,
  }
}

/**
 * Capability flags for the active season (delegates to adminRoles.js with seasonRole).
 * @param {SeasonScopedAuthorization} auth
 */
export function seasonAuthorizationCapabilities(auth) {
  if (auth.locationContext) {
    const c = auth.locationContext.capabilities
    return {
      viewSensitiveProductPricing: c.viewSensitiveProductPricing,
      assignQuickBillCustomerRequests: c.assignQuickBillCustomerRequests,
      finalizeQuickBillCustomerRequests: c.finalizeQuickBillCustomerRequests,
      deleteAdminProducts: c.deleteAdminProducts,
      manageSeasonUsers: c.manageSeasonUsers,
    }
  }
  const role = auth.seasonRole
  return {
    viewSensitiveProductPricing: canViewSensitiveProductPricing(role),
    assignQuickBillCustomerRequests: canAssignQuickBillCustomerRequests(role),
    finalizeQuickBillCustomerRequests: canFinalizeQuickBillCustomerRequests(role),
    deleteAdminProducts: canDeleteAdminProducts(role),
    manageSeasonUsers: canManageSeasonUsers(role),
  }
}

/**
 * @param {SeasonScopedAuthorizationResult} result
 * @param {keyof ReturnType<typeof seasonAuthorizationCapabilities>} capability
 */
export function seasonAuthorizationAllows(result, capability) {
  if (!result.ok) return false
  return seasonAuthorizationCapabilities(result)[capability]
}

/** @param {string} message @param {boolean} platformAdmin */
function deny(message, platformAdmin) {
  return {
    ok: false,
    status: 403,
    code: 'forbidden',
    message,
    platformAdmin,
  }
}
