/** @type {string | null} */
let adminActiveSeasonId = null
let adminLocationModeEnabled = false
let adminActiveLocationId = null
let adminActiveBusinessId = null
let adminContextSwitching = false
let adminContextGeneration = 0

/** @param {string | null | undefined} seasonId */
export function setAdminActiveSeasonId(seasonId) {
  const next = normalizeAdminActiveSeasonId(seasonId)
  if (next !== adminActiveSeasonId) adminContextGeneration += 1
  adminActiveSeasonId = next
}

/** @returns {string | null} */
export function getAdminActiveSeasonId() {
  return adminActiveSeasonId
}

export function clearAdminActiveSeasonId() {
  adminActiveSeasonId = null
  adminLocationModeEnabled = false
  adminActiveLocationId = null
  adminActiveBusinessId = null
  adminContextSwitching = false
  adminContextGeneration += 1
}

export function setAdminLocationSelection({ locationModeEnabled = false, activeLocationId = null, activeBusinessId = null }) {
  const enabled = locationModeEnabled === true
  const location = enabled ? normalizeAdminActiveSeasonId(activeLocationId) : null
  const business = enabled ? normalizeAdminActiveSeasonId(activeBusinessId) : null
  if (enabled !== adminLocationModeEnabled || location !== adminActiveLocationId || business !== adminActiveBusinessId) adminContextGeneration += 1
  adminLocationModeEnabled = enabled
  adminActiveLocationId = location
  adminActiveBusinessId = business
}

export function setAdminContextSwitching(switching) {
  adminContextSwitching = switching
  adminContextGeneration += 1
}

export function getAdminRequestContext() {
  return { locationModeEnabled: adminLocationModeEnabled, activeLocationId: adminActiveLocationId,
    activeBusinessId: adminActiveBusinessId, activeSeasonId: adminActiveSeasonId,
    switching: adminContextSwitching, generation: adminContextGeneration }
}

export function isAdminOperationalApiPath(path) {
  const pathname = String(path).split('?')[0]
  return pathname.startsWith('/api/admin/') && !isPlatformAdminApiPath(path) &&
    pathname !== '/api/admin/session' && !pathname.startsWith('/api/admin/auth/')
}

export function adminLocationHeaderValueForPath(path) {
  return adminLocationModeEnabled && (isAdminOperationalApiPath(path) || String(path).split('?')[0] === '/api/admin/session')
    ? adminActiveLocationId : null
}

/** Season header for session refresh only (same value as active catalogue season). */
export function getAdminSessionSeasonHeader() {
  return adminActiveSeasonId
}

/**
 * @param {string | null | undefined} seasonId
 * @returns {string | null}
 */
export function normalizeAdminActiveSeasonId(seasonId) {
  if (seasonId == null) return null
  const trimmed = String(seasonId).trim()
  return trimmed || null
}

/**
 * @param {string} path API path (may include query string).
 */
export function isPlatformAdminApiPath(path) {
  const pathname = String(path ?? '').split('?')[0]
  return pathname === '/api/admin/platform' || pathname.startsWith('/api/admin/platform/')
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function shouldAttachAdminSeasonHeader(path) {
  if (isPlatformAdminApiPath(path)) return false
  return adminActiveSeasonId != null
}

/**
 * @param {string} path
 * @returns {string | null}
 */
export function adminSeasonHeaderValueForPath(path) {
  return shouldAttachAdminSeasonHeader(path) ? adminActiveSeasonId : null
}
