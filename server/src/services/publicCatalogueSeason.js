import { resolveTrustedPublicLocation } from './publicCustomerRequestContext.js'

const catalogueContexts = new WeakMap()

/** One trusted resolution per route request, shared by its child read services. */
export async function resolvePublicCatalogueContext(db, env = {}, prepared) {
  if (prepared !== undefined) {
    const origin = catalogueContexts.get(prepared)
    if (origin?.db === db && origin.env === env) return prepared
    throw Object.assign(new Error('The catalogue is temporarily unavailable. Please try again later.'), { status: 503, code: 'catalogue_unavailable' })
  }
  const location = await resolveTrustedPublicLocation(db, env)
  if (!location.ok) throw Object.assign(new Error(location.message), { status: location.status, code: location.error })
  const resolved = location.scope
    ? { ok: true, seasonId: location.scope.seasonId, scope: location.scope }
    : { ...await resolveActivePublicCatalogueSeasonId(db), scope: null }
  const context = Object.freeze(resolved)
  catalogueContexts.set(context, { db, env })
  return context
}

export const PUBLIC_CATALOGUE_SEASON_SQL = `
  SELECT public_catalogue_season_id
  FROM platform_settings
  WHERE singleton_id = 1
`.trim()

export const PUBLIC_CATALOGUE_SEASON_STATUS_SQL = `
  SELECT status
  FROM business_seasons
  WHERE id = ?
  LIMIT 1
`.trim()

/**
 * @param {D1Database} db
 * @returns {Promise<string | null>}
 */
export async function getPublicCatalogueSeasonId(db) {
  const row = await db.prepare(PUBLIC_CATALOGUE_SEASON_SQL).bind().first()
  const seasonId = row ? String(row.public_catalogue_season_id ?? '').trim() : ''
  return seasonId || null
}

/**
 * Same validation as public customer request creation: configured season must exist and be active.
 *
 * @param {D1Database} db
 * @returns {Promise<
 *   | { ok: true, seasonId: string }
 *   | { ok: false, status: number, error: string, message: string }
 * >}
 */
export async function resolveActivePublicCatalogueSeasonId(db) {
  const seasonId = await getPublicCatalogueSeasonId(db)
  if (!seasonId) {
    return {
      ok: false,
      status: 503,
      error: 'catalogue_unavailable',
      message: 'The catalogue is temporarily unavailable. Please try again later.',
    }
  }

  const row = await db.prepare(PUBLIC_CATALOGUE_SEASON_STATUS_SQL).bind(seasonId).first()
  if (!row || String(row.status ?? '').trim().toLowerCase() !== 'active') {
    return {
      ok: false,
      status: 503,
      error: 'catalogue_unavailable',
      message: 'The catalogue is temporarily unavailable. Please try again later.',
    }
  }

  return { ok: true, seasonId }
}
