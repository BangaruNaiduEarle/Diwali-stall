/**
 * Public catalogue reads — never joins private_rates or exposes rate fields.
 */

/** SQL audited in tests: must not reference private_rates or rate columns. */
export const PUBLIC_PRODUCT_LIST_SQL = `
  SELECT
    p.id,
    p.category_slug,
    c.label AS category_label,
    p.name,
    p.pack,
    p.description,
    p.featured,
    p.stock_status,
    p.sort_order,
    p.images_json
  FROM products p
  INNER JOIN categories c ON c.slug = p.category_slug
  WHERE p.active = 1
  ORDER BY p.sort_order ASC, p.id ASC
  LIMIT ? OFFSET ?
`.trim()

export const PUBLIC_PRODUCT_BY_ID_SQL = `
  SELECT
    p.id,
    p.category_slug,
    c.label AS category_label,
    p.name,
    p.pack,
    p.description,
    p.featured,
    p.stock_status,
    p.sort_order,
    p.images_json
  FROM products p
  INNER JOIN categories c ON c.slug = p.category_slug
  WHERE p.id = ? AND p.active = 1
`.trim()

/** Approved public API fields only. */
export const PUBLIC_PRODUCT_FIELD_KEYS = [
  'id',
  'categorySlug',
  'categoryLabel',
  'name',
  'pack',
  'description',
  'featured',
  'stockStatus',
  'sortOrder',
  'images',
]

/** @param {Record<string, unknown>} row */
export function mapPublicProductRow(row) {
  let images = []
  try {
    const parsed = JSON.parse(String(row.images_json ?? '[]'))
    if (Array.isArray(parsed)) images = parsed
  } catch {
    images = []
  }

  return {
    id: row.id,
    categorySlug: row.category_slug,
    categoryLabel: row.category_label,
    name: row.name,
    pack: row.pack,
    description: row.description,
    featured: Boolean(row.featured),
    stockStatus: row.stock_status,
    sortOrder: row.sort_order,
    images,
  }
}

/**
 * @param {D1Database} db
 * @param {{ limit?: number, offset?: number }} [opts]
 */
export async function listPublicProducts(db, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50))
  const offset = Math.max(0, Number(opts.offset) || 0)
  const result = await db
    .prepare(PUBLIC_PRODUCT_LIST_SQL)
    .bind(limit, offset)
    .all()
  const rows = result.results ?? []
  return rows.map(mapPublicProductRow)
}

/** @param {D1Database} db @param {string} id */
export async function getPublicProductById(db, id) {
  const productId = String(id ?? '').trim()
  const row = await db.prepare(PUBLIC_PRODUCT_BY_ID_SQL).bind(productId).first()
  return row ? mapPublicProductRow(row) : null
}
