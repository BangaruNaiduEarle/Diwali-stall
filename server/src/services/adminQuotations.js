import { customerRequestDb, customerRequestScope, validateTransactionCatalogueReferences } from '../lib/adminCustomerRequestScope.js'
import { quotationReplacementGuard, transactionChanged } from '../lib/adminTransactionIntegrity.js'
import { validateCustomerRequestStatusTransition } from '../lib/adminCustomerRequestValidation.js'
import {
  presentCustomerFacingQuotation,
  resolveCatalogueSellingUnitForProductLine,
  stripLooseProductNameSuffix,
  withLooseProductNameSuffix,
} from '../lib/customerFacingQuotationTotal.js'
import { buildOrderConfirmationWhatsAppMessage } from '../lib/orderConfirmationWhatsApp.js'
import { buildQuotationWhatsAppMessage } from '../lib/quotationWhatsApp.js'
import { mapAdminCustomerRequestDetail } from './adminCustomerRequests.js'
import { lineTotalPaise, sumPaise } from './money.js'

export const GET_REQUEST_FOR_QUOTE_SQL = `
  SELECT id, status, source, customer_name, customer_phone, customer_area, pickup_preference, customer_note
  FROM customer_requests
  WHERE id = ?
`.trim()

export const GET_REQUEST_ITEMS_FOR_QUOTE_SQL = `
  SELECT line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise
  FROM customer_request_items
  WHERE request_id = ?
  ORDER BY line_number ASC
`.trim()

export const GET_REQUEST_ITEMS_FOR_QUOTE_WITH_SEASON_SQL = `
  SELECT i.line_number, i.product_id, i.family_pack_id, i.product_name, i.quantity, i.unit_price_paise
  FROM customer_request_items i
  INNER JOIN customer_requests r ON r.id = i.request_id
  WHERE i.request_id = ? AND r.season_id = ?
  ORDER BY i.line_number ASC
`.trim()

const INSERT_QUOTATION_SQL = `
  INSERT INTO quotations (
    id, customer_request_id, status, customer_name, customer_phone, customer_note,
    subtotal_paise, adjustment_paise, total_paise, wa_message_text, created_by_email,
    pricing_mode, selling_subtotal_paise, final_subtotal_paise, bargain_floor_paise,
    accepted_amount_paise, updated_at
  ) VALUES (?, ?, 'draft', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`.trim()

export const INSERT_QUOTATION_WITH_SEASON_SQL = `
  INSERT INTO quotations (
    id, customer_request_id, status, customer_name, customer_phone, customer_note,
    subtotal_paise, adjustment_paise, total_paise, wa_message_text, created_by_email,
    pricing_mode, selling_subtotal_paise, final_subtotal_paise, bargain_floor_paise,
    accepted_amount_paise, season_id, updated_at
  ) VALUES (?, ?, 'draft', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`.trim()

/** @param {unknown} seasonId */
function trimSeasonId(seasonId) {
  return String(seasonId ?? '').trim()
}

/** @param {unknown} seasonId */
function requireQuotationSeasonId(seasonId) {
  const season = trimSeasonId(seasonId)
  if (!season) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Active business season is required for quotation writes.',
    }
  }
  return { ok: true, season }
}

/** @typedef {'selling' | 'bargain'} QuickBillPricingMode */

/** Quotation columns for Quick Bill audit (migration 0015). */
export const QUOTATION_QUICK_BILL_AUDIT_SELECT_SQL = `
  pricing_mode, selling_subtotal_paise, final_subtotal_paise, bargain_floor_paise, accepted_amount_paise
`.trim()

/**
 * @param {Record<string, unknown>} row
 */
export function mapQuotationQuickBillAuditFromRow(row) {
  const pricingModeRaw = row.pricing_mode
  const pricingMode =
    pricingModeRaw === 'selling' || pricingModeRaw === 'bargain'
      ? /** @type {QuickBillPricingMode} */ (pricingModeRaw)
      : null
  return {
    pricingMode,
    sellingSubtotalPaise: nullablePaiseColumn(row.selling_subtotal_paise),
    finalSubtotalPaise: nullablePaiseColumn(row.final_subtotal_paise),
    bargainFloorPaise: nullablePaiseColumn(row.bargain_floor_paise),
    acceptedAmountPaise: nullablePaiseColumn(row.accepted_amount_paise),
  }
}

/** @param {unknown} value @returns {number | null} */
function nullablePaiseColumn(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * Optional Quick Bill audit persisted on insert (Phase 2+ will populate).
 * @param {{ quickBillAudit?: {
 *   pricingMode?: QuickBillPricingMode | null,
 *   sellingSubtotalPaise?: number | null,
 *   finalSubtotalPaise?: number | null,
 *   bargainFloorPaise?: number | null,
 *   acceptedAmountPaise?: number | null,
 * } | null }} opts
 */
export function resolveQuotationQuickBillAuditInsert(opts = {}) {
  const audit = opts.quickBillAudit
  if (!audit) {
    return {
      pricing_mode: null,
      selling_subtotal_paise: null,
      final_subtotal_paise: null,
      bargain_floor_paise: null,
      accepted_amount_paise: null,
    }
  }
  const pricingMode =
    audit.pricingMode === 'bargain' ? 'bargain' : audit.pricingMode === 'selling' ? 'selling' : null
  return {
    pricing_mode: pricingMode,
    selling_subtotal_paise: nullablePaiseColumn(audit.sellingSubtotalPaise),
    final_subtotal_paise: nullablePaiseColumn(audit.finalSubtotalPaise),
    bargain_floor_paise: nullablePaiseColumn(audit.bargainFloorPaise),
    accepted_amount_paise: nullablePaiseColumn(audit.acceptedAmountPaise),
  }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {string} [seasonId]
 */
export async function getActiveQuotationForRequest(db, requestId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  const season = trimSeasonId(seasonId)
  const row = season
    ? await db
        .prepare(
          `SELECT id, customer_request_id, status, customer_name, customer_phone, customer_note,
                  currency, subtotal_paise, adjustment_paise, total_paise, wa_message_text,
                  created_by_email, created_at, updated_at,
                  ${QUOTATION_QUICK_BILL_AUDIT_SELECT_SQL}
           FROM quotations
           WHERE customer_request_id = ? AND status != 'void' AND season_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .bind(requestId, season)
        .first()
    : await db
        .prepare(
          `SELECT id, customer_request_id, status, customer_name, customer_phone, customer_note,
                  currency, subtotal_paise, adjustment_paise, total_paise, wa_message_text,
                  created_by_email, created_at, updated_at,
                  ${QUOTATION_QUICK_BILL_AUDIT_SELECT_SQL}
           FROM quotations
           WHERE customer_request_id = ? AND status != 'void'
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .bind(requestId)
        .first()
  if (!row) return null
  const items = await db
    .prepare(
      `SELECT line_number, product_id, product_name, quantity, unit_rate_paise, line_total_paise
       FROM quotation_items WHERE quotation_id = ? ORDER BY line_number ASC`,
    )
    .bind(row.id)
    .all()
  return mapQuotationDetail(row, items.results ?? [])
}

/** @param {Record<string, unknown>} row @param {Record<string, unknown>[]} items */
export function mapQuotationDetail(row, items) {
  return {
    requestRevision: row.request_revision ?? null,
    id: row.id,
    customerRequestId: row.customer_request_id,
    status: row.status,
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    customerNote: row.customer_note ?? null,
    currency: row.currency,
    subtotalPaise: row.subtotal_paise,
    adjustmentPaise: row.adjustment_paise,
    totalPaise: row.total_paise,
    whatsAppMessage: row.wa_message_text ?? null,
    createdByEmail: row.created_by_email ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...mapQuotationQuickBillAuditFromRow(row),
    items: items.map(mapQuotationItemRow),
  }
}

/** @param {Record<string, unknown>} row */
function mapQuotationItemRow(row) {
  return {
    requestLineId: row.request_line_id ?? null,
    unitType: row.unit_type ?? null,
    packSnapshot: row.pack_snapshot ? JSON.parse(row.pack_snapshot) : null,
    productDetails: row.product_details_json ? JSON.parse(row.product_details_json) : null,
    lineNumber: row.line_number,
    productId: row.product_id ?? null,
    productName: row.product_name,
    quantity: row.quantity,
    unitRatePaise: row.unit_rate_paise,
    lineTotalPaise: row.line_total_paise,
  }
}

/**
 * Quotation line builder — catalogue selling_price_paise only (no private_rates / X4).
 * @param {D1Database} db
 * @param {{ line_number: number, product_id: string, product_name: string, quantity: number }[]} requestItems
 * @param {string} [seasonId]
 */
export async function buildQuoteLinesForRequestItems(db, requestItems, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  const season = trimSeasonId(seasonId)
  await validateTransactionCatalogueReferences(db, requestItems)
  /** @type {string[]} */
  const missingSellingPriceProductIds = []
  /** @type {{ line_number: number, product_id: string, product_name: string, quantity: number, unit_rate_paise: number, line_total_paise: number }[]} */
  const quoteLines = []

  for (const line of requestItems) {
    const familyPackId = String(line.family_pack_id ?? '').trim()
    const productId = String(line.product_id ?? '').trim()
    const qty = Number(line.quantity)

    if (familyPackId) {
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return {
          ok: false,
          status: 400,
          code: 'validation_error',
          fields: { [`items[${line.line_number}]`]: 'Invalid quantity on request line.' },
        }
      }
      let unitPaise = Number(line.unit_price_paise)
      if (!Number.isInteger(unitPaise) || unitPaise <= 0) {
        if (!season) {
          return {
            ok: false,
            status: 400,
            code: 'validation_error',
            fields: { [`items[${line.line_number}]`]: 'Family pack is not available.' },
          }
        }
        const pack = await db
          .prepare(
            'SELECT id, name, active, selling_price_paise FROM family_packs WHERE id = ? AND season_id = ?',
          )
          .bind(familyPackId, season)
          .first()
        if (!pack || Number(pack.active) !== 1) {
          return {
            ok: false,
            status: 400,
            code: 'validation_error',
            fields: { [`items[${line.line_number}]`]: 'Family pack is not available.' },
          }
        }
        unitPaise = Number(pack.selling_price_paise)
      }
      if (!Number.isInteger(unitPaise) || unitPaise <= 0) {
        return {
          ok: false,
          status: 400,
          code: 'validation_error',
          fields: { [`items[${line.line_number}]`]: 'Family pack price is missing.' },
        }
      }
      const lineTotal = lineTotalPaise(qty, unitPaise)
      quoteLines.push({
        line_number: Number(line.line_number),
        product_id: null,
        product_name: String(line.product_name ?? 'Family pack'),
        quantity: qty,
        unit_rate_paise: unitPaise,
        line_total_paise: lineTotal,
      })
      continue
    }

    if (!productId) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        fields: { [`items[${line.line_number}]`]: 'Missing product or family pack on request line.' },
      }
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        fields: { [`items[${line.line_number}]`]: 'Invalid quantity on request line.' },
      }
    }

    const product = season
      ? await db
          .prepare(
            'SELECT id, name, active, selling_price_paise FROM products WHERE id = ? AND season_id = ?',
          )
          .bind(productId, season)
          .first()
      : await db
          .prepare('SELECT id, name, active, selling_price_paise FROM products WHERE id = ?')
          .bind(productId)
          .first()
    if (!product || !product.active) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        fields: { [`items[${line.line_number}]`]: `Product ${productId} is not available.` },
      }
    }

    const resolved = await resolveCatalogueSellingUnitForProductLine(
      db,
      productId,
      line.product_name ?? product.name,
      line.unit_price_paise,
      season,
    )
    if (!resolved.ok) {
      missingSellingPriceProductIds.push(productId)
      continue
    }

    const lineTotal = lineTotalPaise(qty, resolved.unitPaise)
    quoteLines.push({
      line_number: Number(line.line_number),
      product_id: productId,
      product_name: resolved.loose
        ? withLooseProductNameSuffix(line.product_name ?? product.name)
        : stripLooseProductNameSuffix(line.product_name ?? product.name),
      quantity: qty,
      unit_rate_paise: resolved.unitPaise,
      line_total_paise: lineTotal,
    })
  }

  if (missingSellingPriceProductIds.length) {
    return {
      ok: false,
      status: 400,
      code: 'missing_selling_price',
      message: 'Catalogue selling price missing for one or more products.',
      missingProductIds: [...new Set(missingSellingPriceProductIds)],
    }
  }

  const subtotalPaise = sumPaise(quoteLines.map((l) => l.line_total_paise))
  return { ok: true, quoteLines, subtotalPaise, totalPaise: subtotalPaise }
}

/** @param {{ line_number: number, product_id: string, product_name: string, quantity: number, unit_rate_paise: number, line_total_paise: number }} line */
export function mapBuiltQuoteLineToApi(line) {
  return {
    lineNumber: line.line_number,
    productId: line.product_id,
    productName: line.product_name,
    quantity: line.quantity,
    unitRatePaise: line.unit_rate_paise,
    lineTotalPaise: line.line_total_paise,
  }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {{ regenerate?: boolean, createdByEmail?: string, quickBillAudit?: {
 *   pricingMode?: QuickBillPricingMode | null,
 *   sellingSubtotalPaise?: number | null,
 *   finalSubtotalPaise?: number | null,
 *   bargainFloorPaise?: number | null,
 *   acceptedAmountPaise?: number | null,
 * } | null, seasonId?: string }} opts
 */
export async function createOrGetQuotationForRequest(db, requestId, opts = {}) {
  db = customerRequestDb(db, opts.seasonId, opts.context, true)
  const seasonGate = requireQuotationSeasonId(opts.seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  const request = await db
    .prepare(`${customerRequestScope(db) ? GET_REQUEST_FOR_QUOTE_SQL.replace('SELECT id, status,', 'SELECT id, finalization_status, status,') : GET_REQUEST_FOR_QUOTE_SQL} AND season_id = ?`)
    .bind(requestId, season)
    .first()
  if (!request) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  const existing = await getActiveQuotationForRequest(db, requestId, season)
  if (existing && !opts.regenerate) {
    return { ok: true, quotation: existing, created: false }
  }

  if (customerRequestScope(db) && (['closed', 'void'].includes(request.status) || request.finalization_status === 'finalized')) return transactionChanged()

  const itemsResult = await db
    .prepare(GET_REQUEST_ITEMS_FOR_QUOTE_WITH_SEASON_SQL)
    .bind(requestId, season)
    .all()
  const requestItems = itemsResult.results ?? []
  if (requestItems.length === 0) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Request has no items.', fields: { items: 'No line items.' } }
  }

  const built = await buildQuoteLinesForRequestItems(db, requestItems, season)
  if (!built.ok) {
    return built
  }
  const { quoteLines, subtotalPaise: subtotal, totalPaise: total } = built

  const quotationId = crypto.randomUUID()
  const voidQuotationId = existing && opts.regenerate ? existing.id : null
  const quickBillAuditInsert = resolveQuotationQuickBillAuditInsert(opts)

  const quoteItemsForWa = quoteLines.map((l) => ({
    lineNumber: l.line_number,
    productId: l.product_id,
    productName: l.product_name,
    quantity: l.quantity,
    unitRatePaise: l.unit_rate_paise,
    lineTotalPaise: l.line_total_paise,
  }))
  const waMessage = buildQuotationWhatsAppMessage(
    {
      id: quotationId,
      customerName: request.customer_name,
      customerPhone: request.customer_phone,
      pickupPreference: request.pickup_preference,
      totalPaise: total,
    },
    quoteItemsForWa,
    { requestSource: request.source },
  )

  /** @type {import('@cloudflare/workers-types').D1PreparedStatement[]} */
  const statements = []
  if (customerRequestScope(db)) statements.push(quotationReplacementGuard(db, request, existing, season))

  if (voidQuotationId) {
    statements.push(
      db
        .prepare(
          `UPDATE quotations SET status = 'void', updated_at = datetime('now')
           WHERE id = ? AND status != 'void' AND season_id = ?`,
        )
        .bind(voidQuotationId, season),
    )
  }

  statements.push(
    db
      .prepare(INSERT_QUOTATION_WITH_SEASON_SQL)
      .bind(
        quotationId,
        requestId,
        request.customer_name ?? null,
        request.customer_phone ?? null,
        request.customer_note ?? null,
        subtotal,
        total,
        waMessage,
        opts.createdByEmail ?? null,
        quickBillAuditInsert.pricing_mode,
        quickBillAuditInsert.selling_subtotal_paise,
        quickBillAuditInsert.final_subtotal_paise,
        quickBillAuditInsert.bargain_floor_paise,
        quickBillAuditInsert.accepted_amount_paise,
        season,
      ),
  )

  for (const line of quoteLines) {
    statements.push(
      db
        .prepare(
          `INSERT INTO quotation_items (
            quotation_id, line_number, product_id, product_name, quantity, unit_rate_paise, line_total_paise
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          quotationId,
          line.line_number,
          line.product_id,
          line.product_name,
          line.quantity,
          line.unit_rate_paise,
          line.line_total_paise,
        ),
    )
  }

  const nextStatus = 'quoted'
  const transition = validateCustomerRequestStatusTransition(String(request.status), nextStatus)
  if (transition.ok && String(request.status) !== nextStatus) {
    statements.push(
      db
        .prepare(
          `UPDATE customer_requests SET status = ?, updated_at = datetime('now') WHERE id = ? AND season_id = ?`,
        )
        .bind(nextStatus, requestId, season),
    )
  }

  try {
    await db.batch(statements)
  } catch (err) {
    const message = String(err?.message ?? err)
    if (customerRequestScope(db) && /NOT NULL constraint failed: customer_requests.status/.test(message)) return transactionChanged()
    if (message.includes('UNIQUE constraint failed') && message.includes('quotations')) {
      const raced = await getActiveQuotationForRequest(db, requestId, season)
      if (raced) {
        return { ok: true, quotation: raced, created: false, concurrentReplay: true }
      }
    }
    throw err
  }

  const quotation = await getQuotationById(db, quotationId)
  return { ok: true, quotation, created: true, regenerated: Boolean(opts.regenerate) }
}

/**
 * @param {D1Database} db
 * @param {string} quotationId
 */
export async function getQuotationById(db, quotationId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  const row = await db
    .prepare(
      `SELECT id, customer_request_id, status, customer_name, customer_phone, customer_note,
              currency, subtotal_paise, adjustment_paise, total_paise, wa_message_text,
              created_by_email, created_at, updated_at,
              ${QUOTATION_QUICK_BILL_AUDIT_SELECT_SQL}
       FROM quotations WHERE id = ?`,
    )
    .bind(quotationId)
    .first()
  if (!row) return null
  const items = await db
    .prepare(
      `SELECT line_number, product_id, product_name, quantity, unit_rate_paise, line_total_paise
       FROM quotation_items WHERE quotation_id = ? ORDER BY line_number ASC`,
    )
    .bind(quotationId)
    .all()
  return mapQuotationDetail(row, items.results ?? [])
}

/**
 * @param {D1Database} db
 * @param {string} quotationId
 */
/**
 * @param {D1Database} db
 * @param {string} quotationId
 * @param {string} seasonId
 */
export async function getQuotationWhatsAppPayload(db, quotationId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  const seasonGate = requireQuotationSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  const seasonRow = await db
    .prepare('SELECT season_id FROM quotations WHERE id = ?')
    .bind(quotationId)
    .first()
  if (!seasonRow || String(seasonRow.season_id ?? '') !== season) {
    return { ok: false, status: 404, code: 'not_found', message: 'Quotation not found.' }
  }

  const quotation = await getQuotationById(db, quotationId)
  if (!quotation) {
    return { ok: false, status: 404, code: 'not_found', message: 'Quotation not found.' }
  }
  const request = quotation.customerRequestId
    ? await db
        .prepare(
          'SELECT customer_phone, pickup_preference, source FROM customer_requests WHERE id = ? AND season_id = ?',
        )
        .bind(quotation.customerRequestId, season)
        .first()
    : null
  const requestSource = request?.source ?? null
  const presented = await presentCustomerFacingQuotation(
    db,
    quotation,
    quotation.customerRequestId,
    season,
  )
  const message = buildQuotationWhatsAppMessage(presented, presented.items, { requestSource })
  return {
    ok: true,
    message,
    customerPhone: request?.customer_phone ?? quotation.customerPhone,
    quotationId: quotation.id,
  }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 */
/**
 * Owner/Super Admin — persist customer-agreed amount on the active quotation (internal audit only).
 *
 * @param {D1Database} db
 * @param {string} requestId
 * @param {number} acceptedAmountPaise
 * @param {string} [seasonId]
 */
export async function patchActiveQuotationCustomerAgreedAmount(
  db,
  requestId,
  acceptedAmountPaise,
  seasonId,
  context,
) {
  db = customerRequestDb(db, seasonId, context, true)
  const seasonGate = requireQuotationSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  const quotation = await getActiveQuotationForRequest(db, requestId, season)
  if (!quotation) {
    return { ok: false, status: 404, code: 'not_found', message: 'No quotation for this request.' }
  }

  const run = await db
    .prepare(
      `UPDATE quotations
       SET accepted_amount_paise = ?, updated_at = datetime('now')
       WHERE id = ? AND status != 'void' AND season_id = ?${customerRequestScope(db) ? ' AND accepted_amount_paise IS ?' : ''}`,
    )
    .bind(acceptedAmountPaise, quotation.id, season, ...(customerRequestScope(db) ? [quotation.acceptedAmountPaise ?? null] : []))
    .run()

  if (!run.meta?.changes) {
    return {
      ok: false,
      status: 409,
      code: 'update_failed',
      message: 'Could not save customer-agreed amount.',
    }
  }

  const updated = await getQuotationById(db, quotation.id)
  return { ok: true, quotation: updated }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {string} seasonId
 */
export async function getOrderConfirmationWhatsAppPayload(db, requestId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  const seasonGate = requireQuotationSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  const row = await db
    .prepare(
      `SELECT id, public_reference, status, source, customer_name, customer_phone, customer_area,
              pickup_preference, customer_note, delivery_address, delivery_landmark, delivery_maps_url,
              created_at, updated_at
       FROM customer_requests WHERE id = ? AND season_id = ?`,
    )
    .bind(requestId, season)
    .first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }
  const quotation = await getActiveQuotationForRequest(db, requestId, season)
  if (!quotation) {
    return { ok: false, status: 404, code: 'not_found', message: 'No quotation for this request.' }
  }
  const request = mapAdminCustomerRequestDetail(row, [])
  const presented = await presentCustomerFacingQuotation(db, quotation, requestId, season)
  const built = buildOrderConfirmationWhatsAppMessage(request, presented)
  if (!built.ok) {
    return {
      ok: false,
      status: 400,
      code: built.code ?? 'validation_error',
      message: built.message ?? 'Cannot build order confirmation.',
    }
  }
  return {
    ok: true,
    message: built.message,
    customerPhone: request.customerPhone,
    quotationId: quotation.id,
    requestId,
  }
}
