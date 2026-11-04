import { strictParseAdminRole } from './adminRoles.js'

/**
 * @typedef {{
 *   seasonId: string,
 *   code: string,
 *   label: string,
 *   status: string,
 *   role: string,
 *   membershipDisabled: boolean,
 * }} AdminSeasonMembership
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeSessionSeasonId(value) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

/**
 * @param {unknown} raw
 * @returns {AdminSeasonMembership[]}
 */
export function parseAdminSessionMemberships(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {AdminSeasonMembership[]} */
  const out = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = /** @type {Record<string, unknown>} */ (entry)
    const seasonId = normalizeSessionSeasonId(row.seasonId)
    if (!seasonId) continue
    out.push({
      seasonId,
      code: String(row.code ?? ''),
      label: String(row.label ?? ''),
      status: String(row.status ?? ''),
      role: String(row.role ?? 'admin'),
      membershipDisabled: Boolean(row.membershipDisabled),
    })
  }
  return out
}

/**
 * Parses GET /api/admin/session JSON. Does not infer activeSeasonId from memberships.
 * @param {unknown} data
 */
export function parseAdminSessionPayload(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'invalid_session', message: 'Admin session response was invalid.' }
  }
  const body = /** @type {Record<string, unknown>} */ (data)
  if (!body.ok || !body.email) {
    return { ok: false, error: 'invalid_session', message: 'Admin session response was invalid.' }
  }

  const activeSeasonId = normalizeSessionSeasonId(body.activeSeasonId)
  const seasonRoleRaw = body.seasonRole
  const seasonStatusRaw = body.seasonStatus
  const locationModeEnabled = body.locationModeEnabled === true
  const authorizedLocations = locationModeEnabled ? parseAuthorizedLocations(body.authorizedLocations) : []
  const activeLocationId = locationModeEnabled ? normalizeSessionSeasonId(body.activeLocationId) : null
  const activeBusinessId = locationModeEnabled ? normalizeSessionSeasonId(body.activeBusinessId) : null
  const active = authorizedLocations.find(row => row.location.id === activeLocationId &&
    row.business.id === activeBusinessId && row.operatingSeason.id === activeSeasonId)
  if (locationModeEnabled && ((activeLocationId || activeBusinessId) && !active ||
      active && (body.effectiveRole !== active.effectiveRole || body.locationRole !== active.locationRole))) {
    return { ok: false, error: 'invalid_session', message: 'The selected stall is not authorized by this session.' }
  }

  return {
    ok: true,
    email: String(body.email),
    role: typeof body.role === 'string' ? body.role : 'admin',
    userId: body.userId != null ? String(body.userId) : null,
    platformAdmin: Boolean(body.platformAdmin),
    activeSeasonId,
    seasonRole: seasonRoleRaw == null || seasonRoleRaw === '' ? null : String(seasonRoleRaw),
    seasonStatus: seasonStatusRaw == null || seasonStatusRaw === '' ? null : String(seasonStatusRaw),
    memberships: parseAdminSessionMemberships(body.memberships),
    locationModeEnabled,
    authorizedLocations,
    activeLocationId,
    activeBusinessId,
    business: active?.business ?? null,
    location: active?.location ?? null,
    association: active?.association ?? null,
    locationRole: active?.locationRole ?? null,
    effectiveRole: active?.effectiveRole ?? null,
    capabilities: active?.capabilities ?? {},
    locationSelectionRequired: locationModeEnabled && !active,
    message: typeof body.message === 'string' ? body.message : '',
  }
}

/** Retain only complete, unambiguous server-authorized business/location/season tuples. */
export function parseAuthorizedLocations(raw) {
  if (!Array.isArray(raw)) return []
  const roles = ['admin', 'super_admin', 'owner']
  const rows = raw.flatMap(row => {
    if (!row || typeof row !== 'object' || row.disabled || row.membershipDisabled) return []
    const { business, location, operatingSeason, association } = row
    if (![business?.id, location?.id, operatingSeason?.id].every(id => typeof id === 'string' && id.trim() === id && id.length > 0) || location.businessId !== business.id ||
        association?.locationId !== location.id || association?.seasonId !== operatingSeason.id ||
        !['permanent', 'seasonal'].includes(business.type) || !Number.isInteger(association.operatingYear) || association.operatingYear < 1 || association.operatingYear > 9999 ||
        ![business, location, operatingSeason, association].every(value => ['active', 'archived'].includes(value.status))) return []
    const seasonRole = strictParseAdminRole(row.seasonRole), locationRole = strictParseAdminRole(row.locationRole)
    if (!seasonRole || !locationRole) return []
    const effectiveRole = roles[Math.min(roles.indexOf(seasonRole), roles.indexOf(locationRole))]
    if (row.effectiveRole !== effectiveRole) return []
    const capabilities = Object.fromEntries(['read', 'write', 'viewSensitiveProductPricing', 'viewFinalRate', 'assignQuickBillCustomerRequests',
      'finalizeQuickBillCustomerRequests', 'deleteAdminProducts', 'manageSeasonUsers', 'changeSeasonMemberRoles']
      .map(key => [key, row.capabilities?.[key] === true]))
    if (!capabilities.read) return []
    capabilities.write = capabilities.write && [business, location, operatingSeason, association].every(value => value.status === 'active')
    capabilities.createSeasonMemberWithRole = Object.fromEntries(roles.map(role => [role, row.capabilities?.createSeasonMemberWithRole?.[role] === true]))
    return [{ business: { ...business }, location: { ...location }, operatingSeason: { ...operatingSeason },
      association: { ...association }, seasonRole, locationRole, effectiveRole, capabilities }]
  })
  return rows.filter(row => rows.filter(other => other.location.id === row.location.id && other.operatingSeason.id === row.operatingSeason.id).length === 1)
}

/** A keyed operational subtree clears all page-local data/drafts when confirmed scope changes. */
export function adminOperationalContextKey(session) {
  return session.locationModeEnabled
    ? JSON.stringify([session.email, session.activeSeasonId, session.activeBusinessId, session.activeLocationId,
      session.effectiveRole, session.capabilities]) : 'legacy-season-workspace'
}
