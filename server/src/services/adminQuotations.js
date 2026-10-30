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
 */
export async function getActiveQuotationForRequest(db, requestId) {
  const row = await db
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
 */
export async function buildQuoteLinesForRequestItems(db, requestItems) {
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
        const pack = await db
          .prepare('SELECT id, name, active, selling_price_paise FROM family_packs WHERE id = ?')
          .bind(familyPackId)
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

    const product = await db
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
 * } | null }} opts
 */
export async function createOrGetQuotationForRequest(db, requestId, opts = {}) {
  const request = await db.prepare(GET_REQUEST_FOR_QUOTE_SQL).bind(requestId).first()
  if (!request) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  const existing = await getActiveQuotationForRequest(db, requestId)
  if (existing && !opts.regenerate) {
    return { ok: true, quotation: existing, created: false }
  }

  const itemsResult = await db.prepare(GET_REQUEST_ITEMS_FOR_QUOTE_SQL).bind(requestId).all()
  const requestItems = itemsResult.results ?? []
  if (requestItems.length === 0) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Request has no items.', fields: { items: 'No line items.' } }
  }

  const built = await buildQuoteLinesForRequestItems(db, requestItems)
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

  if (voidQuotationId) {
    statements.push(
      db
        .prepare(
          `UPDATE quotations SET status = 'void', updated_at = datetime('now') WHERE id = ? AND status != 'void'`,
        )
        .bind(voidQuotationId),
    )
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO quotations (
          id, customer_request_id, status, customer_name, customer_phone, customer_note,
          subtotal_paise, adjustment_paise, total_paise, wa_message_text, created_by_email,
          pricing_mode, selling_subtotal_paise, final_subtotal_paise, bargain_floor_paise,
          accepted_amount_paise, updated_at
        ) VALUES (?, ?, 'draft', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
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
          `UPDATE customer_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .bind(nextStatus, requestId),
    )
  }

  try {
    await db.batch(statements)
  } catch (err) {
    const message = String(err?.message ?? err)
    if (message.includes('UNIQUE constraint failed') && message.includes('quotations')) {
      const raced = await getActiveQuotationForRequest(db, requestId)
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
export async function getQuotationById(db, quotationId) {
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
export async function getQuotationWhatsAppPayload(db, quotationId) {
  const quotation = await getQuotationById(db, quotationId)
  if (!quotation) {
    return { ok: false, status: 404, code: 'not_found', message: 'Quotation not found.' }
  }
  const request = quotation.customerRequestId
    ? await db
        .prepare('SELECT customer_phone, pickup_preference, source FROM customer_requests WHERE id = ?')
        .bind(quotation.customerRequestId)
        .first()
    : null
  const requestSource = request?.source ?? null
  const presented = await presentCustomerFacingQuotation(db, quotation, quotation.customerRequestId)
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
 */
export async function patchActiveQuotationCustomerAgreedAmount(db, requestId, acceptedAmountPaise) {
  const quotation = await getActiveQuotationForRequest(db, requestId)
  if (!quotation) {
    return { ok: false, status: 404, code: 'not_found', message: 'No quotation for this request.' }
  }

  const run = await db
    .prepare(
      `UPDATE quotations
       SET accepted_amount_paise = ?, updated_at = datetime('now')
       WHERE id = ? AND status != 'void'`,
    )
    .bind(acceptedAmountPaise, quotation.id)
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

export async function getOrderConfirmationWhatsAppPayload(db, requestId) {
  const row = await db
    .prepare(
      `SELECT id, public_reference, status, source, customer_name, customer_phone, customer_area,
              pickup_preference, customer_note, delivery_address, delivery_landmark, delivery_maps_url,
              created_at, updated_at
       FROM customer_requests WHERE id = ?`,
    )
    .bind(requestId)
    .first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }
  const quotation = await getActiveQuotationForRequest(db, requestId)
  if (!quotation) {
    return { ok: false, status: 404, code: 'not_found', message: 'No quotation for this request.' }
  }
  const request = mapAdminCustomerRequestDetail(row, [])
  const presented = await presentCustomerFacingQuotation(db, quotation, requestId)
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
