/** @typedef {'active' | 'archived'} BusinessSeasonStatus */

/**
 * @typedef {{
 *   id: string,
 *   code: string,
 *   label: string,
 *   status: BusinessSeasonStatus,
 *   createdAt: string,
 *   updatedAt: string,
 * }} PlatformBusinessSeason
 */

const SEASON_ID_PATTERN = /^season-[a-z0-9][a-z0-9-]{0,62}$/i
const SEASON_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i

/**
 * @param {D1Database} db
 */
export async function listPlatformBusinessSeasons(db) {
  const result = await db
    .prepare(
      `SELECT id, code, label, status, created_at, updated_at
       FROM business_seasons
       ORDER BY created_at ASC, id ASC`,
    )
    .all()
  return (result.results ?? []).map(mapBusinessSeasonRow)
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 */
export async function getPlatformBusinessSeasonById(db, seasonId) {
  const id = String(seasonId ?? '').trim()
  if (!id) return { ok: false, status: 404, code: 'not_found', message: 'Season not found.' }
  const row = await db
    .prepare(
      `SELECT id, code, label, status, created_at, updated_at
       FROM business_seasons WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Season not found.' }
  }
  return { ok: true, season: mapBusinessSeasonRow(row) }
}

/**
 * @param {D1Database} db
 * @param {{ id?: string, code?: string, label?: string }} input
 */
export async function createPlatformBusinessSeason(db, input) {
  const id = String(input.id ?? '').trim()
  const code = String(input.code ?? '').trim()
  const label = String(input.label ?? '').trim()

  const idErr = validateSeasonId(id)
  if (idErr) {
    return { ok: false, status: 400, code: 'validation_error', message: idErr }
  }
  const codeErr = validateSeasonCode(code)
  if (codeErr) {
    return { ok: false, status: 400, code: 'validation_error', message: codeErr }
  }
  if (!label) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Label is required.' }
  }

  const existingId = await db.prepare('SELECT id FROM business_seasons WHERE id = ? LIMIT 1').bind(id).first()
  if (existingId) {
    return { ok: false, status: 409, code: 'conflict', message: 'A season with this id already exists.' }
  }
  const existingCode = await db
    .prepare('SELECT id FROM business_seasons WHERE code = ? LIMIT 1')
    .bind(code)
    .first()
  if (existingCode) {
    return { ok: false, status: 409, code: 'conflict', message: 'A season with this code already exists.' }
  }

  try {
    await db
      .prepare(
        `INSERT INTO business_seasons (id, code, label, status)
         VALUES (?, ?, ?, 'active')`,
      )
      .bind(id, code, label)
      .run()
  } catch (err) {
    return mapSeasonConstraintError(err)
  }

  const created = await getPlatformBusinessSeasonById(db, id)
  if (!created.ok) {
    return { ok: false, status: 500, code: 'internal_error', message: 'Season was created but could not be loaded.' }
  }
  return { ok: true, season: created.season }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {{ code?: string, label?: string }} input
 */
export async function updatePlatformBusinessSeason(db, seasonId, input) {
  const id = String(seasonId ?? '').trim()
  const current = await getPlatformBusinessSeasonById(db, id)
  if (!current.ok) return current

  const hasCode = input.code !== undefined
  const hasLabel = input.label !== undefined
  if (!hasCode && !hasLabel) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'At least one of code or label is required.',
    }
  }

  let nextCode = current.season.code
  let nextLabel = current.season.label

  if (hasCode) {
    const code = String(input.code ?? '').trim()
    const codeErr = validateSeasonCode(code)
    if (codeErr) {
      return { ok: false, status: 400, code: 'validation_error', message: codeErr }
    }
    if (code !== current.season.code) {
      const existingCode = await db
        .prepare('SELECT id FROM business_seasons WHERE code = ? AND id != ? LIMIT 1')
        .bind(code, id)
        .first()
      if (existingCode) {
        return { ok: false, status: 409, code: 'conflict', message: 'A season with this code already exists.' }
      }
      nextCode = code
    }
  }

  if (hasLabel) {
    const label = String(input.label ?? '').trim()
    if (!label) {
      return { ok: false, status: 400, code: 'validation_error', message: 'Label is required.' }
    }
    nextLabel = label
  }

  await db
    .prepare(
      `UPDATE business_seasons
       SET code = ?, label = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(nextCode, nextLabel, id)
    .run()

  const updated = await getPlatformBusinessSeasonById(db, id)
  if (!updated.ok) {
    return { ok: false, status: 500, code: 'internal_error', message: 'Season was updated but could not be loaded.' }
  }
  return { ok: true, season: updated.season }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 */
export async function archivePlatformBusinessSeason(db, seasonId) {
  return setPlatformBusinessSeasonStatus(db, seasonId, 'archived')
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 */
export async function reactivatePlatformBusinessSeason(db, seasonId) {
  return setPlatformBusinessSeasonStatus(db, seasonId, 'active')
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {BusinessSeasonStatus} status
 */
async function setPlatformBusinessSeasonStatus(db, seasonId, status) {
  const id = String(seasonId ?? '').trim()
  const current = await getPlatformBusinessSeasonById(db, id)
  if (!current.ok) return current

  if (current.season.status === status) {
    return { ok: true, season: current.season }
  }

  await db
    .prepare(
      `UPDATE business_seasons
       SET status = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(status, id)
    .run()

  const updated = await getPlatformBusinessSeasonById(db, id)
  if (!updated.ok) {
    return { ok: false, status: 500, code: 'internal_error', message: 'Season status was updated but could not be loaded.' }
  }
  return { ok: true, season: updated.season }
}

/** @param {Record<string, unknown>} row */
function mapBusinessSeasonRow(row) {
  const status = String(row.status ?? '').trim().toLowerCase()
  return {
    id: String(row.id),
    code: String(row.code),
    label: String(row.label),
    status: status === 'archived' ? 'archived' : 'active',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/** @param {string} id */
function validateSeasonId(id) {
  if (!id) return 'Season id is required.'
  if (!SEASON_ID_PATTERN.test(id)) {
    return 'Season id must start with "season-" and use letters, digits, or hyphens only.'
  }
  return null
}

/** @param {string} code */
function validateSeasonCode(code) {
  if (!code) return 'Season code is required.'
  if (!SEASON_CODE_PATTERN.test(code)) {
    return 'Season code must use letters, digits, underscores, or hyphens.'
  }
  return null
}

/** @param {unknown} err */
function mapSeasonConstraintError(err) {
  const message = String(/** @type {{ message?: string }} */ (err)?.message ?? err ?? '')
  if (/UNIQUE constraint failed|SQLITE_CONSTRAINT|duplicate/i.test(message)) {
    return {
      ok: false,
      status: 409,
      code: 'conflict',
      message: 'A season with this id or code already exists.',
    }
  }
  return {
    ok: false,
    status: 500,
    code: 'internal_error',
    message: 'Could not create season.',
  }
}
