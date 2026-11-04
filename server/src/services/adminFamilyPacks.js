import {
  isValidFamilyPackId,
  isValidFamilyPackSlug,
  normalizeFamilyPackSlug,
  validateFamilyPackPayload,
} from '../lib/familyPackValidation.js'
import { paiseToInr } from './money.js'
import { adminCatalogueScope } from '../lib/adminCatalogueScope.js'

const PACK_SELECT = `
  SELECT
    fp.id,
    fp.slug,
    fp.name,
    fp.short_description,
    fp.selling_price_paise,
    fp.pack_label,
    fp.sort_order,
    fp.active,
    fp.archived,
    fp.created_at,
    fp.updated_at
  FROM family_packs fp
`

export const DELETE_FAMILY_PACK_IMAGES_FOR_SEASON_SQL = `
  DELETE FROM family_pack_images
  WHERE family_pack_id = ?
    AND family_pack_id IN (SELECT id FROM family_packs WHERE id = ? AND season_id = ?)
`.trim()

export const DELETE_FAMILY_PACK_ITEMS_FOR_SEASON_SQL = `
  DELETE FROM family_pack_items
  WHERE family_pack_id = ?
    AND family_pack_id IN (SELECT id FROM family_packs WHERE id = ? AND season_id = ?)
`.trim()

const COUNT_FAMILY_PACK_REQUEST_REFS_FOR_SEASON_SQL = `
  SELECT COUNT(*) AS total
  FROM customer_request_items cri
  INNER JOIN customer_requests cr ON cr.id = cri.request_id AND cr.season_id = ?
  WHERE cri.family_pack_id = ?
    AND EXISTS (
      SELECT 1 FROM family_packs fp WHERE fp.id = cri.family_pack_id AND fp.season_id = ?
    )
`.trim()

const packNotFound = () => ({ ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' })

function childDeleteSql(table, scope) {
  if (!scope.locationId) return table === 'family_pack_images'
    ? DELETE_FAMILY_PACK_IMAGES_FOR_SEASON_SQL : DELETE_FAMILY_PACK_ITEMS_FOR_SEASON_SQL
  return `DELETE FROM ${table} WHERE family_pack_id = ?
    AND family_pack_id IN (SELECT id FROM family_packs WHERE id = ? AND location_id = ?)`
}

function imageInsert(db, id, image, index, scope) {
  return db.prepare(scope.locationId
    ? `INSERT INTO family_pack_images (family_pack_id, sort_order, url, is_cover)
       VALUES ((SELECT id FROM family_packs WHERE id = ? AND location_id = ?), ?, ?, ?)`
    : `INSERT INTO family_pack_images (family_pack_id, sort_order, url, is_cover)
       VALUES (?, ?, ?, ?)`)
    .bind(id, ...(scope.locationId ? [scope.locationId] : []), image.sortOrder ?? index, image.url, image.isCover ? 1 : 0)
}

function itemInsert(db, id, item, index, scope) {
  return db.prepare(scope.locationId
    ? `INSERT INTO family_pack_items (family_pack_id, product_id, quantity, unit_label, sort_order)
       VALUES ((SELECT id FROM family_packs WHERE id = ? AND location_id = ?),
               (SELECT id FROM products WHERE id = ? AND location_id = ?), ?, ?, ?)`
    : `INSERT INTO family_pack_items (family_pack_id, product_id, quantity, unit_label, sort_order)
       VALUES (?, ?, ?, ?, ?)`)
    .bind(id, ...(scope.locationId ? [scope.locationId] : []), item.productId,
      ...(scope.locationId ? [scope.locationId] : []), item.quantity, item.unitLabel, item.sortOrder ?? index)
}

async function writePackBatch(db, statements, scope) {
  try {
    await db.batch(statements)
    return { ok: true }
  } catch (error) {
    if (scope.locationId) {
      const message = String(error?.message)
      if (/UNIQUE constraint failed: family_packs\.slug/i.test(message)) {
        return { ok: false, errors: { slug: 'Slug already in use.' } }
      }
      // Guarded scalar subqueries deliberately yield NULL if ownership changes
      // after prevalidation. Existing NOT NULL constraints fail the whole batch,
      // rather than committing a partial replacement of items/images.
      if (/NOT NULL constraint failed: family_pack_(?:images|items)\.family_pack_id/i.test(message)) return packNotFound()
      if (/NOT NULL constraint failed: family_pack_items\.product_id/i.test(message)) {
        return { ok: false, errors: { items: 'A referenced product is no longer available in this location.' } }
      }
    }
    throw error
  }
}

/** @param {string | null | undefined} seasonId */
function requireAdminFamilyPackSeasonId(seasonId) {
  const season = String(seasonId ?? '').trim()
  if (!season) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Active business season is required.',
    }
  }
  return { ok: true, season }
}

/** @param {Record<string, unknown>} row */
export function mapAdminFamilyPackRow(row) {
  const sellingPricePaise = Number(row.selling_price_paise)
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    shortDescription: String(row.short_description ?? ''),
    sellingPricePaise,
    sellingPriceInr: paiseToInr(sellingPricePaise),
    packLabel: row.pack_label ? String(row.pack_label) : null,
    sortOrder: Number(row.sort_order ?? 0),
    active: Boolean(row.active),
    archived: Boolean(row.archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {{ includeArchived?: boolean, includeInactive?: boolean, q?: string }} [opts]
 */
export async function listAdminFamilyPacks(db, seasonId, opts = {}) {
  const scope = adminCatalogueScope(db, seasonId, opts.context)
  const seasonGate = requireAdminFamilyPackSeasonId(seasonId)
  if (!seasonGate.ok) return []

  const includeInactive = opts.includeInactive !== false
  const q = String(opts.q ?? '').trim().toLowerCase()

  const clauses = [`fp.${scope.column} = ?`]
  if (!includeInactive) clauses.push('fp.active = 1')
  const where = `WHERE ${clauses.join(' AND ')}`
  const sql = `${PACK_SELECT} ${where} ORDER BY fp.sort_order ASC, fp.id ASC`
  const result = await db.prepare(sql).bind(scope.value).all()
  let rows = (result.results ?? []).map(mapAdminFamilyPackRow)
  if (q) {
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.slug.includes(q) ||
        r.id.toLowerCase().includes(q),
    )
  }
  return rows
}

/** @param {D1Database} db @param {string} id @param {string} seasonId */
export async function getAdminFamilyPackById(db, id, seasonId, context) {
  const scope = adminCatalogueScope(db, seasonId, context)
  const seasonGate = requireAdminFamilyPackSeasonId(seasonId)
  if (!seasonGate.ok) return null

  if (!isValidFamilyPackId(id)) return null
  const packRow = await db
    .prepare(`${PACK_SELECT} WHERE fp.id = ? AND fp.${scope.column} = ?`)
    .bind(id, scope.value)
    .first()
  if (!packRow) return null

  const imagesResult = await db
    .prepare(
      `SELECT id, url, sort_order, is_cover FROM family_pack_images
       WHERE family_pack_id = ?
         AND family_pack_id IN (SELECT id FROM family_packs WHERE id = ? AND ${scope.column} = ?)
       ORDER BY sort_order ASC, id ASC`,
    )
    .bind(id, id, scope.value)
    .all()

  const itemsResult = await db
    .prepare(
      `SELECT
         fpi.id,
         fpi.product_id,
         fpi.quantity,
         fpi.unit_label,
         fpi.sort_order,
         p.name AS product_name,
         p.pack AS product_pack
       FROM family_pack_items fpi
       INNER JOIN products p ON p.id = fpi.product_id AND p.${scope.column} = ?
       WHERE fpi.family_pack_id = ?
         AND fpi.family_pack_id IN (SELECT id FROM family_packs WHERE id = ? AND ${scope.column} = ?)
       ORDER BY fpi.sort_order ASC, fpi.id ASC`,
    )
    .bind(scope.value, id, id, scope.value)
    .all()

  const pack = mapAdminFamilyPackRow(packRow)
  const images = (imagesResult.results ?? []).map((row) => ({
    id: Number(row.id),
    url: String(row.url),
    sortOrder: Number(row.sort_order),
    isCover: Boolean(row.is_cover),
  }))
  const items = (itemsResult.results ?? []).map((row) => ({
    id: Number(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name),
    productPack: String(row.product_pack ?? ''),
    quantity: Number(row.quantity),
    unitLabel: String(row.unit_label ?? ''),
    sortOrder: Number(row.sort_order),
  }))

  return { ...pack, images, items }
}

/** @param {D1Database} db */
async function allocateFamilyPackId(db) {
  const row = await db
    .prepare(
      `SELECT id FROM family_packs
       WHERE id GLOB 'FP[0-9]*'
       ORDER BY CAST(SUBSTR(id, 3) AS INTEGER) DESC
       LIMIT 1`,
    )
    .bind()
    .first()
  const last = row ? Number(String(row.id).slice(2)) : 0
  const next = Number.isFinite(last) ? last + 1 : 1
  return `FP${String(next).padStart(3, '0')}`
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {Record<string, unknown>} body
 */
export async function createAdminFamilyPack(db, seasonId, body, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const seasonGate = requireAdminFamilyPackSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  const validated = validateFamilyPackPayload(body, { isCreate: true })
  if (!validated.ok) return validated

  const { data } = validated
  const slug = data.slug
  if (!isValidFamilyPackSlug(slug)) {
    return { ok: false, errors: { slug: 'Invalid slug.' } }
  }

  const slugTaken = await db.prepare('SELECT 1 FROM family_packs WHERE slug = ?').bind(slug).first()
  if (slugTaken) return { ok: false, errors: { slug: 'Slug already in use.' } }

  for (const item of data.items) {
    const product = await db
      .prepare(`SELECT 1 FROM products WHERE id = ? AND ${scope.column} = ?`)
      .bind(item.productId, scope.value)
      .first()
    if (!product) {
      return { ok: false, errors: { items: `Product ${item.productId} not found.` } }
    }
  }

  const id = await allocateFamilyPackId(db)
  const statements = [
    db
      .prepare(
        `INSERT INTO family_packs (
          id, slug, name, short_description, selling_price_paise, pack_label,
          sort_order, active, archived, season_id, updated_at${scope.locationId ? ', location_id' : ''}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now')${scope.locationId ? ', ?' : ''})`,
      )
      .bind(
        id,
        slug,
        data.name,
        data.shortDescription,
        data.sellingPricePaise,
        data.packLabel,
        data.sortOrder,
        data.active ? 1 : 0,
        season,
        ...(scope.locationId ? [scope.locationId] : []),
      ),
  ]

  data.images.forEach((img, index) => {
    statements.push(imageInsert(db, id, img, index, scope))
  })

  data.items.forEach((item, index) => {
    statements.push(itemInsert(db, id, item, index, scope))
  })

  const written = await writePackBatch(db, statements, scope)
  if (!written.ok) return written
  const pack = await getAdminFamilyPackById(db, id, season, context)
  if (scope.locationId && !pack) return packNotFound()
  return { ok: true, pack }
}

/**
 * @param {D1Database} db
 * @param {string} id
 * @param {string} seasonId
 * @param {Record<string, unknown>} body
 */
export async function updateAdminFamilyPack(db, id, seasonId, body, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const seasonGate = requireAdminFamilyPackSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  if (!isValidFamilyPackId(id)) return { ok: false, errors: { id: 'Invalid family pack id.' } }
  const existing = await db
    .prepare(`SELECT id, slug FROM family_packs WHERE id = ? AND ${scope.column} = ?`)
    .bind(id, scope.value)
    .first()
  if (!existing) return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }

  const validated = validateFamilyPackPayload(body, { isCreate: false })
  if (!validated.ok) return validated

  const { data } = validated
  const existingFull = await getAdminFamilyPackById(db, id, season, context)
  if (!existingFull) return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
  const sellingPricePaise = data.sellingPricePaise ?? existingFull.sellingPricePaise
  const slug = data.slug || normalizeFamilyPackSlug(String(existing.slug))
  if (!isValidFamilyPackSlug(slug)) {
    return { ok: false, errors: { slug: 'Invalid slug.' } }
  }

  const slugTaken = await db
    .prepare('SELECT 1 FROM family_packs WHERE slug = ? AND id != ?')
    .bind(slug, id)
    .first()
  if (slugTaken) return { ok: false, errors: { slug: 'Slug already in use.' } }

  if (data.items.length) {
    for (const item of data.items) {
      const product = await db
        .prepare(`SELECT 1 FROM products WHERE id = ? AND ${scope.column} = ?`)
        .bind(item.productId, scope.value)
        .first()
      if (!product) {
        return { ok: false, errors: { items: `Product ${item.productId} not found.` } }
      }
    }
  }

  /** @type {D1PreparedStatement[]} */
  const statements = [
    db
      .prepare(
        `UPDATE family_packs SET
          slug = ?,
          name = ?,
          short_description = ?,
          selling_price_paise = ?,
          pack_label = ?,
          sort_order = ?,
          active = ?,
          updated_at = datetime('now')
        WHERE id = ? AND ${scope.column} = ?`,
      )
      .bind(
        slug,
        data.name,
        data.shortDescription,
        sellingPricePaise,
        data.packLabel,
        data.sortOrder,
        data.active ? 1 : 0,
        id,
        scope.value,
      ),
  ]

  if (body.images !== undefined) {
    statements.push(
      db.prepare(childDeleteSql('family_pack_images', scope)).bind(id, id, scope.value),
    )
    data.images.forEach((img, index) => {
      statements.push(
        imageInsert(db, id, img, index, scope),
      )
    })
  }

  if (body.items !== undefined) {
    statements.push(
      db.prepare(childDeleteSql('family_pack_items', scope)).bind(id, id, scope.value),
    )
    data.items.forEach((item, index) => {
      statements.push(
        itemInsert(db, id, item, index, scope),
      )
    })
  }

  const written = await writePackBatch(db, statements, scope)
  if (!written.ok) return written
  const pack = await getAdminFamilyPackById(db, id, season, context)
  if (scope.locationId && !pack) return packNotFound()
  return { ok: true, pack }
}

/** @param {D1Database} db @param {string} id @param {boolean} active @param {string} seasonId */
export async function setAdminFamilyPackActive(db, id, active, seasonId, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const seasonGate = requireAdminFamilyPackSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  if (!isValidFamilyPackId(id)) return { ok: false, errors: { id: 'Invalid family pack id.' } }
  const result = await db
    .prepare(
      `UPDATE family_packs SET active = ?, updated_at = datetime('now') WHERE id = ? AND ${scope.column} = ?`,
    )
    .bind(active ? 1 : 0, id, scope.value)
    .run()
  if (!result.meta.changes) {
    const row = await db
      .prepare(`SELECT id FROM family_packs WHERE id = ? AND ${scope.column} = ?`)
      .bind(id, scope.value)
      .first()
    if (!row) return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
    return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
  }
  const pack = await getAdminFamilyPackById(db, id, season, context)
  return { ok: true, pack }
}

/** @param {D1Database} db @param {string} id @param {boolean} archived @param {string} seasonId */
export async function setAdminFamilyPackArchived(db, id, archived, seasonId, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const seasonGate = requireAdminFamilyPackSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  if (!isValidFamilyPackId(id)) return { ok: false, errors: { id: 'Invalid family pack id.' } }
  await db
    .prepare(
      `UPDATE family_packs SET
        archived = ?,
        active = CASE WHEN ? = 1 THEN 0 ELSE active END,
        updated_at = datetime('now')
      WHERE id = ? AND ${scope.column} = ?`,
    )
    .bind(archived ? 1 : 0, archived ? 1 : 0, id, scope.value)
    .run()
  const pack = await getAdminFamilyPackById(db, id, season, context)
  if (!pack) return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
  return { ok: true, pack }
}

/** @param {D1Database} db @param {string} id @param {string} seasonId */
export async function countFamilyPackCustomerRequestReferences(db, id, seasonId, context) {
  const scope = adminCatalogueScope(db, seasonId, context)
  const seasonGate = requireAdminFamilyPackSeasonId(seasonId)
  if (!seasonGate.ok) return 0
  const { season } = seasonGate

  const row = await db
    // A location-owned pack can be referenced by transactions in older seasons.
    // Count every FK reference, including malformed/unmapped parents, to avoid
    // deleting history. Ownership of the target pack is still required.
    .prepare(scope.locationId ? `SELECT COUNT(*) AS total FROM customer_request_items cri
      WHERE cri.family_pack_id = ? AND EXISTS (
        SELECT 1 FROM family_packs fp WHERE fp.id = cri.family_pack_id AND fp.location_id = ?
      )` : COUNT_FAMILY_PACK_REQUEST_REFS_FOR_SEASON_SQL)
    .bind(...(scope.locationId ? [id, scope.locationId] : [season, id, season]))
    .first()
  return Number(row?.total ?? 0)
}

/**
 * Permanently delete a family pack when no customer request lines reference it.
 * Child images and items are removed via ON DELETE CASCADE.
 * @param {D1Database} db
 * @param {string} id
 * @param {string} seasonId
 */
export async function deleteAdminFamilyPack(db, id, seasonId, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const seasonGate = requireAdminFamilyPackSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  if (!isValidFamilyPackId(id)) {
    return { ok: false, errors: { id: 'Invalid family pack id.' } }
  }
  const existing = await db
    .prepare(`SELECT id, name FROM family_packs WHERE id = ? AND ${scope.column} = ?`)
    .bind(id, scope.value)
    .first()
  if (!existing) {
    return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
  }

  const referenceCount = await countFamilyPackCustomerRequestReferences(db, id, season, context)
  if (referenceCount > 0) {
    return {
      ok: false,
      status: 409,
      error: 'pack_referenced',
      message:
        'This family pack appears on one or more customer request lines. Those records must be preserved. Archive the pack instead of deleting it.',
      referenceCount,
    }
  }

  const run = await db
    .prepare(`DELETE FROM family_packs WHERE id = ? AND ${scope.column} = ?`)
    .bind(id, scope.value)
    .run()
  if (!run.meta?.changes) {
    return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
  }

  return { ok: true, id: String(existing.id), name: String(existing.name ?? '') }
}
