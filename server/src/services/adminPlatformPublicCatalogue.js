import { getPlatformBusinessSeasonById } from './adminPlatformSeasons.js'
import { PUBLIC_CATALOGUE_SEASON_SQL } from './publicCatalogueSeason.js'

const UPDATE_PUBLIC_CATALOGUE_SEASON_SQL = `
  UPDATE platform_settings
  SET public_catalogue_season_id = ?,
      updated_at = datetime('now'),
      updated_by_email = ?
  WHERE singleton_id = 1
`.trim()

/**
 * @param {D1Database} db
 */
export async function getPlatformPublicCatalogueSeasonSetting(db) {
  const row = await db.prepare(PUBLIC_CATALOGUE_SEASON_SQL).bind().first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Platform settings not found.' }
  }
  const publicCatalogueSeasonId = String(row.public_catalogue_season_id ?? '').trim()
  if (!publicCatalogueSeasonId) {
    return {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'Public catalogue season is not configured.',
    }
  }
  return { ok: true, publicCatalogueSeasonId }
}

/**
 * @param {D1Database} db
 * @param {{ publicCatalogueSeasonId?: string }} input
 * @param {string | null | undefined} updatedByEmail
 */
export async function updatePlatformPublicCatalogueSeasonSetting(db, input, updatedByEmail) {
  const publicCatalogueSeasonId = String(input.publicCatalogueSeasonId ?? '').trim()
  if (!publicCatalogueSeasonId) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'publicCatalogueSeasonId is required.',
    }
  }

  const seasonResult = await getPlatformBusinessSeasonById(db, publicCatalogueSeasonId)
  if (!seasonResult.ok) {
    return seasonResult
  }
  if (seasonResult.season.status !== 'active') {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Public catalogue season must be an active business season.',
    }
  }

  const email = String(updatedByEmail ?? '').trim() || null
  const runResult = await db
    .prepare(UPDATE_PUBLIC_CATALOGUE_SEASON_SQL)
    .bind(publicCatalogueSeasonId, email)
    .run()

  if (!runResult.meta?.changes) {
    return { ok: false, status: 404, code: 'not_found', message: 'Platform settings not found.' }
  }

  return { ok: true, publicCatalogueSeasonId }
}
