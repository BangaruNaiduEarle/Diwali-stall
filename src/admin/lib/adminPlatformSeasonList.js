/** @typedef {'active' | 'archived'} PlatformBusinessSeasonStatus */

/**
 * @typedef {{
 *   id: string,
 *   code: string,
 *   label: string,
 *   status: PlatformBusinessSeasonStatus,
 *   createdAt: string,
 *   updatedAt: string,
 * }} PlatformBusinessSeason
 */

/** @param {unknown} raw */
export function parsePlatformBusinessSeason(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const id = String(o.id ?? '').trim()
  if (!id) return null
  const statusRaw = String(o.status ?? '').trim().toLowerCase()
  return {
    id,
    code: String(o.code ?? '').trim(),
    label: String(o.label ?? '').trim(),
    status: statusRaw === 'archived' ? 'archived' : 'active',
    createdAt: String(o.createdAt ?? o.created_at ?? ''),
    updatedAt: String(o.updatedAt ?? o.updated_at ?? ''),
  }
}

/** @param {PlatformBusinessSeason[]} seasons */
export function sortPlatformBusinessSeasons(seasons) {
  return [...seasons].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )
}

/**
 * Replace or append a season after a successful mutation (no delete path).
 *
 * @param {PlatformBusinessSeason[]} seasons
 * @param {PlatformBusinessSeason} season
 */
export function mergePlatformSeasonIntoList(seasons, season) {
  const idx = seasons.findIndex((s) => s.id === season.id)
  if (idx === -1) return sortPlatformBusinessSeasons([...seasons, season])
  const next = seasons.slice()
  next[idx] = season
  return sortPlatformBusinessSeasons(next)
}

/**
 * @param {PlatformBusinessSeasonStatus} status
 */
export function platformSeasonStatusDisplay(status) {
  return status === 'archived' ? 'Archived' : 'Active'
}

/**
 * UI actions for a season row. Delete is never offered.
 *
 * @param {PlatformBusinessSeasonStatus} status
 */
export function platformSeasonRowActions(status) {
  return {
    canEdit: true,
    canArchive: status === 'active',
    canReactivate: status === 'archived',
    canDelete: false,
  }
}

/**
 * @param {{ label: string, code: string }} season
 */
export function archivePlatformSeasonConfirmMessage(season) {
  return `Archive "${season.label}" (${season.code})? The season stays in the system but is read-only for season admins until reactivated. This does not change the public catalogue season.`
}

/**
 * @param {{ label: string, code: string }} season
 */
export function reactivatePlatformSeasonConfirmMessage(season) {
  return `Reactivate "${season.label}" (${season.code})? Season admins with membership can work in this season again. This does not change the public catalogue season.`
}
