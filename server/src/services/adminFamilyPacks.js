import {
  isValidFamilyPackId,
  isValidFamilyPackSlug,
  normalizeFamilyPackSlug,
  validateFamilyPackPayload,
} from '../lib/familyPackValidation.js'
import { paiseToInr } from './money.js'

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
 * @param {{ includeArchived?: boolean, includeInactive?: boolean, q?: string }} [opts]
 */
export async function listAdminFamilyPacks(db, opts = {}) {
  const includeInactive = opts.includeInactive !== false
  const q = String(opts.q ?? '').trim().toLowerCase()

  const clauses = []
  if (!includeInactive) clauses.push('fp.active = 1')
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const sql = `${PACK_SELECT} ${where} ORDER BY fp.sort_order ASC, fp.id ASC`
  const result = await db.prepare(sql).bind().all()
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

/** @param {D1Database} db @param {string} id */
export async function getAdminFamilyPackById(db, id) {
  if (!isValidFamilyPackId(id)) return null
  const packRow = await db.prepare(`${PACK_SELECT} WHERE fp.id = ?`).bind(id).first()
  if (!packRow) return null

  const imagesResult = await db
    .prepare(
      `SELECT id, url, sort_order, is_cover FROM family_pack_images
       WHERE family_pack_id = ? ORDER BY sort_order ASC, id ASC`,
    )
    .bind(id)
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
       INNER JOIN products p ON p.id = fpi.product_id
       WHERE fpi.family_pack_id = ?
       ORDER BY fpi.sort_order ASC, fpi.id ASC`,
    )
    .bind(id)
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
 * @param {Record<string, unknown>} body
 */
export async function createAdminFamilyPack(db, body) {
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
    const product = await db.prepare('SELECT 1 FROM products WHERE id = ?').bind(item.productId).first()
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
          sort_order, active, archived, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
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
      ),
  ]

  data.images.forEach((img, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO family_pack_images (family_pack_id, sort_order, url, is_cover)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(id, img.sortOrder ?? index, img.url, img.isCover ? 1 : 0),
    )
  })

  data.items.forEach((item, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO family_pack_items (family_pack_id, product_id, quantity, unit_label, sort_order)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(id, item.productId, item.quantity, item.unitLabel, item.sortOrder ?? index),
    )
  })

  await db.batch(statements)
  const pack = await getAdminFamilyPackById(db, id)
  return { ok: true, pack }
}

/**
 * @param {D1Database} db
 * @param {string} id
 * @param {Record<string, unknown>} body
 */
export async function updateAdminFamilyPack(db, id, body) {
  if (!isValidFamilyPackId(id)) return { ok: false, errors: { id: 'Invalid family pack id.' } }
  const existing = await db.prepare('SELECT id, slug FROM family_packs WHERE id = ?').bind(id).first()
  if (!existing) return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }

  const validated = validateFamilyPackPayload(body, { isCreate: false })
  if (!validated.ok) return validated

  const { data } = validated
  const existingFull = await getAdminFamilyPackById(db, id)
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
      const product = await db.prepare('SELECT 1 FROM products WHERE id = ?').bind(item.productId).first()
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
        WHERE id = ?`,
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
      ),
  ]

  if (body.images !== undefined) {
    statements.push(db.prepare('DELETE FROM family_pack_images WHERE family_pack_id = ?').bind(id))
    data.images.forEach((img, index) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO family_pack_images (family_pack_id, sort_order, url, is_cover)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(id, img.sortOrder ?? index, img.url, img.isCover ? 1 : 0),
      )
    })
  }

  if (body.items !== undefined) {
    statements.push(db.prepare('DELETE FROM family_pack_items WHERE family_pack_id = ?').bind(id))
    data.items.forEach((item, index) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO family_pack_items (family_pack_id, product_id, quantity, unit_label, sort_order)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(id, item.productId, item.quantity, item.unitLabel, item.sortOrder ?? index),
      )
    })
  }

  await db.batch(statements)
  const pack = await getAdminFamilyPackById(db, id)
  return { ok: true, pack }
}

/** @param {D1Database} db @param {string} id @param {boolean} active */
export async function setAdminFamilyPackActive(db, id, active) {
  if (!isValidFamilyPackId(id)) return { ok: false, errors: { id: 'Invalid family pack id.' } }
  const result = await db
    .prepare(`UPDATE family_packs SET active = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(active ? 1 : 0, id)
    .run()
  if (!result.meta.changes) {
    const row = await db.prepare('SELECT id FROM family_packs WHERE id = ?').bind(id).first()
    if (!row) return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
    return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
  }
  const pack = await getAdminFamilyPackById(db, id)
  return { ok: true, pack }
}

/** @param {D1Database} db @param {string} id @param {boolean} archived */
export async function setAdminFamilyPackArchived(db, id, archived) {
  if (!isValidFamilyPackId(id)) return { ok: false, errors: { id: 'Invalid family pack id.' } }
  await db
    .prepare(
      `UPDATE family_packs SET
        archived = ?,
        active = CASE WHEN ? = 1 THEN 0 ELSE active END,
        updated_at = datetime('now')
      WHERE id = ?`,
    )
    .bind(archived ? 1 : 0, archived ? 1 : 0, id)
    .run()
  const pack = await getAdminFamilyPackById(db, id)
  if (!pack) return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
  return { ok: true, pack }
}

/** @param {D1Database} db @param {string} id */
export async function countFamilyPackCustomerRequestReferences(db, id) {
  const row = await db
    .prepare('SELECT COUNT(*) AS total FROM customer_request_items WHERE family_pack_id = ?')
    .bind(id)
    .first()
  return Number(row?.total ?? 0)
}

/**
 * Permanently delete a family pack when no customer request lines reference it.
 * Child images and items are removed via ON DELETE CASCADE.
 * @param {D1Database} db
 * @param {string} id
 */
export async function deleteAdminFamilyPack(db, id) {
  if (!isValidFamilyPackId(id)) {
    return { ok: false, errors: { id: 'Invalid family pack id.' } }
  }
  const existing = await db
    .prepare('SELECT id, name FROM family_packs WHERE id = ?')
    .bind(id)
    .first()
  if (!existing) {
    return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
  }

  const referenceCount = await countFamilyPackCustomerRequestReferences(db, id)
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

  const run = await db.prepare('DELETE FROM family_packs WHERE id = ?').bind(id).run()
  if (!run.meta?.changes) {
    return { ok: false, status: 404, error: 'not_found', message: 'Family pack not found.' }
  }

  return { ok: true, id: String(existing.id), name: String(existing.name ?? '') }
}
