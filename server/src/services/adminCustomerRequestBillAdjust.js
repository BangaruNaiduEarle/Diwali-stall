import { validateCustomerRequestBody } from '../lib/customerRequestValidation.js'
import { buildRequestInternalPricingView } from '../lib/adminInternalPricingPreview.js'
import { parseOptionalCustomerAgreedAmountInrPaise } from '../lib/quickBillBargain.js'
import { INSERT_CUSTOMER_REQUEST_ITEM_SQL } from './publicCustomerRequests.js'
import { ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL } from './adminCustomerRequests.js'
import {
  buildQuoteLinesForRequestItems,
  getActiveQuotationForRequest,
  INSERT_QUOTATION_WITH_SEASON_SQL,
  resolveQuotationQuickBillAuditInsert,
} from './adminQuotations.js'
import {
  buildQuickBillQuotationAudit,
  mapQuickBillLinesForRequestInsert,
  resolveQuickBillProductPricing,
} from './adminQuickBill.js'
import { getAdminCustomerRequestById } from './adminCustomerRequests.js'
import { quotationIsBargainMode } from '../../../src/lib/quotationBargainMode.js'
import { customerRequestDb, customerRequestScope } from '../lib/adminCustomerRequestScope.js'
import { quotationReplacementGuard, transactionChanged } from '../lib/adminTransactionIntegrity.js'
import { billLineKey, parseBillAdjustmentFields, bargainingReference } from '../lib/billAdjustmentPolicy.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'

export const DELETE_CUSTOMER_REQUEST_ITEMS_FOR_SEASON_SQL = `
  DELETE FROM customer_request_items
  WHERE request_id = ?
    AND request_id IN (SELECT id FROM customer_requests WHERE id = ? AND season_id = ?)
`.trim()

const BILL_ADJUST_REQUEST_SELECT_SQL = `
  SELECT id, status, source, finalization_status
  FROM customer_requests
  WHERE id = ? AND season_id = ?
`.trim()

/** @param {string} seasonId */
function requireSeasonId(seasonId) {
  return String(seasonId ?? '').trim()
}

/** @param {{ pricingMode?: string | null, bargainFloorPaise?: number | null } | null | undefined} quotation */
function resolveAdjustBillPricingMode(quotation) {
  return quotationIsBargainMode(quotation) ? 'bargain' : 'selling'
}

/** @param {Record<string, unknown>} row */
export function isCustomerRequestEligibleForBillAdjust(row) {
  if (!row || typeof row !== 'object') return false
  const source = String(row.source ?? '')
  if (!['manual', 'web'].includes(source)) return false
  const finalizationStatus = String(row.finalization_status ?? row.finalizationStatus ?? '').trim()
  if (finalizationStatus !== 'pending' && !(source === 'web' && !finalizationStatus)) return false
  const status = String(row.status ?? '').trim()
  if (status === 'closed' || status === 'void') return false
  return true
}

/** @param {unknown} body */
export function validateAdjustBillBody(body, role = 'owner', {familyPacks=false} = {}) {
  if(familyPacks && Array.isArray(body?.items) && body.items.some(item=>item?.familyPackId)){
    if(body.items.some(item=>item?.familyPackId&&Object.keys(item).some(key=>!['familyPackId','quantity'].includes(key))))return {ok:false,status:400,code:'invalid_family_pack',message:'Family Pack quantities can change; custom pack prices, units or variants are not accepted.'}
    const products=body.items.filter(item=>!item?.familyPackId)
    const normalized=validateCustomerRequestBody({customer:{name:'Adjust Bill',mobile:'9876543210'},items:body.items.map(item=>item?.familyPackId?item:{productId:item?.productId,quantity:item?.quantity,unitType:item?.unitType})},{quickBillItems:true})
    if(!normalized.ok)return normalized
    const parsed=validateAdjustBillBody({...body,items:products.length?products:[{productId:'P001',quantity:1,unitType:'box'}]},role)
    return parsed.ok?{...parsed,data:{...parsed.data,items:normalized.data.items}}:parsed
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }
  const record = /** @type {Record<string, unknown>} */ (body)
  const financial = parseBillAdjustmentFields(record, role)
  if (!financial.ok) return financial
  const itemsResult = validateCustomerRequestBody(
    {
      customer: { name: 'Adjust Bill', mobile: '9876543210' },
      items: financial.items,
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
      overrides: financial.overrides,
      discountProvided: financial.discountProvided,
      discountPaise: financial.discountPaise,
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
 * @param {string} seasonId
 */
async function resolveAdjustBillAudit(db, combined, productAudit, pricingMode, seasonId) {
  if (pricingMode !== 'bargain') {
    return productAudit
  }
  const internalView = await buildRequestInternalPricingView(
    db,
    combinedLinesToPricingRequestItems(combined),
    seasonId,
  )
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
 * @param {string} seasonId
 */
async function buildAdjustBillDraft(db, requestId, items, pricingMode, seasonId, options = {}) {
  const resolved = await resolveQuickBillProductPricing(db, items.filter(item=>!item.familyPackId), seasonId)
  if (!resolved.ok) {
    return resolved
  }

  const productLines = mapQuickBillLinesForRequestInsert(resolved.lines)
  const existingItemsResult = await db
    .prepare(ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL)
    .bind(requestId)
    .all()
  const familyLines = options.offlineFamilyPacks===undefined?preservedFamilyPackLines(existingItemsResult.results ?? []):items.filter(item=>item.familyPackId).map(item=>{
    const pack=options.offlineFamilyPacks.find(pack=>pack.familyPackId===item.familyPackId)
    if(!pack)throw Object.assign(Error('A complete Family Pack snapshot is required.'),{status:409,code:'family_pack_catalogue_conflict'})
    return {productId:null,familyPackId:item.familyPackId,productName:pack.name,quantity:item.quantity,unitPricePaise:pack.sellingUnitPaise}
  })
  const originals = new Map((existingItemsResult.results ?? []).filter(row => row.product_id).map(row => [billLineKey(row), row]))

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

  const built = await buildQuoteLinesForRequestItems(db, rowsForQuote, seasonId)
  if (!built.ok) {
    return built
  }

  if (customerRequestScope(db)) {
    const overrides = new Map((options.overrides ?? []).map(line => [billLineKey(line), line.unitRatePaise]))
    for (let i = 0; i < combined.length; i++) {
      const line = combined[i]
      const prior = line.productId ? originals.get(billLineKey(line)) : (existingItemsResult.results ?? []).find(row => row.family_pack_id === line.familyPackId)
      const details = prior?.product_details_json ? JSON.parse(prior.product_details_json) : { productId: line.productId, familyPackId: line.familyPackId, name: line.productName, company: resolved.lines.find(row => row.productId === line.productId)?.company ?? null }
      const catalogueUnit = Number.isSafeInteger(prior?.unit_price_paise) && prior.unit_price_paise > 0 ? prior.unit_price_paise : line.unitPricePaise
      const knownSnapshot = ['box', 'piece'].includes(prior?.unit_type) || Boolean(line.familyPackId)
      const safeCatalogueUnit = details.billing?.catalogueUnitPaise ?? (knownSnapshot ? catalogueUnit : line.unitPricePaise)
      const savedUnit = details.billing?.version === 1 ? details.billing.sellingUnitPaise : safeCatalogueUnit
      const sellingUnit = overrides.get(billLineKey(line)) ?? savedUnit
      if (!Number.isSafeInteger(sellingUnit) || sellingUnit <= 0 || !Number.isSafeInteger(sellingUnit * line.quantity)) return { ok: false, status: 400, code: 'invalid_price', message: 'Invalid adjusted selling price.' }
      line.unitPricePaise = catalogueUnit
      if (prior) line.productName = prior.product_name
      line.billingDetails = { ...details, billing: { version: 1, catalogueUnitPaise: safeCatalogueUnit, sellingUnitPaise: sellingUnit } }
      built.quoteLines[i].product_name = line.productName
      built.quoteLines[i].unit_rate_paise = sellingUnit
      built.quoteLines[i].line_total_paise = sellingUnit * line.quantity
    }
    built.subtotalPaise = built.quoteLines.reduce((sum, line) => sum + line.line_total_paise, 0)
    const discount = options.discountProvided ? options.discountPaise : Math.max(0, -(options.existingQuotation?.adjustmentPaise ?? 0))
    if (!Number.isSafeInteger(built.subtotalPaise) || !Number.isSafeInteger(discount) || discount < 0 || discount > built.subtotalPaise) return { ok: false, status: 400, code: 'invalid_discount', message: 'Discount cannot exceed the adjusted subtotal.' }
    built.adjustmentPaise = -discount
    built.totalPaise = built.subtotalPaise - discount
    for (const line of combined) line.billingDetails.billing.discountPaise = discount
  }

  const audit = await resolveAdjustBillAudit(db, combined, resolved.audit, pricingMode, seasonId)
  if (customerRequestScope(db)) audit.sellingSubtotalPaise = combined.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0)
  const internalView = await buildRequestInternalPricingView(
    db,
    combinedLinesToPricingRequestItems(combined),
    seasonId,
  )

  return {
    ok: true,
    resolved,
    combined,
    built,
    audit,
    preview: {
      subtotalPaise: built.subtotalPaise,
      totalPaise: built.totalPaise,
      discountPaise: -(built.adjustmentPaise ?? 0),
      customerSellingSubtotalPaise: built.subtotalPaise,
      sellingSubtotalPaise: internalView?.sellingSubtotalPaise ?? audit.sellingSubtotalPaise,
      finalSubtotalPaise: internalView?.finalSubtotalPaise ?? null,
      bargainFloorPaise:
        pricingMode === 'bargain' ? bargainingReference(internalView?.finalSubtotalPaise ?? audit.finalSubtotalPaise) : null,
      pricingMode,
    },
  }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {{ productId: string, quantity: number, unitType?: 'box' | 'piece' }[]} items
 * @param {string} seasonId
 */
export async function previewPendingCustomerRequestBillAdjust(db, requestId, items, seasonId, context, financial = {}) {
  db = customerRequestDb(db, seasonId, context, true)
  if ((financial.overrides?.length || financial.discountProvided || financial.acceptedAmountProvided) && !canViewSensitiveProductPricing(customerRequestScope(db)?.effectiveRole ?? financial.actorRole)) return { ok: false, status: 403, code: 'forbidden', message: 'Privileged financial authority is required.' }
  const season = requireSeasonId(seasonId)
  if (!season) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Active business season is required for bill adjustment.',
    }
  }
  const row = await db.prepare(BILL_ADJUST_REQUEST_SELECT_SQL).bind(requestId, season).first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }
  if (context?.workflowTransport?.expectedRevision != null && row.revision !== context.workflowTransport.expectedRevision) return transactionChanged()
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

  const existingQuotation = await getActiveQuotationForRequest(db, requestId, season)
  if (!existingQuotation) {
    return {
      ok: false,
      status: 400,
      code: 'no_quotation',
      message: 'Create a quotation before adjusting the bill.',
    }
  }

  const pricingMode = resolveAdjustBillPricingMode(existingQuotation)
  const draft = await buildAdjustBillDraft(db, requestId, items, pricingMode, season, { ...financial, existingQuotation })
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
 * @param {{ adjustedByEmail?: string | null, acceptedAmountProvided?: boolean, acceptedAmountPaise?: number | null, seasonId?: string }} [opts]
 */
export async function adjustPendingCustomerRequestBill(db, requestId, items, opts = {}) {
  db = customerRequestDb(db, opts.seasonId, opts.context, true)
  const privileged = canViewSensitiveProductPricing(customerRequestScope(db)?.effectiveRole ?? opts.actorRole)
  if ((opts.overrides?.length || opts.discountProvided || opts.acceptedAmountProvided) && !privileged) return { ok: false, status: 403, code: 'forbidden', message: 'Privileged financial authority is required.' }
  if ((opts.overrides?.length || opts.discountProvided) && !customerRequestScope(db)) return { ok: false, status: 400, code: 'location_required', message: 'Select an authorized location for financial adjustments.' }
  const season = requireSeasonId(opts.seasonId)
  if (!season) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Active business season is required for bill adjustment.',
    }
  }
  const row = await db.prepare(BILL_ADJUST_REQUEST_SELECT_SQL).bind(requestId, season).first()
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

  if (opts.requireRevision && opts.context?.workflowTransport?.expectedRevision == null) return { ok: false, status: 428, code: 'revision_required', message: 'Refresh the request and send its current revision before saving.' }

  if (!items.length) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      fields: { items: 'Add at least one product line.' },
    }
  }

  const existingQuotation = await getActiveQuotationForRequest(db, requestId, season)
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

  const draft = await buildAdjustBillDraft(db, requestId, items, pricingMode, season, { ...opts, existingQuotation })
  if (!draft.ok) {
    return draft
  }

  const { combined, built, audit } = draft
  const quickBillAudit = buildQuickBillQuotationAudit(pricingMode, audit, acceptedAmountPaise)

  /** @type {import('@cloudflare/workers-types').D1PreparedStatement[]} */
  const statements = [
    ...(customerRequestScope(db) ? [quotationReplacementGuard(db, row, existingQuotation, season)] : []),
    db
      .prepare(DELETE_CUSTOMER_REQUEST_ITEMS_FOR_SEASON_SQL)
      .bind(requestId, requestId, season),
  ]

  for (let i = 0; i < combined.length; i += 1) {
    const line = combined[i]
    statements.push(
      db
        .prepare(line.billingDetails ? INSERT_CUSTOMER_REQUEST_ITEM_SQL.replace('unit_price_paise\n', 'unit_price_paise, product_details_json\n').replace('?, ?, ?, ?, ?, ?, ?)', '?, ?, ?, ?, ?, ?, ?, ?)') : INSERT_CUSTOMER_REQUEST_ITEM_SQL)
        .bind(
          requestId,
          i + 1,
          line.productId,
          line.familyPackId,
          line.productName,
          line.quantity,
          line.unitPricePaise,
          ...(line.billingDetails ? [JSON.stringify(line.billingDetails)] : []),
        ),
    )
  }

  const voidQuotationId = existingQuotation.id
  const quotationId = crypto.randomUUID()
  statements.push(
    db
      .prepare(
        `UPDATE quotations SET status = 'void', updated_at = datetime('now')
         WHERE id = ? AND status != 'void' AND season_id = ?`,
      )
      .bind(voidQuotationId, season),
  )

  const auditInsert = resolveQuotationQuickBillAuditInsert({ quickBillAudit })
  const requestRow = await db
    .prepare(
      `SELECT customer_name, customer_phone, customer_note, status FROM customer_requests WHERE id = ? AND season_id = ?`,
    )
    .bind(requestId, season)
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
      .prepare(INSERT_QUOTATION_WITH_SEASON_SQL)
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
        season,
      ),
  )

  if (customerRequestScope(db) && built.adjustmentPaise) statements.push(db.prepare(`UPDATE quotations SET adjustment_paise = ?, updated_at = datetime('now') WHERE id = ? AND season_id = ?`).bind(built.adjustmentPaise, quotationId, season))

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
    if (customerRequestScope(db) && /NOT NULL constraint failed: customer_requests.status/.test(String(err?.message ?? err))) return transactionChanged()
    return {
      ok: false,
      status: 500,
      code: 'adjust_failed',
      message: 'Could not save adjusted bill. Please refresh and try again.',
    }
  }

  const request = await getAdminCustomerRequestById(db, requestId, season)
  const quotation = await getActiveQuotationForRequest(db, requestId, season)
  return {
    ok: true,
    request,
    quotation,
    clearedAcceptedAmount: hadAcceptedAmount && acceptedAmountPaise == null,
    savedAcceptedAmount: acceptedAmountPaise != null,
  }
}
