import { getPricingReconciliationMeta } from '../lib/pricingReconciliationMap.js'
import {
  LIMITS,
  isValidProductId,
  isValidStockStatus,
  validateImagePaths,
} from '../lib/validation.js'
import { filterProductsForQuickBillSearch } from '../../../src/lib/quickBillProductSearch.js'
import { inrToPaise, paiseToInr } from './money.js'
import { adminCatalogueScope } from '../lib/adminCatalogueScope.js'

const ADMIN_PRODUCT_COLUMNS = `
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
`
const ADMIN_PRODUCT_SELECT = `${ADMIN_PRODUCT_COLUMNS}  FROM products p
  INNER JOIN categories c ON c.slug = p.category_slug AND c.season_id = p.season_id
  LEFT JOIN private_rates pr ON pr.product_id = p.id AND pr.effective_to IS NULL AND pr.season_id = p.season_id
  LEFT JOIN product_purchase_rates ppr ON ppr.product_id = p.id AND ppr.effective_to IS NULL AND ppr.season_id = p.season_id
`

const LOCATION_PRODUCT_FROM = `FROM products p
  INNER JOIN categories c ON c.slug = p.category_slug AND c.location_id = p.location_id
  LEFT JOIN private_rates pr ON pr.product_id = p.id AND pr.effective_to IS NULL AND pr.location_id = p.location_id
  LEFT JOIN product_purchase_rates ppr ON ppr.product_id = p.id AND ppr.effective_to IS NULL AND ppr.location_id = p.location_id`

const productSelect = (scope) => scope.locationId
  ? `${ADMIN_PRODUCT_COLUMNS}  ${LOCATION_PRODUCT_FROM}` : ADMIN_PRODUCT_SELECT

// Used on mutations too: malformed cross-location category references are never
// made visible or mutated by an ID-only parent check.
const ownedCategory = (scope) => scope.locationId
  ? ' AND EXISTS (SELECT 1 FROM categories c WHERE c.slug = products.category_slug AND c.location_id = products.location_id)' : ''

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
 *   seasonId: string
 * }} opts
 */
const QUICK_BILL_FLEX_SEARCH_CATALOGUE_CAP = 2500

export async function listAdminProductsPage(db, opts) {
  const scope = adminCatalogueScope(db, opts.seasonId, opts.context)
  const seasonId = scope.seasonId
  const flexQuery = opts.flexSearch && opts.q && String(opts.q).trim()
  if (flexQuery) {
    const q = String(opts.q).trim()
    const catalogue = await listAdminProductsPage(db, {
      ...opts,
      seasonId,
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

  const wheres = [`p.${scope.column} = ?`]
  const binds = [scope.value]

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
  const countSql = scope.locationId ? `SELECT COUNT(*) AS total ${LOCATION_PRODUCT_FROM} ${whereSql}` : `
    SELECT COUNT(*) AS total
    FROM products p
    INNER JOIN categories c ON c.slug = p.category_slug AND c.season_id = p.season_id
    LEFT JOIN private_rates pr ON pr.product_id = p.id AND pr.effective_to IS NULL AND pr.season_id = p.season_id
    LEFT JOIN product_purchase_rates ppr ON ppr.product_id = p.id AND ppr.effective_to IS NULL AND ppr.season_id = p.season_id
    ${whereSql}
  `
  const listSql = `${productSelect(scope)} ${whereSql} ORDER BY p.sort_order ASC, p.id ASC LIMIT ? OFFSET ?`

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
  const scope = adminCatalogueScope(db, opts.seasonId, opts.context)
  const includeArchived = Boolean(opts.includeArchived)
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 100))
  const offset = Math.max(0, Number(opts.offset) || 0)

  const activeClause = includeArchived ? '' : ' AND p.active = 1'
  const sql = `${productSelect(scope)} WHERE p.${scope.column} = ?${activeClause} ORDER BY p.sort_order ASC, p.id ASC LIMIT ? OFFSET ?`
  const result = await db.prepare(sql).bind(scope.value, limit, offset).all()
  return (result.results ?? []).map(mapAdminProductRow)
}

/** @param {D1Database} db @param {string} seasonId @param {string} id */
export async function getAdminProductById(db, seasonId, id, context) {
  const scope = adminCatalogueScope(db, seasonId, context)
  const result = await db
    .prepare(`${productSelect(scope)} WHERE p.id = ? AND p.${scope.column} = ?`)
    .bind(id, scope.value)
    .first()
  return result ? mapAdminProductRow(result) : null
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown>} body
 */
export async function createAdminProduct(db, seasonId, body, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const season = scope.seasonId
  const errors = validateProductPayload(body, { isCreate: true })
  if (Object.keys(errors).length) return { ok: false, errors }

  const id = String(body.id).trim()
  const exists = await db.prepare('SELECT 1 FROM products WHERE id = ?').bind(id).first()
  if (exists) return { ok: false, errors: { id: 'Product id already exists.' } }

  const category_slug = String(body.categorySlug).trim()
  const cat = await db
    .prepare(`SELECT 1 FROM categories WHERE slug = ? AND ${scope.column} = ?`)
    .bind(category_slug, scope.value)
    .first()
  if (!cat) return { ok: false, errors: { categorySlug: 'Unknown category.' } }

  const images = /** @type {string[]} */ (body.images ?? [])
  const images_json = JSON.stringify(images)

  let selling_price_paise = null
  if (body.sellingPriceInr !== undefined && body.sellingPriceInr !== null && body.sellingPriceInr !== '') {
    selling_price_paise = inrToPaise(Number(body.sellingPriceInr))
  }
  let final_price_paise = null
  if (body.finalPriceInr !== undefined && body.finalPriceInr !== null && body.finalPriceInr !== '') {
    final_price_paise = inrToPaise(Number(body.finalPriceInr))
  }

  const insertSql = scope.locationId ? `INSERT INTO products (
    id, category_slug, name, pack, description, featured, stock_status,
    active, sort_order, images_json, company, selling_price_paise, final_price_paise,
    pieces_per_pack, allow_loose_sale, season_id, location_id
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM categories WHERE slug = ? AND location_id = ?)` :
      `INSERT INTO products (
        id, category_slug, name, pack, description, featured, stock_status,
        active, sort_order, images_json, company, selling_price_paise, final_price_paise,
        pieces_per_pack, allow_loose_sale, season_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  let inserted
  try {
    inserted = await db
      .prepare(insertSql)
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
        season,
        ...(scope.locationId ? [scope.locationId, category_slug, scope.locationId] : []),
      )
      .run()
  } catch (error) {
    if (scope.locationId && /UNIQUE constraint failed: products\.id/i.test(String(error?.message))) {
      return { ok: false, errors: { id: 'Product id already exists.' } }
    }
    throw error
  }
  if (scope.locationId && !inserted.meta?.changes) return { ok: false, errors: { categorySlug: 'Unknown category.' } }

  const product = await getAdminProductById(db, season, id, context)
  return { ok: true, product }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {string} id
 * @param {Record<string, unknown>} body
 */
export async function updateAdminProduct(db, seasonId, id, body, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const season = scope.seasonId
  const productId = String(id).trim()
  if (!isValidProductId(productId)) {
    return { ok: false, errors: { id: 'Invalid product id.' } }
  }

  const existing = await db
    .prepare(`SELECT id FROM products WHERE id = ? AND ${scope.column} = ?${ownedCategory(scope)}`)
    .bind(productId, scope.value)
    .first()
  if (!existing) return { ok: false, status: 404, code: 'not_found' }

  const errors = validateProductPayload(body, { isCreate: false, partial: true })
  if (Object.keys(errors).length) return { ok: false, errors }

  const sets = []
  const binds = []

  if (body.categorySlug !== undefined) {
    const category_slug = String(body.categorySlug).trim()
    const cat = await db
      .prepare(`SELECT 1 FROM categories WHERE slug = ? AND ${scope.column} = ?`)
      .bind(category_slug, scope.value)
      .first()
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

  const targetCategory = scope.locationId && body.categorySlug !== undefined
    ? ' AND EXISTS (SELECT 1 FROM categories c WHERE c.slug = ? AND c.location_id = ?)' : ''
  const updated = await db
    .prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND ${scope.column} = ?${ownedCategory(scope)}${targetCategory}`)
    .bind(...binds, scope.value, ...(targetCategory ? [String(body.categorySlug).trim(), scope.locationId] : []))
    .run()
  if (scope.locationId && !updated.meta?.changes) return { ok: false, status: 404, code: 'not_found' }

  const product = await getAdminProductById(db, season, productId, context)
  return { ok: true, product }
}

/** @param {D1Database} db @param {string} seasonId @param {string} id */
export async function archiveAdminProduct(db, seasonId, id, context) {
  return setAdminProductActive(db, seasonId, id, false, context)
}

/** @param {D1Database} db @param {string} seasonId @param {string} id */
export async function restoreAdminProduct(db, seasonId, id, context) {
  return setAdminProductActive(db, seasonId, id, true, context)
}

/** @param {D1Database} db @param {string} seasonId @param {string} id @param {boolean} active */
export async function setAdminProductActive(db, seasonId, id, active, context) {
  return setActiveFlag(db, seasonId, id, active ? 1 : 0, context)
}

/** @param {D1Database} db @param {string} productId */
async function countProductReferenceRows(db, productId, scope) {
  const id = String(productId)
  const tables = [
    'SELECT COUNT(*) AS total FROM customer_request_items WHERE product_id = ?',
    'SELECT COUNT(*) AS total FROM family_pack_items WHERE product_id = ?',
    'SELECT COUNT(*) AS total FROM quotation_items WHERE product_id = ?',
  ]
  let total = 0
  for (const sql of tables) {
    // References across ALL seasons must still block deletion. Only the owned
    // product is selected; filtering its historical references would break FKs.
    const ownedSql = scope?.locationId
      ? `${sql} AND EXISTS (SELECT 1 FROM products p WHERE p.id = ? AND p.location_id = ?)` : sql
    const row = await db.prepare(ownedSql).bind(id, ...(scope?.locationId ? [id, scope.locationId] : [])).first()
    total += Number(row?.total ?? 0)
  }
  return total
}

/**
 * @param {D1Database} db
 * @param {string} id
 */
export async function deleteAdminProduct(db, seasonId, id, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const productId = String(id ?? '').trim()
  if (!isValidProductId(productId)) {
    return { ok: false, errors: { id: 'Invalid product id.' } }
  }
  const existing = await db
    .prepare(`SELECT id, name FROM products WHERE id = ? AND ${scope.column} = ?${ownedCategory(scope)}`)
    .bind(productId, scope.value)
    .first()
  if (!existing) {
    return { ok: false, status: 404, error: 'not_found', message: 'Product not found.' }
  }
  const referenceCount = await countProductReferenceRows(db, productId, scope)
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
  const run = await db
    .prepare(`DELETE FROM products WHERE id = ? AND ${scope.column} = ?${ownedCategory(scope)}`)
    .bind(productId, scope.value)
    .run()
  if (!run.meta?.changes) {
    return { ok: false, status: 404, error: 'not_found', message: 'Product not found.' }
  }
  return { ok: true, id: productId, name: String(existing.name ?? '') }
}

/** @param {D1Database} db @param {string} seasonId @param {string} id @param {0|1} active */
async function setActiveFlag(db, seasonId, id, active, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const season = scope.seasonId
  const productId = String(id).trim()
  if (!isValidProductId(productId)) {
    return { ok: false, errors: { id: 'Invalid product id.' } }
  }
  await db
    .prepare(`UPDATE products SET active = ?, updated_at = datetime('now') WHERE id = ? AND ${scope.column} = ?${ownedCategory(scope)}`)
    .bind(active, productId, scope.value)
    .run()
  const stillThere = await db
    .prepare(`SELECT id FROM products WHERE id = ? AND ${scope.column} = ?${ownedCategory(scope)}`)
    .bind(productId, scope.value)
    .first()
  if (!stillThere) {
    return { ok: false, status: 404, code: 'not_found' }
  }
  const product = await getAdminProductById(db, season, productId, context)
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
