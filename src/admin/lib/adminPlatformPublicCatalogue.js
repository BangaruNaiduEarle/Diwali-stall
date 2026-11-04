/** @typedef {import('./adminPlatformSeasonList.js').PlatformBusinessSeason} PlatformBusinessSeason */

/**
 * @param {PlatformBusinessSeason[]} seasons
 */
export function filterActivePlatformBusinessSeasons(seasons) {
  return seasons.filter((s) => s.status === 'active')
}

/**
 * @param {PlatformBusinessSeason[]} seasons
 * @param {string | null | undefined} seasonId
 */
export function findPlatformBusinessSeasonById(seasons, seasonId) {
  const id = String(seasonId ?? '').trim()
  if (!id) return null
  return seasons.find((s) => s.id === id) ?? null
}

/**
 * @param {PlatformBusinessSeason | null | undefined} season
 * @param {string | null | undefined} seasonId
 */
export function formatPublicCatalogueSeasonDisplay(season, seasonId) {
  const id = String(seasonId ?? season?.id ?? '').trim()
  if (!id) return 'Not configured'
  if (!season) return id
  return `${season.label} (${season.code}) · ${id}`
}

/**
 * @param {string | null | undefined} selectedId
 * @param {PlatformBusinessSeason[]} activeSeasons
 */
export function validatePublicCatalogueSeasonSelection(selectedId, activeSeasons) {
  const id = String(selectedId ?? '').trim()
  if (!id) {
    return { ok: false, message: 'Select an active business season.' }
  }
  const match = activeSeasons.find((s) => s.id === id)
  if (!match) {
    return { ok: false, message: 'Public catalogue season must be an active business season.' }
  }
  return { ok: true, publicCatalogueSeasonId: id }
}

/**
 * @param {{
 *   currentId: string | null,
 *   nextId: string,
 *   currentLabel: string,
 *   nextLabel: string,
 * }} input
 */
export function publicCatalogueSeasonSaveConfirmMessage(input) {
  const from = input.currentLabel || input.currentId || 'Not configured'
  const to = input.nextLabel || input.nextId
  return `Change the public catalogue season from "${from}" to "${to}"? This updates which season powers public Products, Family Packs, and new customer requests. Season create, archive, and reactivate do not change this setting automatically.`
}

/** @param {string | null | undefined} currentId @param {string | null | undefined} draftId */
export function publicCatalogueSelectionIsDirty(currentId, draftId) {
  const current = String(currentId ?? '').trim()
  const draft = String(draftId ?? '').trim()
  return Boolean(draft) && draft !== current
}
