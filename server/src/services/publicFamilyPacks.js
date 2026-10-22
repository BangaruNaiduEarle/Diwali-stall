import { paiseToInr } from './money.js'

export const PUBLIC_FAMILY_PACK_LIST_SQL = `
  SELECT
    fp.id,
    fp.slug,
    fp.name,
    fp.short_description,
    fp.selling_price_paise,
    fp.pack_label,
    fp.sort_order
  FROM family_packs fp
  WHERE fp.active = 1
  ORDER BY fp.sort_order ASC, fp.id ASC
`.trim()

export const PUBLIC_FAMILY_PACK_BY_SLUG_SQL = `
  SELECT
    fp.id,
    fp.slug,
    fp.name,
    fp.short_description,
    fp.selling_price_paise,
    fp.pack_label,
    fp.sort_order
  FROM family_packs fp
  WHERE fp.slug = ? AND fp.active = 1
`.trim()

export const PUBLIC_FAMILY_PACK_AVAILABILITY_SQL = `
  SELECT id, name, active, archived, selling_price_paise
  FROM family_packs
  WHERE id = ?
`.trim()

/** @param {Record<string, unknown>} row */
function mapPublicPackCore(row) {
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
  }
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown>[]} imageRows
 */
function mapPublicImages(imageRows) {
  const images = (imageRows ?? [])
    .map((row) => ({
      url: String(row.url),
      sortOrder: Number(row.sort_order),
      isCover: Boolean(row.is_cover),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const cover = images.find((i) => i.isCover) ?? images[0] ?? null
  return {
    images: images.map(({ url, sortOrder, isCover }) => ({ url, sortOrder, isCover })),
    coverImageUrl: cover?.url ?? null,
  }
}

/**
 * @param {D1Database} db
 */
export async function listPublicFamilyPacks(db) {
  const result = await db.prepare(PUBLIC_FAMILY_PACK_LIST_SQL).bind().all()
  const packs = result.results ?? []
  if (!packs.length) return []

  const ids = packs.map((p) => String(p.id))
  const placeholders = ids.map(() => '?').join(', ')
  const imagesResult = await db
    .prepare(
      `SELECT family_pack_id, url, sort_order, is_cover
       FROM family_pack_images
       WHERE family_pack_id IN (${placeholders})
       ORDER BY sort_order ASC, id ASC`,
    )
    .bind(...ids)
    .all()

  /** @type {Map<string, Record<string, unknown>[]>} */
  const imagesByPack = new Map()
  for (const row of imagesResult.results ?? []) {
    const key = String(row.family_pack_id)
    if (!imagesByPack.has(key)) imagesByPack.set(key, [])
    imagesByPack.get(key).push(row)
  }

  return packs.map((row) => {
    const core = mapPublicPackCore(row)
    const { images, coverImageUrl } = mapPublicImages(imagesByPack.get(core.id) ?? [])
    return { ...core, coverImageUrl, images }
  })
}

/**
 * @param {D1Database} db
 * @param {string} slug
 */
export async function getPublicFamilyPackBySlug(db, slug) {
  const packRow = await db.prepare(PUBLIC_FAMILY_PACK_BY_SLUG_SQL).bind(slug).first()
  if (!packRow) return null

  const id = String(packRow.id)
  const imagesResult = await db
    .prepare(
      `SELECT url, sort_order, is_cover FROM family_pack_images
       WHERE family_pack_id = ? ORDER BY sort_order ASC, id ASC`,
    )
    .bind(id)
    .all()

  const itemsResult = await db
    .prepare(
      `SELECT
         fpi.quantity,
         fpi.unit_label,
         fpi.sort_order,
         p.id AS product_id,
         p.name AS product_name,
         p.pack AS product_pack
       FROM family_pack_items fpi
       INNER JOIN products p ON p.id = fpi.product_id AND p.active = 1
       WHERE fpi.family_pack_id = ?
       ORDER BY fpi.sort_order ASC, fpi.id ASC`,
    )
    .bind(id)
    .all()

  const core = mapPublicPackCore(packRow)
  const { images, coverImageUrl } = mapPublicImages(imagesResult.results ?? [])
  const items = (itemsResult.results ?? []).map((row) => ({
    productId: String(row.product_id),
    name: String(row.product_name),
    quantity: Number(row.quantity),
    unit: String(row.unit_label || row.product_pack || '').trim() || '—',
    sortOrder: Number(row.sort_order),
  }))

  return { ...core, coverImageUrl, images, items }
}

/**
 * @param {D1Database} db
 * @param {string} familyPackId
 */
export async function assertFamilyPackAvailableForRequest(db, familyPackId) {
  const row = await db.prepare(PUBLIC_FAMILY_PACK_AVAILABILITY_SQL).bind(familyPackId).first()
  if (!row) return { ok: false, message: 'Family pack not found.' }
  if (Number(row.active) !== 1) return { ok: false, message: 'Family pack is not available.' }
  return {
    ok: true,
    name: String(row.name),
    sellingPricePaise: Number(row.selling_price_paise),
  }
}
