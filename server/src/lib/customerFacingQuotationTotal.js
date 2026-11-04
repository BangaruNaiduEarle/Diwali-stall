import { customerRequestDb, customerRequestScope, validateScopedQuotation } from './adminCustomerRequestScope.js'
import { getPublicCatalogueSeasonId } from '../services/publicFamilyPacks.js'
import { lineTotalPaise, sumPaise } from '../services/money.js'
import { buildQuotationWhatsAppMessage } from './quotationWhatsApp.js'
import { savedBillPricing } from './savedBillPricing.js'

// D1 INTEGER prices must be positive safe integers. Never coerce NULL, booleans
// or malformed values into a usable selling price in location mode.
const positivePrice = value => Number.isSafeInteger(value) && value > 0
function redactItemPricing(item) {
  const next = { ...item, unitRatePaise: null, lineTotalPaise: null, pricingUnavailable: true }
  for (const key of ['unit_rate_paise', 'line_total_paise', 'unitPricePaise', 'unit_price_paise']) {
    if (Object.hasOwn(next, key)) next[key] = null
  }
  return next
}
function verifiedItemPricing(item, unit, quantity, name = item.productName) {
  const total = lineTotalPaise(quantity, unit)
  const next = { ...item, productName: name, unitRatePaise: unit, lineTotalPaise: total }
  delete next.pricingUnavailable
  for (const key of ['unit_rate_paise', 'unitPricePaise', 'unit_price_paise']) {
    if (Object.hasOwn(next, key)) next[key] = unit
  }
  if (Object.hasOwn(next, 'line_total_paise')) next.line_total_paise = total
  return next
}

/**
 * @param {D1Database} db
 * @param {string} productId
 * @returns {Promise<{ boxPaise: number, loosePaise: number | null } | null>}
 */
export async function catalogueSellingUnitRates(db, productId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  const season = String(seasonId ?? '').trim()
  const row = season
    ? await db
        .prepare(
          `SELECT selling_price_paise, pieces_per_pack, allow_loose_sale
           FROM products WHERE id = ? AND season_id = ?`,
        )
        .bind(productId, season)
        .first()
    : await db
        .prepare(
          `SELECT selling_price_paise, pieces_per_pack, allow_loose_sale
           FROM products WHERE id = ?`,
        )
        .bind(productId)
        .first()
  if (!row) return null
  const locationMode = Boolean(customerRequestScope(db))
  if (locationMode && !positivePrice(row.selling_price_paise)) return null
  const boxPaise = Number(row.selling_price_paise)
  if (!Number.isInteger(boxPaise) || boxPaise <= 0) return null
  let loosePaise = null
  if (Number(row.allow_loose_sale) === 1) {
    const pieces = Number(row.pieces_per_pack)
    if (Number.isInteger(pieces) && pieces >= 1 && (!locationMode || Number.isSafeInteger(row.pieces_per_pack))) {
      loosePaise = Math.floor(boxPaise / pieces)
      if (locationMode && !positivePrice(loosePaise)) loosePaise = null
    }
  }
  return { boxPaise, loosePaise }
}

/** @param {unknown} name */
export function isLooseQuotationProductName(name) {
  return String(name ?? '').includes(' (loose pc)')
}

/** @param {unknown} name */
export function stripLooseProductNameSuffix(name) {
  return String(name ?? '').replace(/ \(loose pc\)$/, '')
}

/** @param {unknown} name */
export function withLooseProductNameSuffix(name) {
  const base = stripLooseProductNameSuffix(name)
  return `${base} (loose pc)`
}

/**
 * @param {D1Database} db
 * @param {string} productId
 * @param {unknown} productName
 * @param {unknown} lockedUnitPaise
 */
export async function resolveCatalogueSellingUnitForProductLine(
  db,
  productId,
  productName,
  lockedUnitPaise,
  seasonId,
  context,
) {
  db = customerRequestDb(db, seasonId, context)
  const rates = await catalogueSellingUnitRates(db, productId, seasonId)
  if (!rates) {
    return { ok: false, productId }
  }

  const locked = lockedUnitPaise == null ? null : Number(lockedUnitPaise)
  const looseByName = isLooseQuotationProductName(productName)
  let loose = looseByName
  let unitPaise = rates.boxPaise
  if (looseByName) {
    if (rates.loosePaise == null) {
      return { ok: false, productId }
    }
    unitPaise = rates.loosePaise
  }

  if (Number.isInteger(locked) && locked > 0) {
    if (locked === rates.boxPaise) {
      unitPaise = rates.boxPaise
      loose = false
    } else if (rates.loosePaise != null && locked === rates.loosePaise) {
      unitPaise = rates.loosePaise
      loose = true
    } else if (looseByName && rates.loosePaise != null) {
      unitPaise = rates.loosePaise
      loose = true
    }
  }

  const displayName = loose ? withLooseProductNameSuffix(productName) : stripLooseProductNameSuffix(productName)
  return { ok: true, unitPaise, productName: displayName, loose }
}

/**
 * @param {D1Database} db
 * @param {string | null | undefined} requestId
 */
async function loadRequestItemsByLine(db, requestId, seasonId) {
  if (!requestId) return null
  const season = String(seasonId ?? '').trim()
  const rows = season
    ? await db
        .prepare(
          `SELECT i.line_number, i.product_id, i.family_pack_id, i.product_name, i.quantity, i.unit_price_paise
           FROM customer_request_items i
           INNER JOIN customer_requests r ON r.id = i.request_id
           WHERE i.request_id = ? AND r.season_id = ?`,
        )
        .bind(requestId, season)
        .all()
    : await db
        .prepare(
          `SELECT line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise
           FROM customer_request_items WHERE request_id = ?`,
        )
        .bind(requestId)
        .all()
  return new Map((rows.results ?? []).map((row) => [Number(row.line_number), row]))
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown>} quotation
 * @param {string | null | undefined} requestId
 * @returns {Promise<string | null>}
 */
export async function resolveQuotationPresentationSeasonId(db, quotation, requestId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  if (customerRequestScope(db)) {
    await validateScopedQuotation(db, quotation, requestId)
    return customerRequestScope(db).seasonId
  }
  const fromQuotation = String(quotation?.seasonId ?? quotation?.season_id ?? '').trim()
  if (fromQuotation) return fromQuotation

  const reqId = String(
    requestId ?? quotation?.customerRequestId ?? quotation?.customer_request_id ?? '',
  ).trim()
  if (!reqId) return null

  const row = await db
    .prepare('SELECT season_id FROM customer_requests WHERE id = ?')
    .bind(reqId)
    .first()
  const fromRequest = row ? String(row.season_id ?? '').trim() : ''
  return fromRequest || null
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown>} item
 * @param {Map<number, Record<string, unknown>> | null} requestItemsByLine
 * @param {{ allowPublicCatalogueFallback?: boolean }} [options]
 */
async function presentCustomerFacingQuotationItem(
  db,
  item,
  requestItemsByLine,
  seasonId,
  options = {},
) {
  const locationMode = Boolean(customerRequestScope(db))
  const qty = Number(item.quantity)
  if (!Number.isInteger(qty) || qty < 1 || (locationMode && !Number.isSafeInteger(item.quantity))) {
    return locationMode ? redactItemPricing(item) : item
  }

  const productId = item.productId ? String(item.productId) : null
  if (productId) {
    const lineNum = Number(item.lineNumber ?? item.line_number)
    const reqLine = Number.isInteger(lineNum) ? requestItemsByLine?.get(lineNum) : null
    const locked = reqLine?.unit_price_paise ?? item.unitRatePaise
    const nameForUnit =
      reqLine?.product_name != null && String(reqLine.product_name).trim()
        ? String(reqLine.product_name)
        : item.productName
    const resolved = await resolveCatalogueSellingUnitForProductLine(
      db,
      productId,
      nameForUnit,
      locked,
      seasonId,
    )
    if (!resolved.ok) {
      return locationMode ? redactItemPricing(item) : item
    }
    if (locationMode && !Number.isSafeInteger(qty * resolved.unitPaise)) return redactItemPricing(item)
    if (locationMode) return verifiedItemPricing(item, resolved.unitPaise, qty, resolved.productName)
    return {
      ...item,
      productName: resolved.productName,
      unitRatePaise: resolved.unitPaise,
      lineTotalPaise: lineTotalPaise(qty, resolved.unitPaise),
    }
  }

  const lineNum = Number(item.lineNumber ?? item.line_number)
  const reqLine = Number.isInteger(lineNum) ? requestItemsByLine?.get(lineNum) : null
  const packId = reqLine?.family_pack_id ? String(reqLine.family_pack_id) : null
  if (packId) {
    let packSeason = String(seasonId ?? '').trim()
    if (!packSeason && options.allowPublicCatalogueFallback !== false) {
      packSeason = (await getPublicCatalogueSeasonId(db)) ?? ''
    }
    if (!packSeason) {
      return locationMode ? redactItemPricing(item) : item
    }
    const pack = await db
      .prepare('SELECT selling_price_paise FROM family_packs WHERE id = ? AND season_id = ?')
      .bind(packId, packSeason)
      .first()
    const unit = Number(pack?.selling_price_paise)
    if (Number.isInteger(unit) && unit > 0 && (!locationMode || (positivePrice(pack?.selling_price_paise) && Number.isSafeInteger(qty * unit)))) {
      if (locationMode) return verifiedItemPricing(item, unit, qty)
      return {
        ...item,
        unitRatePaise: unit,
        lineTotalPaise: lineTotalPaise(qty, unit),
      }
    }
  }

  return locationMode ? redactItemPricing(item) : item
}

/**
 * Align quotation header, lines, and totals to catalogue selling (never X4, final, or bargain).
 * Preserves Quick Bill audit fields on the quotation object.
 * In location mode, unverifiable pricing is NULL with pricingUnavailable=true;
 * no historical subtotal/WhatsApp fallback is used. This view never persists.
 *
 * @param {D1Database} db
 * @param {Record<string, unknown>} quotation
 * @param {string | null | undefined} [requestId]
 */
export async function presentCustomerFacingQuotation(db, quotation, requestId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  if (!quotation || typeof quotation !== 'object') return quotation
  await validateScopedQuotation(db, quotation, requestId)

  const saved = await savedBillPricing(db, quotation)
  if (saved) {
    const parent = await db.prepare('SELECT source FROM customer_requests WHERE id = ?').bind(quotation.customerRequestId ?? requestId).first()
    return { ...saved, whatsAppMessage: buildQuotationWhatsAppMessage(saved, saved.items, { requestSource: parent?.source }) }
  }

  const reqId =
    requestId ?? quotation.customerRequestId ?? quotation.customer_request_id ?? null
  const passedSeason = customerRequestScope(db)?.seasonId ?? String(seasonId ?? '').trim()
  const quotationSeason = String(quotation.seasonId ?? quotation.season_id ?? '').trim()
  const effectiveSeason = passedSeason || quotationSeason || ''
  const knownQuotationSeason = Boolean(passedSeason || quotationSeason)

  const requestItemsByLine = await loadRequestItemsByLine(db, reqId, effectiveSeason)

  const itemOptions = { allowPublicCatalogueFallback: !knownQuotationSeason }
  const items = await Promise.all(
    (quotation.items ?? []).map((item) =>
      presentCustomerFacingQuotationItem(
        db,
        item,
        requestItemsByLine,
        effectiveSeason,
        itemOptions,
      ),
    ),
  )

  if (customerRequestScope(db)) {
    // An unavailable line invalidates the aggregate; a partial sum or historical
    // audit fallback could disclose internal pricing or imply a payable amount.
    const unavailable = !items.length || items.some(line => line.pricingUnavailable)
    const adjustment = quotation.adjustmentPaise ?? quotation.adjustment_paise ?? 0
    const sum = unavailable ? null : items.reduce((total, line) => total + line.lineTotalPaise, 0)
    const total = sum == null ? null : sum + adjustment
    const invalid = unavailable || !Number.isSafeInteger(adjustment) || !Number.isSafeInteger(sum) || !Number.isSafeInteger(total) || total < 0
    const presented = { ...quotation, items, subtotalPaise: invalid ? null : sum, totalPaise: invalid ? null : total,
      ...(invalid ? { pricingUnavailable: true } : {}) }
    if (!invalid) delete presented.pricingUnavailable
    for (const [key, value] of [['subtotal_paise', presented.subtotalPaise], ['total_paise', presented.totalPaise]]) {
      if (Object.hasOwn(presented, key)) presented[key] = value
    }
    // Persisted WhatsApp text can contain an old total. Rebuild only the response;
    // explicit WhatsApp endpoints also consume these same sanitized lines/totals.
    const parent = reqId ? await db.prepare('SELECT source FROM customer_requests WHERE id = ?').bind(reqId).first() : null
    presented.whatsAppMessage = buildQuotationWhatsAppMessage(presented, items, { requestSource: parent?.source })
    if (Object.hasOwn(presented, 'wa_message_text')) presented.wa_message_text = presented.whatsAppMessage
    return presented
  }

  const subtotalPaise = sumPaise(items.map((line) => Number(line.lineTotalPaise ?? 0)))
  const adjustment = Number(quotation.adjustmentPaise ?? 0)
  const totalPaise =
    subtotalPaise + (Number.isInteger(adjustment) && adjustment !== 0 ? adjustment : 0)

  return {
    ...quotation,
    subtotalPaise,
    totalPaise,
    items,
  }
}

/** @param {unknown} value @returns {number | null} */
function nullablePaise(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * Customer WhatsApp totals — catalogue selling only.
 *
 * @param {D1Database} db
 * @param {Record<string, unknown>} quotation
 * @param {unknown} _requestSource
 * @param {string | null | undefined} requestId
 * @returns {Promise<number | null>} NULL means current selling pricing is unavailable.
 */
export async function computeCustomerFacingQuotationTotalPaise(db, quotation, _requestSource, requestId, operatingSeasonId, context) {
  db = customerRequestDb(db, operatingSeasonId, context)
  await validateScopedQuotation(db, quotation, requestId)
  if (customerRequestScope(db)) {
    const presented = await presentCustomerFacingQuotation(db, quotation, requestId, customerRequestScope(db).seasonId)
    return presented.totalPaise
  }
  const sellingSubtotal = nullablePaise(quotation.sellingSubtotalPaise ?? quotation.selling_subtotal_paise)
  if (sellingSubtotal != null) {
    const adjustment = Number(quotation.adjustmentPaise ?? quotation.adjustment_paise ?? 0)
    return sellingSubtotal + (Number.isInteger(adjustment) ? adjustment : 0)
  }

  const seasonId = await resolveQuotationPresentationSeasonId(db, quotation, requestId)
  const presented = await presentCustomerFacingQuotation(db, quotation, requestId, seasonId)
  return Number(presented.totalPaise ?? 0)
}
