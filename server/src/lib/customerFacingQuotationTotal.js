import { lineTotalPaise, sumPaise } from '../services/money.js'

/**
 * @param {D1Database} db
 * @param {string} productId
 * @returns {Promise<{ boxPaise: number, loosePaise: number | null } | null>}
 */
export async function catalogueSellingUnitRates(db, productId) {
  const row = await db
    .prepare(
      `SELECT selling_price_paise, pieces_per_pack, allow_loose_sale
       FROM products WHERE id = ?`,
    )
    .bind(productId)
    .first()
  if (!row) return null
  const boxPaise = Number(row.selling_price_paise)
  if (!Number.isInteger(boxPaise) || boxPaise <= 0) return null
  let loosePaise = null
  if (Number(row.allow_loose_sale) === 1) {
    const pieces = Number(row.pieces_per_pack)
    if (Number.isInteger(pieces) && pieces >= 1) {
      loosePaise = Math.floor(boxPaise / pieces)
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
) {
  const rates = await catalogueSellingUnitRates(db, productId)
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
async function loadRequestItemsByLine(db, requestId) {
  if (!requestId) return null
  const rows = await db
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
 * @param {Record<string, unknown>} item
 * @param {Map<number, Record<string, unknown>> | null} requestItemsByLine
 */
async function presentCustomerFacingQuotationItem(db, item, requestItemsByLine) {
  const qty = Number(item.quantity)
  if (!Number.isInteger(qty) || qty < 1) {
    return item
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
    )
    if (!resolved.ok) {
      return item
    }
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
    const pack = await db
      .prepare('SELECT selling_price_paise FROM family_packs WHERE id = ?')
      .bind(packId)
      .first()
    const unit = Number(pack?.selling_price_paise)
    if (Number.isInteger(unit) && unit > 0) {
      return {
        ...item,
        unitRatePaise: unit,
        lineTotalPaise: lineTotalPaise(qty, unit),
      }
    }
  }

  return item
}

/**
 * Align quotation header, lines, and totals to catalogue selling (never X4, final, or bargain).
 * Preserves Quick Bill audit fields on the quotation object.
 *
 * @param {D1Database} db
 * @param {Record<string, unknown>} quotation
 * @param {string | null | undefined} [requestId]
 */
export async function presentCustomerFacingQuotation(db, quotation, requestId) {
  if (!quotation || typeof quotation !== 'object') return quotation

  const reqId = requestId ?? quotation.customerRequestId ?? null
  const requestItemsByLine = await loadRequestItemsByLine(db, reqId)

  const items = await Promise.all(
    (quotation.items ?? []).map((item) =>
      presentCustomerFacingQuotationItem(db, item, requestItemsByLine),
    ),
  )

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
 */
export async function computeCustomerFacingQuotationTotalPaise(db, quotation, _requestSource, requestId) {
  const sellingSubtotal = nullablePaise(quotation.sellingSubtotalPaise ?? quotation.selling_subtotal_paise)
  if (sellingSubtotal != null) {
    const adjustment = Number(quotation.adjustmentPaise ?? quotation.adjustment_paise ?? 0)
    return sellingSubtotal + (Number.isInteger(adjustment) ? adjustment : 0)
  }

  const presented = await presentCustomerFacingQuotation(db, quotation, requestId)
  return Number(presented.totalPaise ?? 0)
}
