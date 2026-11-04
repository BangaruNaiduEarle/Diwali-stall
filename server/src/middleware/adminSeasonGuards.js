import {
  resolveSeasonScopedAuthorization,
} from '../lib/adminSeasonAuthorization.js'
import { getAdminContext } from './requireAdmin.js'
import { requireLocationMembership, requireWritableLocation } from './adminLocationGuards.js'

/** @typedef {import('../services/adminSeasonContext.js').AdminSeasonContext} AdminSeasonContext */
/** @typedef {import('../services/adminSeasonContext.js').SeasonMembership} SeasonMembership */
/** @typedef {import('../lib/adminRoles.js').AdminRole} AdminRole */
/** @typedef {import('../lib/adminSeasonAuthorization.js').SeasonScopedAuthorization} SeasonScopedAuthorization */

/**
 * @typedef {{
 *   ok: false,
 *   status: number,
 *   code: string,
 *   message: string,
 *   platformAdmin: boolean,
 * }} AdminSeasonGuardDenied
 */

/**
 * @typedef {{
 *   ok: true,
 *   activeSeasonId: string,
 *   userId: string,
 *   platformAdmin: boolean,
 *   seasonStatus: string,
 * }} ActiveSeasonGuard
 */

/**
 * @typedef {{
 *   ok: true,
 *   auth: SeasonScopedAuthorization,
 *   seasonStatus: string,
 * }} SeasonMembershipGuard
 */

/**
 * @typedef {{
 *   ok: true,
 *   userId: string,
 *   platformAdmin: true,
 * }} PlatformAdminGuard
 */

/** @param {AdminSeasonContext | null | undefined} context @returns {SeasonMembership | null} */
export function getActiveSeasonMembership(context) {
  if (!context?.activeSeasonId) return null
  const activeSeasonId = String(context.activeSeasonId)
  return context.memberships.find((m) => m.seasonId === activeSeasonId && !m.disabled) ?? null
}

/**
 * Requires resolved active season (from header or default membership pick).
 * Does not grant platform-admin bypass — business routes still need membership.
 *
 * @param {Request} request
 * @returns {ActiveSeasonGuard | AdminSeasonGuardDenied}
 */
export function requireActiveSeason(request) {
  const context = getAdminContext(request)
  if (!context) {
    return deny('Admin season context is required.')
  }
  if (context.locationModeEnabled) {
    const location = requireLocationMembership(request)
    if (!location.ok) return location
  }

  const platformAdmin = Boolean(context.platformAdmin)
  const activeSeasonId = String(context.activeSeasonId ?? '').trim()
  if (!activeSeasonId) {
    return deny('Active business season is required.', platformAdmin)
  }

  const membership = getActiveSeasonMembership(context)
  if (!membership) {
    return deny('Active business season is required.', platformAdmin)
  }

  return {
    ok: true,
    activeSeasonId,
    userId: String(context.userId ?? '').trim(),
    platformAdmin,
    seasonStatus: String(membership.status),
  }
}

/**
 * @param {Request} request
 * @returns {SeasonMembershipGuard | AdminSeasonGuardDenied}
 */
export function requireSeasonMembership(request) {
  const resolved = resolveSeasonScopedAuthorization(request)
  if (!resolved.ok) {
    return fromAuthorizationDenied(resolved)
  }

  const context = getAdminContext(request)
  const membership = getActiveSeasonMembership(context)
  const seasonStatus = membership ? String(membership.status) : 'active'

  return {
    ok: true,
    auth: resolved,
    seasonStatus,
  }
}

/**
 * @param {Request} request
 * @param {readonly AdminRole[]} allowedRoles
 * @returns {SeasonMembershipGuard | AdminSeasonGuardDenied}
 */
export function requireSeasonRole(request, allowedRoles) {
  const membershipGuard = requireSeasonMembership(request)
  if (!membershipGuard.ok) {
    return membershipGuard
  }

  const allowed = new Set(allowedRoles)
  if (!allowed.has(membershipGuard.auth.seasonRole)) {
    return deny('Not allowed for this role.', membershipGuard.auth.platformAdmin)
  }

  return membershipGuard
}

/**
 * Rejects writes when business_seasons.status is `archived` (schema: active | archived).
 *
 * @param {Request} request
 * @returns {SeasonMembershipGuard | AdminSeasonGuardDenied}
 */
export function requireWritableSeason(request) {
  const membershipGuard = requireSeasonMembership(request)
  if (!membershipGuard.ok) {
    return membershipGuard
  }
  if (getAdminContext(request)?.locationModeEnabled) {
    const location = requireWritableLocation(request)
    if (!location.ok) return location
  }

  if (membershipGuard.seasonStatus === 'archived') {
    return deny(
      'This business season is archived and cannot be modified.',
      membershipGuard.auth.platformAdmin,
    )
  }

  return membershipGuard
}

/**
 * Platform-only operations — no season membership required.
 *
 * @param {Request} request
 * @returns {PlatformAdminGuard | AdminSeasonGuardDenied}
 */
export function requirePlatformAdmin(request) {
  const context = getAdminContext(request)
  if (!context) {
    return deny('Admin season context is required.')
  }
  if (!context.platformAdmin) {
    return deny('Platform Admin access required.', false)
  }
  return {
    ok: true,
    userId: String(context.userId ?? '').trim(),
    platformAdmin: true,
  }
}

/** @param {string} message @param {boolean} [platformAdmin] */
function deny(message, platformAdmin = false) {
  return {
    ok: false,
    status: 403,
    code: 'forbidden',
    message,
    platformAdmin,
  }
}

/** @param {import('../lib/adminSeasonAuthorization.js').SeasonScopedAuthorizationDenied} denied */
function fromAuthorizationDenied(denied) {
  return {
    ok: false,
    status: denied.status,
    code: denied.code,
    message: denied.message,
    platformAdmin: denied.platformAdmin,
  }
}
