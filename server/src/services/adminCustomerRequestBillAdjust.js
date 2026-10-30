import { validateCustomerRequestBody } from '../lib/customerRequestValidation.js'
import { buildRequestInternalPricingView } from '../lib/adminInternalPricingPreview.js'
import { parseOptionalCustomerAgreedAmountInrPaise } from '../lib/quickBillBargain.js'
import { INSERT_CUSTOMER_REQUEST_ITEM_SQL } from './publicCustomerRequests.js'
import { ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL } from './adminCustomerRequests.js'
import {
  buildQuoteLinesForRequestItems,
  getActiveQuotationForRequest,
  resolveQuotationQuickBillAuditInsert,
} from './adminQuotations.js'
import {
  buildQuickBillQuotationAudit,
  mapQuickBillLinesForRequestInsert,
  resolveQuickBillProductPricing,
} from './adminQuickBill.js'
import { getAdminCustomerRequestById } from './adminCustomerRequests.js'
import { quotationIsBargainMode } from '../../../src/lib/quotationBargainMode.js'

/** @param {{ pricingMode?: string | null, bargainFloorPaise?: number | null } | null | undefined} quotation */
function resolveAdjustBillPricingMode(quotation) {
  return quotationIsBargainMode(quotation) ? 'bargain' : 'selling'
}

/** @param {Record<string, unknown>} row */
export function isCustomerRequestEligibleForBillAdjust(row) {
  if (!row || typeof row !== 'object') return false
  if (String(row.source ?? '') !== 'manual') return false
  const finalizationStatus = String(row.finalization_status ?? row.finalizationStatus ?? '').trim()
  if (finalizationStatus !== 'pending') return false
  const status = String(row.status ?? '').trim()
  if (status === 'closed' || status === 'void') return false
  return true
}

/** @param {unknown} body */
export function validateAdjustBillBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }
  const record = /** @type {Record<string, unknown>} */ (body)
  const itemsResult = validateCustomerRequestBody(
    {
      customer: { name: 'Adjust Bill', mobile: '9876543210' },
      items: record.items,
    },
    { quickBillItems: true },
  )
  if (!itemsResult.ok) {
    return { ok: false, errors: itemsResult.errors }
  }

  const accepted = parseOptionalCustomerAgreedAmountInrPaise(record)
  if (!accepted.ok) {
    return { ok: false, errors: accepted.errors }
  }

  return {
    ok: true,
    data: {
      items: itemsResult.data.items,
      acceptedAmountProvided: accepted.provided,
      acceptedAmountPaise: accepted.acceptedAmountPaise,
    },
  }
}

/**
 * @param {Record<string, unknown>[]} existingRows
 */
function preservedFamilyPackLines(existingRows) {
  /** @type {{ productId: string | null, familyPackId: string, productName: string, quantity: number, unitPricePaise: number | null }[]} */
  const packs = []
  for (const raw of existingRows) {
    if (!raw || typeof raw !== 'object') continue
    const row = /** @type {Record<string, unknown>} */ (raw)
    const familyPackId = row.family_pack_id != null ? String(row.family_pack_id).trim() : ''
    if (!familyPackId) continue
    const qty = Number(row.quantity)
    if (!Number.isInteger(qty) || qty < 1) continue
    packs.push({
      productId: null,
      familyPackId,
      productName: String(row.product_name ?? 'Family pack'),
      quantity: qty,
      unitPricePaise:
        row.unit_price_paise == null || row.unit_price_paise === ''
          ? null
          : Number(row.unit_price_paise),
    })
  }
  return packs
}

/**
 * @param {{
 *   productId: string | null,
 *   familyPackId: string | null,
 *   productName: string,
 *   quantity: number,
 *   unitPricePaise: number | null,
 * }[]} combined
 */
function combinedLinesToPricingRequestItems(combined) {
  return combined.map((line, index) => ({
    lineNumber: index + 1,
    productId: line.productId,
    familyPackId: line.familyPackId,
    productName: line.productName,
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
    lineType: line.familyPackId ? 'family_pack' : 'product',
  }))
}

/**
 * @param {D1Database} db
 * @param {{
 *   productId: string | null,
 *   familyPackId: string | null,
 *   productName: string,
 *   quantity: number,
 *   unitPricePaise: number | null,
 * }[]} combined
 * @param {Record<string, number>} productAudit
 * @param {'selling' | 'bargain'} pricingMode
 */
async function resolveAdjustBillAudit(db, combined, productAudit, pricingMode) {
  if (pricingMode !== 'bargain') {
    return productAudit
  }
  const internalView = await buildRequestInternalPricingView(db, combinedLinesToPricingRequestItems(combined))
  if (internalView?.finalSubtotalPaise == null) {
    return productAudit
  }
  return {
    sellingSubtotalPaise:
      internalView.sellingSubtotalPaise ?? productAudit.sellingSubtotalPaise,
    finalSubtotalPaise: internalView.finalSubtotalPaise,
    finalSubtotalStrictPaise: productAudit.finalSubtotalStrictPaise,
    bargainFloorPaise:
      internalView.bargainFloorPaise ?? productAudit.bargainFloorPaise,
  }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {{ productId: string, quantity: number, unitType?: 'box' | 'piece' }[]} items
 * @param {'selling' | 'bargain'} pricingMode
 */
async function buildAdjustBillDraft(db, requestId, items, pricingMode) {
  const resolved = await resolveQuickBillProductPricing(db, items)
  if (!resolved.ok) {
    return resolved
  }

  const productLines = mapQuickBillLinesForRequestInsert(resolved.lines)
  const existingItemsResult = await db
    .prepare(ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL)
    .bind(requestId)
    .all()
  const familyLines = preservedFamilyPackLines(existingItemsResult.results ?? [])

  /** @type {{ productId: string | null, familyPackId: string | null, productName: string, quantity: number, unitPricePaise: number | null }[]} */
  const combined = [
    ...productLines.map((line) => ({
      productId: line.productId,
      familyPackId: line.familyPackId,
      productName: line.productName,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
    })),
    ...familyLines.map((line) => ({
      productId: line.productId,
      familyPackId: line.familyPackId,
      productName: line.productName,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
    })),
  ]

  if (!combined.length) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      fields: { items: 'Bill must include at least one line.' },
    }
  }

  const rowsForQuote = combined.map((line, index) => ({
    line_number: index + 1,
    product_id: line.productId,
    family_pack_id: line.familyPackId,
    product_name: line.productName,
    quantity: line.quantity,
    unit_price_paise: line.unitPricePaise,
  }))

  const built = await buildQuoteLinesForRequestItems(db, rowsForQuote)
  if (!built.ok) {
    return built
  }

  const audit = await resolveAdjustBillAudit(db, combined, resolved.audit, pricingMode)
  const internalView = await buildRequestInternalPricingView(
    db,
    combinedLinesToPricingRequestItems(combined),
  )

  return {
    ok: true,
    resolved,
    combined,
    built,
    audit,
    preview: {
      customerSellingSubtotalPaise: built.subtotalPaise,
      sellingSubtotalPaise: internalView?.sellingSubtotalPaise ?? audit.sellingSubtotalPaise,
      finalSubtotalPaise: internalView?.finalSubtotalPaise ?? null,
      bargainFloorPaise:
        pricingMode === 'bargain' ? internalView?.bargainFloorPaise ?? audit.bargainFloorPaise ?? null : null,
      pricingMode,
    },
  }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {{ productId: string, quantity: number, unitType?: 'box' | 'piece' }[]} items
 */
export async function previewPendingCustomerRequestBillAdjust(db, requestId, items) {
  const row = await db
    .prepare(`SELECT id, status, source, finalization_status FROM customer_requests WHERE id = ?`)
    .bind(requestId)
    .first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }
  if (!isCustomerRequestEligibleForBillAdjust(row)) {
    return {
      ok: false,
      status: 400,
      code: 'not_adjustable',
      message: 'Only pending manual stall bills can be adjusted before finalize.',
    }
  }

  if (!items.length) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      fields: { items: 'Add at least one product line.' },
    }
  }

  const existingQuotation = await getActiveQuotationForRequest(db, requestId)
  if (!existingQuotation) {
    return {
      ok: false,
      status: 400,
      code: 'no_quotation',
      message: 'Create a quotation before adjusting the bill.',
    }
  }

  const pricingMode = resolveAdjustBillPricingMode(existingQuotation)
  const draft = await buildAdjustBillDraft(db, requestId, items, pricingMode)
  if (!draft.ok) {
    return draft
  }

  return { ok: true, preview: draft.preview }
}

/**
 * Owner/Super Admin — replace product lines, void prior quotation, regenerate with recalculated audit.
 *
 * @param {D1Database} db
 * @param {string} requestId
 * @param {{ productId: string, quantity: number, unitType?: 'box' | 'piece' }[]} items
 * @param {{ adjustedByEmail?: string | null, acceptedAmountProvided?: boolean, acceptedAmountPaise?: number | null }} [opts]
 */
export async function adjustPendingCustomerRequestBill(db, requestId, items, opts = {}) {
  const row = await db
    .prepare(`SELECT id, status, source, finalization_status FROM customer_requests WHERE id = ?`)
    .bind(requestId)
    .first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }
  if (!isCustomerRequestEligibleForBillAdjust(row)) {
    return {
      ok: false,
      status: 400,
      code: 'not_adjustable',
      message: 'Only pending manual stall bills can be adjusted before finalize.',
    }
  }

  if (!items.length) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      fields: { items: 'Add at least one product line.' },
    }
  }

  const existingQuotation = await getActiveQuotationForRequest(db, requestId)
  if (!existingQuotation) {
    return {
      ok: false,
      status: 400,
      code: 'no_quotation',
      message: 'Create a quotation before adjusting the bill.',
    }
  }

  const hadAcceptedAmount = existingQuotation.acceptedAmountPaise != null
  const pricingMode = resolveAdjustBillPricingMode(existingQuotation)

  if (opts.acceptedAmountProvided && pricingMode !== 'bargain') {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      fields: { acceptedAmountInr: 'Customer-agreed amount applies only to bargain bills.' },
    }
  }

  const acceptedAmountPaise =
    pricingMode === 'bargain' && opts.acceptedAmountProvided ? opts.acceptedAmountPaise ?? null : null

  const draft = await buildAdjustBillDraft(db, requestId, items, pricingMode)
  if (!draft.ok) {
    return draft
  }

  const { combined, built, audit } = draft
  const quickBillAudit = buildQuickBillQuotationAudit(pricingMode, audit, acceptedAmountPaise)

  /** @type {import('@cloudflare/workers-types').D1PreparedStatement[]} */
  const statements = [
    db.prepare(`DELETE FROM customer_request_items WHERE request_id = ?`).bind(requestId),
  ]

  for (let i = 0; i < combined.length; i += 1) {
    const line = combined[i]
    statements.push(
      db
        .prepare(INSERT_CUSTOMER_REQUEST_ITEM_SQL)
        .bind(
          requestId,
          i + 1,
          line.productId,
          line.familyPackId,
          line.productName,
          line.quantity,
          line.unitPricePaise,
        ),
    )
  }

  const voidQuotationId = existingQuotation.id
  statements.push(
    db
      .prepare(
        `UPDATE quotations SET status = 'void', updated_at = datetime('now') WHERE id = ? AND status != 'void'`,
      )
      .bind(voidQuotationId),
  )

  const quotationId = crypto.randomUUID()
  const auditInsert = resolveQuotationQuickBillAuditInsert({ quickBillAudit })
  const requestRow = await db
    .prepare(`SELECT customer_name, customer_phone, customer_note, status FROM customer_requests WHERE id = ?`)
    .bind(requestId)
    .first()

  const { buildQuotationWhatsAppMessage } = await import('../lib/quotationWhatsApp.js')
  const quoteItemsForWa = built.quoteLines.map((l) => ({
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
      customerName: requestRow?.customer_name,
      customerPhone: requestRow?.customer_phone,
      totalPaise: built.totalPaise,
    },
    quoteItemsForWa,
    { requestSource: row.source ?? 'manual' },
  )

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
        requestRow?.customer_name ?? null,
        requestRow?.customer_phone ?? null,
        requestRow?.customer_note ?? null,
        built.subtotalPaise,
        built.totalPaise,
        waMessage,
        opts.adjustedByEmail ?? null,
        auditInsert.pricing_mode,
        auditInsert.selling_subtotal_paise,
        auditInsert.final_subtotal_paise,
        auditInsert.bargain_floor_paise,
        auditInsert.accepted_amount_paise,
      ),
  )

  for (const line of built.quoteLines) {
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

  try {
    await db.batch(statements)
  } catch (err) {
    return {
      ok: false,
      status: 500,
      code: 'adjust_failed',
      message: 'Could not save adjusted bill. Please refresh and try again.',
    }
  }

  const request = await getAdminCustomerRequestById(db, requestId)
  const quotation = await getActiveQuotationForRequest(db, requestId)
  return {
    ok: true,
    request,
    quotation,
    clearedAcceptedAmount: hadAcceptedAmount && acceptedAmountPaise == null,
    savedAcceptedAmount: acceptedAmountPaise != null,
  }
}
