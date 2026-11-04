import { strictParseAdminRole } from '../lib/adminRoles.js'
import { getAdminContext } from './requireAdmin.js'

const deny = (context) => ({
  ...(context?.locationError ?? {
    ok: false, status: 403, code: 'forbidden',
    message: 'Validated season and location memberships are required.',
  }),
  platformAdmin: Boolean(context?.platformAdmin),
})

/** No global-role/platform bypass; checks attachment identity and season binding. */
export function resolveLocationScopedAuthorizationFromContext(context) {
  const location = context?.locationContext
  const seasonRole = strictParseAdminRole(context?.seasonRole)
  const locationRole = strictParseAdminRole(location?.locationMembership?.role)
  const membership = context?.memberships?.find(m => m.seasonId === context.activeSeasonId && !m.disabled)
  if (context?.locationModeEnabled !== true || context.locationError || !location?.ok ||
      !seasonRole || !locationRole || !membership || membership.role !== seasonRole ||
      location.userId !== context.userId || location.activeSeasonId !== context.activeSeasonId ||
      location.seasonMembership?.role !== seasonRole ||
      location.seasonMembership?.userId !== context.userId ||
      location.seasonMembership?.seasonId !== context.activeSeasonId ||
      location.seasonMembership?.disabledAt || location.locationMembership?.disabledAt ||
      location.locationMembership?.userId !== context.userId ||
      location.locationMembership?.seasonId !== context.activeSeasonId ||
      !location.activeLocationId || location.locationMembership?.locationId !== location.activeLocationId ||
      location.location?.id !== location.activeLocationId ||
      !location.businessId || location.business?.id !== location.businessId ||
      location.location?.businessId !== location.businessId ||
      location.association?.locationId !== location.activeLocationId ||
      location.association?.seasonId !== context.activeSeasonId ||
      location.operatingSeason?.id !== context.activeSeasonId ||
      membership.status !== location.operatingSeason?.status ||
      ![location.business?.status, location.location?.status, location.association?.status, location.operatingSeason?.status]
        .every(s => s === 'active' || s === 'archived') ||
      location.capabilities?.read !== true || typeof location.capabilities?.write !== 'boolean') {
    return deny(context)
  }

  // Existing handlers use auth.seasonRole for role helpers. In enabled mode that
  // field must carry the common authority, so an owner season cannot bypass an
  // admin location. The original membership roles remain intact in the context.
  const roles = ['admin', 'super_admin', 'owner']
  const effectiveRole = roles[Math.min(roles.indexOf(seasonRole), roles.indexOf(locationRole))]
  return {
    ok: true, userId: context.userId, activeSeasonId: context.activeSeasonId,
    activeLocationId: location.activeLocationId, businessId: location.businessId,
    seasonRole: effectiveRole, locationRole, effectiveRole,
    platformAdmin: Boolean(context.platformAdmin), locationContext: location,
  }
}

export function requireLocationMembership(request) {
  return resolveLocationScopedAuthorizationFromContext(getAdminContext(request))
}

export function requireLocationRole(request, allowedRoles) {
  const auth = requireLocationMembership(request)
  if (!auth.ok) return auth
  if (!allowedRoles.includes(auth.effectiveRole)) return deny(getAdminContext(request))
  return auth
}

export function requireWritableLocation(request) {
  const auth = requireLocationMembership(request)
  if (!auth.ok) return auth
  const location = auth.locationContext
  if (!location.capabilities.write ||
      ![location.business.status, location.location.status, location.association.status, location.operatingSeason.status]
        .every(s => s === 'active')) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Archived location context cannot be modified.', platformAdmin: auth.platformAdmin }
  }
  return auth
}
