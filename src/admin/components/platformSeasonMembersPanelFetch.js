/**
 * Load helpers for PlatformSeasonMembersPanel (testable fetch scheduling).
 */

/** @typedef {import('../lib/adminPlatformSeasonList.js').PlatformBusinessSeason} PlatformBusinessSeason */
/** @typedef {import('../lib/adminPlatformSeasonMembers.js').PlatformSeasonMember} PlatformSeasonMember */

/**
 * React effect dependency key for the initial members fetch — seasonId only (not parent callbacks).
 * @param {string} seasonId
 */
export function platformSeasonMembersInitialFetchDeps(seasonId) {
  return [seasonId]
}

/**
 * @param {string} seasonId
 * @param {{
 *   fetchMembers: (id: string) => Promise<
 *     | { ok: true, season: PlatformBusinessSeason, members: PlatformSeasonMember[] }
 *     | { ok: false, message: string }
 *   >,
 *   syncRoleDraft: (rows: PlatformSeasonMember[]) => void,
 *   onSeasonUpdated?: (season: PlatformBusinessSeason) => void,
 * }} deps
 */
export async function loadPlatformSeasonMembersPanel(seasonId, deps) {
  const result = await deps.fetchMembers(seasonId)
  if (!result.ok) {
    return result
  }
  deps.syncRoleDraft(result.members)
  deps.onSeasonUpdated?.(result.season)
  return result
}
