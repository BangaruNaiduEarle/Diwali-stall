import { resolveLocationScopedAuthorizationFromContext } from '../middleware/adminLocationGuards.js'
import { adminServiceMode, serviceScopeError } from './adminServiceMode.js'

const validatedScopes = new WeakSet()

/**
 * Shared service prerequisite for location-owned operations. Only the trusted DB
 * binding selects legacy/location mode; body/header IDs never grant authority.
 * Catalogue ownership is location-wide, while transactions also bind the season.
 */
export function adminOperationScope(db, seasonId, context, write = false) {
  const season = String(seasonId ?? '').trim()
  const mode = adminServiceMode(db)
  if (mode !== true && mode !== false) throw serviceScopeError('Service DB location mode is missing or invalid.', 503)
  if (mode === false) {
    if (context?.locationModeEnabled) throw serviceScopeError('Location context does not match the configured service mode.')
    return Object.freeze({ seasonId: season, locationId: null })
  }
  const auth = resolveLocationScopedAuthorizationFromContext(context)
  const location = auth.ok ? auth.locationContext : null
  if (!auth.ok || season !== auth.activeSeasonId ||
      (write && (!location.capabilities.write ||
        ![location.business.status, location.location.status, location.operatingSeason.status, location.association.status]
          .every(status => status === 'active')))) {
    throw serviceScopeError('Validated operation scope is required for this operation.')
  }
  const scope = Object.freeze({
    businessId: auth.businessId, locationId: auth.activeLocationId, seasonId: season,
    userId: auth.userId, effectiveRole: auth.effectiveRole,
  })
  validatedScopes.add(scope)
  return scope
}

/**
 * Validate the complete ownership envelope of a loaded/future operation record.
 * Callers must first resolve scope with adminOperationScope and still constrain
 * DB reads/writes; validating a client envelope alone never authorizes a record.
 */
export function validateOperationOwnership(scope, record) {
  if (!validatedScopes.has(scope) || !scope.locationId || !scope.businessId || !scope.seasonId ||
      !record || ['businessId', 'locationId', 'seasonId'].some(key => record[key] !== scope[key])) {
    throw serviceScopeError('Operation ownership does not match the authorized scope.', 409)
  }
}
