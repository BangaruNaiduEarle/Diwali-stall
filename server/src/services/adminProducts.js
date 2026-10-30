import { getPricingReconciliationMeta } from '../lib/pricingReconciliationMap.js'
import {
  LIMITS,
  isValidProductId,
  isValidStockStatus,
  validateImagePaths,
} from '../lib/validation.js'
import { filterProductsForQuickBillSearch } from '../../../src/lib/quickBillProductSearch.js'
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
    p.final_price_paise,
    p.pieces_per_pack,
    p.allow_loose_sale,
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
  let sellingPricePaise =
    row.selling_price_paise === null || row.selling_price_paise === undefined
      ? null
      : Number(row.selling_price_paise)
  const hasSellingPrice =
    sellingPricePaise !== null && Number.isInteger(sellingPricePaise) && sellingPricePaise > 0
  let finalPricePaise =
    row.final_price_paise === null || row.final_price_paise === undefined
      ? null
      : Number(row.final_price_paise)
  const hasFinalPrice =
    finalPricePaise !== null && Number.isInteger(finalPricePaise) && finalPricePaise > 0
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
    sellingPriceInr: hasSellingPrice ? paiseToInr(sellingPricePaise) : null,
    hasSellingPrice,
    finalPricePaise,
    finalPriceInr: hasFinalPrice ? paiseToInr(finalPricePaise) : null,
    hasFinalPrice,
    piecesPerPack:
      row.pieces_per_pack === null || row.pieces_per_pack === undefined
        ? null
        : Number(row.pieces_per_pack),
    allowLooseSale: Number(row.allow_loose_sale) === 1,
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
 *   flexSearch?: boolean
 * }} opts
 */
const QUICK_BILL_FLEX_SEARCH_CATALOGUE_CAP = 2500

export async function listAdminProductsPage(db, opts) {
  const flexQuery = opts.flexSearch && opts.q && String(opts.q).trim()
  if (flexQuery) {
    const q = String(opts.q).trim()
    const catalogue = await listAdminProductsPage(db, {
      ...opts,
      flexSearch: false,
      q: undefined,
      limit: QUICK_BILL_FLEX_SEARCH_CATALOGUE_CAP,
      offset: 0,
    })
    const filtered = filterProductsForQuickBillSearch(catalogue.products, q)
    const total = filtered.length
    const offset = Math.max(0, Number(opts.offset) || 0)
    const limit = Math.max(1, Number(opts.limit) || 25)
    return {
      products: filtered.slice(offset, offset + limit),
      total,
    }
  }

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
    wheres.push('(p.selling_price_paise IS NULL OR p.selling_price_paise <= 0)')
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
  let final_price_paise = null
  if (body.finalPriceInr !== undefined && body.finalPriceInr !== null && body.finalPriceInr !== '') {
    final_price_paise = inrToPaise(Number(body.finalPriceInr))
  }

  await db
    .prepare(
      `INSERT INTO products (
        id, category_slug, name, pack, description, featured, stock_status,
        active, sort_order, images_json, company, selling_price_paise, final_price_paise,
        pieces_per_pack, allow_loose_sale
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      final_price_paise,
      resolvePiecesPerPackBind(body.piecesPerPack),
      body.allowLooseSale === true ? 1 : 0,
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
  if (body.finalPriceInr !== undefined) {
    if (body.finalPriceInr === null || body.finalPriceInr === '') {
      sets.push('final_price_paise = ?')
      binds.push(null)
    } else {
      sets.push('final_price_paise = ?')
      binds.push(inrToPaise(Number(body.finalPriceInr)))
    }
  }
  if (body.piecesPerPack !== undefined) {
    sets.push('pieces_per_pack = ?')
    binds.push(resolvePiecesPerPackBind(body.piecesPerPack))
  }
  if (body.allowLooseSale !== undefined) {
    sets.push('allow_loose_sale = ?')
    binds.push(body.allowLooseSale ? 1 : 0)
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
  return setAdminProductActive(db, id, false)
}

/** @param {D1Database} db @param {string} id */
export async function restoreAdminProduct(db, id) {
  return setAdminProductActive(db, id, true)
}

/** @param {D1Database} db @param {string} id @param {boolean} active */
export async function setAdminProductActive(db, id, active) {
  return setActiveFlag(db, id, active ? 1 : 0)
}

/** @param {D1Database} db @param {string} productId */
export async function countProductReferenceRows(db, productId) {
  const id = String(productId)
  const tables = [
    'SELECT COUNT(*) AS total FROM customer_request_items WHERE product_id = ?',
    'SELECT COUNT(*) AS total FROM family_pack_items WHERE product_id = ?',
    'SELECT COUNT(*) AS total FROM quotation_items WHERE product_id = ?',
  ]
  let total = 0
  for (const sql of tables) {
    const row = await db.prepare(sql).bind(id).first()
    total += Number(row?.total ?? 0)
  }
  return total
}

/**
 * @param {D1Database} db
 * @param {string} id
 */
export async function deleteAdminProduct(db, id) {
  const productId = String(id ?? '').trim()
  if (!isValidProductId(productId)) {
    return { ok: false, errors: { id: 'Invalid product id.' } }
  }
  const existing = await db.prepare('SELECT id, name FROM products WHERE id = ?').bind(productId).first()
  if (!existing) {
    return { ok: false, status: 404, error: 'not_found', message: 'Product not found.' }
  }
  const referenceCount = await countProductReferenceRows(db, productId)
  if (referenceCount > 0) {
    return {
      ok: false,
      status: 409,
      error: 'product_referenced',
      message:
        'This product appears on customer requests, quotations, or family packs. Those records must be preserved. Deactivate the product instead of deleting it.',
      referenceCount,
    }
  }
  const run = await db.prepare('DELETE FROM products WHERE id = ?').bind(productId).run()
  if (!run.meta?.changes) {
    return { ok: false, status: 404, error: 'not_found', message: 'Product not found.' }
  }
  return { ok: true, id: productId, name: String(existing.name ?? '') }
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

  if (body.piecesPerPack !== undefined && body.piecesPerPack !== null && body.piecesPerPack !== '') {
    const n = Number(body.piecesPerPack)
    if (!Number.isInteger(n) || n <= 0) {
      errors.piecesPerPack = 'Pieces per Pack must be a positive whole number.'
    }
  }

  if (body.allowLooseSale !== undefined && body.allowLooseSale !== null) {
    const v = body.allowLooseSale
    if (typeof v !== 'boolean' && v !== 0 && v !== 1 && v !== '0' && v !== '1') {
      errors.allowLooseSale = 'Invalid allow loose sale value.'
    }
  }

  return errors
}

/** @param {unknown} value */
function resolvePiecesPerPackBind(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}
