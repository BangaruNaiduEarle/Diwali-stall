import { getCataloguePublicPriceInr } from '../lib/cataloguePublicPrices.js'
import { getPricingReconciliationMeta } from '../lib/pricingReconciliationMap.js'
import {
  LIMITS,
  isValidProductId,
  isValidStockStatus,
  validateImagePaths,
} from '../lib/validation.js'
import { inrToPaise, paiseToInr } from './money.js'

const ADMIN_PRODUCT_SELECT = `
  SELECT
    p.id,
    p.category_slug,
    c.label AS category_label,
    p.name,
    p.pack,
    p.description,
    p.featured,
    p.stock_status,
    p.active,
    p.sort_order,
    p.images_json,
    p.company,
    p.selling_price_paise,
    pr.unit_rate_paise AS x4_selling_paise,
    ppr.unit_rate_paise AS purchase_rate_paise,
    p.created_at,
    p.updated_at
  FROM products p
  INNER JOIN categories c ON c.slug = p.category_slug
  LEFT JOIN private_rates pr ON pr.product_id = p.id AND pr.effective_to IS NULL
  LEFT JOIN product_purchase_rates ppr ON ppr.product_id = p.id AND ppr.effective_to IS NULL
`

/** @param {Record<string, unknown>} row */
export function mapAdminProductRow(row) {
  let images = []
  try {
    const parsed = JSON.parse(String(row.images_json ?? '[]'))
    if (Array.isArray(parsed)) images = parsed
  } catch {
    images = []
  }
  const cataloguePublicPriceInr = getCataloguePublicPriceInr(String(row.id ?? ''))
  const sellingPricePaise =
    row.selling_price_paise === null || row.selling_price_paise === undefined
      ? null
      : Number(row.selling_price_paise)
  const x4SellingPaise =
    row.x4_selling_paise === null || row.x4_selling_paise === undefined
      ? null
      : Number(row.x4_selling_paise)
  const purchaseRatePaise =
    row.purchase_rate_paise === null || row.purchase_rate_paise === undefined
      ? null
      : Number(row.purchase_rate_paise)
  const pricingMeta = getPricingReconciliationMeta(String(row.id ?? ''))

  return {
    id: row.id,
    categorySlug: row.category_slug,
    categoryLabel: row.category_label,
    name: row.name,
    pack: row.pack,
    description: row.description,
    featured: Boolean(row.featured),
    stockStatus: row.stock_status,
    active: Boolean(row.active),
    sortOrder: row.sort_order,
    images,
    company: row.company ?? null,
    sellingPricePaise,
    sellingPriceInr: sellingPricePaise === null ? null : paiseToInr(sellingPricePaise),
    cataloguePublicPriceInr,
    x4SellingPricePaise: x4SellingPaise,
    x4SellingPriceInr: x4SellingPaise === null ? null : paiseToInr(x4SellingPaise),
    hasX4SellingRate: x4SellingPaise !== null,
    /** @deprecated use x4SellingPriceInr */
    privateX4Paise: x4SellingPaise,
    /** @deprecated use x4SellingPriceInr */
    privateX4Inr: x4SellingPaise === null ? null : paiseToInr(x4SellingPaise),
    /** @deprecated use hasX4SellingRate */
    hasPrivateX4Rate: x4SellingPaise !== null,
    purchaseRatePaise,
    purchaseRateInr: purchaseRatePaise === null ? null : paiseToInr(purchaseRatePaise),
    hasPurchaseRate: purchaseRatePaise !== null,
    pricingMapping: pricingMeta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * @param {D1Database} db
 * @param {{
 *   limit: number
 *   offset: number
 *   q?: string
 *   categorySlug?: string | null
 *   activeFilter?: 'all' | 'active' | 'archived'
 *   missingRateOnly?: boolean
 *   missingPurchaseRateOnly?: boolean
 * }} opts
 */
export async function listAdminProductsPage(db, opts) {
  const wheres = []
  const binds = []

  if (opts.activeFilter === 'active') {
    wheres.push('p.active = 1')
  } else if (opts.activeFilter === 'archived') {
    wheres.push('p.active = 0')
  }

  if (opts.categorySlug) {
    wheres.push('p.category_slug = ?')
    binds.push(opts.categorySlug)
  }

  if (opts.q) {
    const q = opts.q.trim()
    if (/^P\d+$/i.test(q)) {
      wheres.push('p.id LIKE ?')
      binds.push(`${q.toUpperCase()}%`)
    } else {
      wheres.push('(p.name LIKE ? COLLATE NOCASE OR p.id LIKE ? COLLATE NOCASE)')
      binds.push(`%${q}%`, `%${q}%`)
    }
  }

  if (opts.missingRateOnly) {
    wheres.push('pr.id IS NULL')
  }

  if (opts.missingPurchaseRateOnly) {
    wheres.push('ppr.id IS NULL')
  }

  const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''
  const countSql = `
    SELECT COUNT(*) AS total
    FROM products p
    INNER JOIN categories c ON c.slug = p.category_slug
    LEFT JOIN private_rates pr ON pr.product_id = p.id AND pr.effective_to IS NULL
    LEFT JOIN product_purchase_rates ppr ON ppr.product_id = p.id AND ppr.effective_to IS NULL
    ${whereSql}
  `
  const listSql = `${ADMIN_PRODUCT_SELECT} ${whereSql} ORDER BY p.sort_order ASC, p.id ASC LIMIT ? OFFSET ?`

  const countRow = await db.prepare(countSql).bind(...binds).first()
  const total = Number(countRow?.total ?? 0)
  const listResult = await db
    .prepare(listSql)
    .bind(...binds, opts.limit, opts.offset)
    .all()

  return {
    products: (listResult.results ?? []).map(mapAdminProductRow),
    total,
  }
}

/**
 * @param {D1Database} db
 * @param {{ includeArchived?: boolean, limit?: number, offset?: number }} opts
 */
export async function listAdminProducts(db, opts = {}) {
  const includeArchived = Boolean(opts.includeArchived)
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 100))
  const offset = Math.max(0, Number(opts.offset) || 0)

  const where = includeArchived ? '' : 'WHERE p.active = 1'
  const sql = `${ADMIN_PRODUCT_SELECT} ${where} ORDER BY p.sort_order ASC, p.id ASC LIMIT ? OFFSET ?`
  const result = await db.prepare(sql).bind(limit, offset).all()
  return (result.results ?? []).map(mapAdminProductRow)
}

/** @param {D1Database} db @param {string} id */
export async function getAdminProductById(db, id) {
  const result = await db
    .prepare(`${ADMIN_PRODUCT_SELECT} WHERE p.id = ?`)
    .bind(id)
    .first()
  return result ? mapAdminProductRow(result) : null
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown>} body
 */
export async function createAdminProduct(db, body) {
  const errors = validateProductPayload(body, { isCreate: true })
  if (Object.keys(errors).length) return { ok: false, errors }

  const id = String(body.id).trim()
  const exists = await db.prepare('SELECT 1 FROM products WHERE id = ?').bind(id).first()
  if (exists) return { ok: false, errors: { id: 'Product id already exists.' } }

  const category_slug = String(body.categorySlug).trim()
  const cat = await db.prepare('SELECT 1 FROM categories WHERE slug = ?').bind(category_slug).first()
  if (!cat) return { ok: false, errors: { categorySlug: 'Unknown category.' } }

  const images = /** @type {string[]} */ (body.images)
  const images_json = JSON.stringify(images)

  let selling_price_paise = null
  if (body.sellingPriceInr !== undefined && body.sellingPriceInr !== null && body.sellingPriceInr !== '') {
    selling_price_paise = inrToPaise(Number(body.sellingPriceInr))
  }

  await db
    .prepare(
      `INSERT INTO products (
        id, category_slug, name, pack, description, featured, stock_status,
        active, sort_order, images_json, company, selling_price_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      category_slug,
      String(body.name).trim(),
      String(body.pack ?? '').trim(),
      String(body.description ?? '').trim(),
      body.featured ? 1 : 0,
      String(body.stockStatus).trim(),
      body.active === false ? 0 : 1,
      Number(body.sortOrder) || 0,
      images_json,
      body.company ? String(body.company).trim() : null,
      selling_price_paise,
    )
    .run()

  const product = await getAdminProductById(db, id)
  return { ok: true, product }
}

/**
 * @param {D1Database} db
 * @param {string} id
 * @param {Record<string, unknown>} body
 */
export async function updateAdminProduct(db, id, body) {
  const productId = String(id).trim()
  if (!isValidProductId(productId)) {
    return { ok: false, errors: { id: 'Invalid product id.' } }
  }

  const existing = await db.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first()
  if (!existing) return { ok: false, status: 404, code: 'not_found' }

  const errors = validateProductPayload(body, { isCreate: false, partial: true })
  if (Object.keys(errors).length) return { ok: false, errors }

  const sets = []
  const binds = []

  if (body.categorySlug !== undefined) {
    const category_slug = String(body.categorySlug).trim()
    const cat = await db.prepare('SELECT 1 FROM categories WHERE slug = ?').bind(category_slug).first()
    if (!cat) return { ok: false, errors: { categorySlug: 'Unknown category.' } }
    sets.push('category_slug = ?')
    binds.push(category_slug)
  }
  if (body.name !== undefined) {
    sets.push('name = ?')
    binds.push(String(body.name).trim())
  }
  if (body.pack !== undefined) {
    sets.push('pack = ?')
    binds.push(String(body.pack).trim())
  }
  if (body.description !== undefined) {
    sets.push('description = ?')
    binds.push(String(body.description).trim())
  }
  if (body.featured !== undefined) {
    sets.push('featured = ?')
    binds.push(body.featured ? 1 : 0)
  }
  if (body.stockStatus !== undefined) {
    sets.push('stock_status = ?')
    binds.push(String(body.stockStatus).trim())
  }
  if (body.active !== undefined) {
    sets.push('active = ?')
    binds.push(body.active ? 1 : 0)
  }
  if (body.sortOrder !== undefined) {
    sets.push('sort_order = ?')
    binds.push(Number(body.sortOrder))
  }
  if (body.images !== undefined) {
    sets.push('images_json = ?')
    binds.push(JSON.stringify(body.images))
  }
  if (body.company !== undefined) {
    sets.push('company = ?')
    binds.push(body.company ? String(body.company).trim() : null)
  }
  if (body.sellingPriceInr !== undefined) {
    if (body.sellingPriceInr === null || body.sellingPriceInr === '') {
      sets.push('selling_price_paise = ?')
      binds.push(null)
    } else {
      sets.push('selling_price_paise = ?')
      binds.push(inrToPaise(Number(body.sellingPriceInr)))
    }
  }

  if (sets.length === 0) {
    return { ok: false, errors: { _body: 'No valid fields to update.' } }
  }

  sets.push("updated_at = datetime('now')")
  binds.push(productId)

  await db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()

  const product = await getAdminProductById(db, productId)
  return { ok: true, product }
}

/** @param {D1Database} db @param {string} id */
export async function archiveAdminProduct(db, id) {
  return setActiveFlag(db, id, 0)
}

/** @param {D1Database} db @param {string} id */
export async function restoreAdminProduct(db, id) {
  return setActiveFlag(db, id, 1)
}

/** @param {D1Database} db @param {string} id @param {0|1} active */
async function setActiveFlag(db, id, active) {
  const productId = String(id).trim()
  if (!isValidProductId(productId)) {
    return { ok: false, errors: { id: 'Invalid product id.' } }
  }
  await db
    .prepare("UPDATE products SET active = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(active, productId)
    .run()
  const stillThere = await db.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first()
  if (!stillThere) {
    return { ok: false, status: 404, code: 'not_found' }
  }
  const product = await getAdminProductById(db, productId)
  return { ok: true, product }
}

/**
 * @param {Record<string, unknown>} body
 * @param {{ isCreate?: boolean, partial?: boolean }} opts
 */
function validateProductPayload(body, opts = {}) {
  const errors = {}
  const partial = Boolean(opts.partial)

  if (opts.isCreate) {
    const id = String(body.id ?? '').trim()
    if (!isValidProductId(id)) errors.id = 'Invalid product id (expected P###).'
  }

  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim()
    if (!name || name.length > LIMITS.name) errors.name = 'Name required (max 200 chars).'
  }

  if (!partial || body.categorySlug !== undefined) {
    const slug = String(body.categorySlug ?? '').trim()
    if (!slug) errors.categorySlug = 'categorySlug required.'
  }

  const stock = body.stockStatus !== undefined ? String(body.stockStatus) : opts.isCreate ? 'available' : undefined
  if (stock !== undefined && !isValidStockStatus(stock)) {
    errors.stockStatus = 'Invalid stockStatus.'
  }

  if (body.images !== undefined) {
    const imgCheck = validateImagePaths(body.images)
    if (!imgCheck.ok) errors.images = imgCheck.errors.join(' ')
  } else if (opts.isCreate) {
    const imgCheck = validateImagePaths(body.images ?? [])
    if (!imgCheck.ok) errors.images = imgCheck.errors.join(' ')
  }

  if (body.company !== undefined && body.company !== null) {
    const company = String(body.company).trim()
    if (company.length > LIMITS.company) errors.company = 'Company too long.'
  }

  if (body.description !== undefined && String(body.description).length > LIMITS.description) {
    errors.description = 'Description too long.'
  }

  return errors
}
