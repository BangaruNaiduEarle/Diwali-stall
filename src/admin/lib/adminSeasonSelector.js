import { adminRoleDisplayLabel } from './adminRoles.js'
import { normalizeSessionSeasonId } from './adminSeasonSession.js'

/**
 * @param {import('./adminSeasonSession.js').AdminSeasonMembership} membership
 */
export function isSeasonMembershipSelectable(membership) {
  return !membership.membershipDisabled
}

/**
 * @param {import('./adminSeasonSession.js').AdminSeasonMembership[]} memberships
 */
export function listSelectableSeasonMemberships(memberships) {
  return memberships.filter(isSeasonMembershipSelectable)
}

/**
 * @param {import('./adminSeasonSession.js').AdminSeasonMembership[]} memberships
 * @param {string | null | undefined} seasonId
 */
export function findSeasonMembership(memberships, seasonId) {
  const id = normalizeSessionSeasonId(seasonId)
  if (!id) return null
  return memberships.find((m) => m.seasonId === id) ?? null
}

/**
 * @param {import('./adminSeasonSession.js').AdminSeasonMembership} membership
 */
export function formatSeasonMembershipOptionLabel(membership) {
  const base = membership.label?.trim() || membership.code?.trim() || membership.seasonId
  if (membership.status === 'archived') return `${base} (archived)`
  return base
}

/**
 * @param {{
 *   activeSeasonId: string | null,
 *   seasonRole: string | null,
 *   seasonStatus: string | null,
 *   memberships: import('./adminSeasonSession.js').AdminSeasonMembership[],
 * }} input
 */
export function describeActiveSeasonDisplay(input) {
  const { activeSeasonId, seasonRole, seasonStatus, memberships } = input
  if (!activeSeasonId) {
    return { label: null, roleLabel: null, readOnly: false }
  }
  const membership = findSeasonMembership(memberships, activeSeasonId)
  const label = membership ? formatSeasonMembershipOptionLabel(membership) : activeSeasonId
  const role = seasonRole ?? membership?.role ?? null
  const readOnly = seasonStatus === 'archived' || membership?.status === 'archived'
  return {
    label,
    roleLabel: role ? adminRoleDisplayLabel(role) : null,
    readOnly,
  }
}

/**
 * @param {import('./adminSeasonSession.js').AdminSeasonMembership[]} memberships
 * @param {string | null | undefined} seasonId
 * @param {{ platformAdmin?: boolean }} [opts]
 */
export function validateSeasonSelection(memberships, seasonId, opts = {}) {
  const target = normalizeSessionSeasonId(seasonId)
  if (!target) {
    if (opts.platformAdmin && memberships.length === 0) {
      return { ok: true, seasonId: null }
    }
    return {
      ok: false,
      code: 'season_required',
      message: 'Choose a business season to continue.',
    }
  }

  const membership = findSeasonMembership(memberships, target)
  if (!membership) {
    return { ok: false, code: 'invalid_season', message: 'That season is not available for your account.' }
  }
  if (membership.membershipDisabled) {
    return {
      ok: false,
      code: 'disabled_membership',
      message: 'That season membership is disabled.',
    }
  }
  return { ok: true, seasonId: target }
}

/**
 * @param {string | null | undefined} requestedSeasonId
 * @param {string | null | undefined} sessionActiveSeasonId
 */
export function sessionConfirmedSeasonSelection(requestedSeasonId, sessionActiveSeasonId) {
  const requested = normalizeSessionSeasonId(requestedSeasonId)
  const active = normalizeSessionSeasonId(sessionActiveSeasonId)
  if (requested === null) return active === null
  return requested === active
}

/**
 * @param {{
 *   seasonId: string | null | undefined,
 *   memberships: import('./adminSeasonSession.js').AdminSeasonMembership[],
 *   platformAdmin: boolean,
 *   previousSeasonId: string | null,
 *   fetchSession: () => Promise<{ ok: boolean, activeSeasonId?: string | null } & Record<string, unknown>>,
 *   setSeasonHeader: (seasonId: string | null) => void,
 * }} input
 */
export async function performAdminSeasonSwitch(input) {
  if (input.locationModeEnabled) return performAdminLocationSwitch(input)
  const validation = validateSeasonSelection(input.memberships, input.seasonId, {
    platformAdmin: input.platformAdmin,
  })
  if (!validation.ok) return validation

  const target = validation.seasonId
  const previous = normalizeSessionSeasonId(input.previousSeasonId)
  if (target === previous) {
    return { ok: true, skipped: true, session: null }
  }

  input.setSeasonHeader(target)
  const attempt = await input.fetchSession()
  if (input.isCurrent && !input.isCurrent()) return { ok: false, code: 'stale_context' }
  if (attempt.ok && sessionConfirmedSeasonSelection(target, attempt.activeSeasonId)) {
    return { ok: true, session: attempt }
  }

  input.setSeasonHeader(previous)
  const restored = await input.fetchSession()
  return {
    ok: false,
    code: 'season_switch_denied',
    message: 'Could not switch to that season.',
    restoredSession: restored.ok && (!input.isCurrent || input.isCurrent()) ? restored : null,
  }
}

/** Extend the existing switch transaction with a server-authorized stall tuple. */
export async function performAdminLocationSwitch(input) {
  const seasonId = normalizeSessionSeasonId(input.seasonId)
  const validation = validateSeasonSelection(input.memberships, seasonId, { platformAdmin: input.platformAdmin })
  if (!validation.ok) return validation
  const candidates = input.authorizedLocations.filter(row => row.operatingSeason.id === seasonId)
  const locationId = input.locationId === undefined
    ? (candidates.find(row => row.location.id === input.previousLocationId)?.location.id ?? (candidates.length === 1 ? candidates[0].location.id : null))
    : normalizeSessionSeasonId(input.locationId)
  const target = candidates.find(row => row.location.id === locationId)
  if (locationId && !target) return { ok: false, code: 'invalid_location', message: 'That stall is not available for your account.' }
  if (!locationId && seasonId === input.previousSeasonId) return { ok: false, code: 'location_required', message: 'Choose a stall to continue.' }
  const current = () => !input.isCurrent || input.isCurrent()
  const confirmed = (session, season, location, business) => session.ok && session.locationModeEnabled === true &&
    session.activeSeasonId === season && session.activeLocationId === location && session.activeBusinessId === business &&
    (!location || session.authorizedLocations.some(row => row.location.id === location && row.business.id === business && row.operatingSeason.id === season))
  if (!current()) return { ok: false, code: 'stale_context' }
  input.setSeasonHeader(seasonId)
  input.setLocationHeader({ locationModeEnabled: true, activeLocationId: locationId, activeBusinessId: target?.business.id ?? null })
  let attempt
  try { attempt = await input.fetchSession() } catch { attempt = { ok: false } }
  if (!current()) return { ok: false, code: 'stale_context' }
  if (confirmed(attempt, seasonId, locationId, target?.business.id ?? null)) return { ok: true, session: attempt }
  input.setSeasonHeader(input.previousSeasonId)
  input.setLocationHeader({ locationModeEnabled: true, activeLocationId: input.previousLocationId, activeBusinessId: input.previousBusinessId })
  let restored
  try { restored = await input.fetchSession() } catch { restored = { ok: false } }
  return { ok: false, attempted: true, code: 'location_switch_denied', message: 'Could not switch stall. The previous selection was restored when available.',
    restoredSession: current() && confirmed(restored, input.previousSeasonId, input.previousLocationId, input.previousBusinessId) ? restored : null }
}
