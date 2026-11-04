import { customerRequestScope } from '../lib/adminCustomerRequestScope.js'
import { requireLegacyServiceMode } from '../lib/adminServiceMode.js'
import { normalizeIdempotencyKey } from '../lib/customerRequestValidation.js'
import { generatePublicReference, isPublicReferenceUniqueConstraintError, PUBLIC_REFERENCE_MAX_GENERATION_ATTEMPTS } from '../lib/customerRequestPublicReference.js'
import { quotationReplacementGuard } from '../lib/adminTransactionIntegrity.js'
import { buildQuotationWhatsAppMessage } from '../lib/quotationWhatsApp.js'
import { buildAcceptedBelowFinalSubtotalWarning } from '../lib/quickBillBargain.js'
import { INSERT_CUSTOMER_REQUEST_WITH_SEASON_SQL, INSERT_CUSTOMER_REQUEST_ITEM_SQL, getPublicRequestSummary } from './publicCustomerRequests.js'
import { INSERT_QUOTATION_WITH_SEASON_SQL, getActiveQuotationForRequest, resolveQuotationQuickBillAuditInsert } from './adminQuotations.js'
import { assignmentMembershipGuard, requestAssignmentStatement } from './adminCustomerRequests.js'

const conflict = () => ({ ok: false, status: 409, code: 'idempotency_conflict',
  message: 'This checkout key belongs to different input or an incomplete transaction. Refresh before retrying.' })
const unavailable = () => ({ ok: false, status: 503, code: 'checkout_failed',
  message: 'Checkout could not be confirmed. Retry with the same Idempotency-Key and billing input.' })
async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
function uuid(digest) {
  const hex = digest.slice(0, 32).split('')
  hex[12] = '4'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16)
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

/** Durable identity uses the existing request PK; the opaque payload digest is
 * stored in manual request raw_message. It is not a price fallback or raw key. */
export async function prepareAtomicQuickBill(db, data, opts) {
  const scope = customerRequestScope(db)
  if (!scope) requireLegacyServiceMode(db)
  const seasonId = scope?.seasonId ?? String(opts.seasonId ?? '').trim()
  const key = normalizeIdempotencyKey(opts.idempotencyKey)
  if (!key) return { ok: false, status: 400, code: 'idempotency_key_required', message: 'A valid Idempotency-Key is required for checkout.' }
  const identity = scope ? ['admin-quick-bill-v1', scope.locationId, seasonId, key]
    : ['admin-quick-bill-legacy-v1', seasonId, opts.createdByEmail?.trim().toLowerCase() ?? null, key]
  const requestId = uuid(await hash(identity))
  const quotationId = uuid(await hash([...identity, 'quotation']))
  const customer = ['name', 'mobile', 'area', 'pickupPreference', 'note', 'deliveryAddress', 'deliveryLandmark', 'deliveryMapsUrl']
    .map(field => data.customer[field] || null)
  const pricingMode = opts.pricingMode ?? 'selling'
  const fingerprint = 'admin-quick-bill-v1:' + await hash([customer,
    data.items.map(item => item.familyPackId?[null,item.familyPackId,item.quantity,'box']:[item.productId, item.quantity, item.unitType === 'piece' ? 'piece' : 'box']),
    pricingMode, pricingMode === 'bargain' ? opts.acceptedAmountPaise ?? null : null, ...(data.assigneeUserId ? [data.assigneeUserId] : []),...(opts.offlineFamilyPacks?.length?[opts.offlineFamilyPacks.map(pack=>[pack.familyPackId,pack.catalogueVersion])]:[])])
  const operation = { ok: true, requestId, quotationId, fingerprint, seasonId }
  const replay = await replayQuickBill(db, operation)
  return replay ? { ...operation, replay } : operation
}

async function replayQuickBill(db, operation) {
  const row = await db.prepare(`SELECT *
    FROM customer_requests WHERE id = ?`).bind(operation.requestId).first()
  if (!row) return null
  if (row.source !== 'manual' || row.raw_message !== operation.fingerprint || !['pending', 'finalized'].includes(row.finalization_status)) return conflict()
  if (row.status !== (row.finalization_status === 'finalized' ? 'closed' : 'quoted')) return conflict()
  const quotation = await getActiveQuotationForRequest(db, operation.requestId, operation.seasonId)
  const request = await getPublicRequestSummary(db, operation.requestId)
  if (!quotation?.items?.length || !request?.publicReference || request.itemCount !== quotation.items.length ||
      !quotation.items.every((item, index) => item.lineNumber === index + 1)) return conflict()
  const warning = quotation.pricingMode === 'bargain'
    ? buildAcceptedBelowFinalSubtotalWarning(Number(quotation.acceptedAmountPaise), quotation.finalSubtotalPaise) : null
  return { ok: true, request: { ...request, revision: row.revision ?? 0, assignedToEmail: row.assigned_to_email ?? null, assignedToUserId: row.assigned_to_user_id ?? null }, quotation, quotationCreated: false, idempotentReplay: true,
    warnings: warning ? [warning] : undefined }
}

/** Snapshot assertion is inside the same batch as request/quotation writes.
 * A concurrent catalogue edit must abort rather than mix old/new price audit. */
function catalogueGuard(db, requestId, lines, season) {
  const columns = ['selling_price_paise', 'final_price_paise', 'pieces_per_pack', 'allow_loose_sale']
  if (!customerRequestScope(db)) {
    requireLegacyServiceMode(db)
    const predicates = lines.map(() => `EXISTS (SELECT 1 FROM products checkout_product
      WHERE checkout_product.id = ? AND checkout_product.season_id = customer_requests.season_id
        AND checkout_product.active = 1 AND checkout_product.stock_status NOT IN ('soldout', 'sold-out')
        AND ${columns.map(column => `checkout_product.${column} IS ?`).join(' AND ')})`)
    return db.prepare(`UPDATE customer_requests SET status = CASE WHEN
      EXISTS (SELECT 1 FROM business_seasons WHERE id = customer_requests.season_id AND status = 'active')
      AND ${predicates.join(' AND ')} THEN status ELSE NULL END WHERE id = ? AND season_id = ?`)
      .bind(...lines.flatMap(line => [line.productId, ...columns.map(column => line.catalogueSnapshot[column])]), requestId, season)
  }
  const predicates = lines.map(() => `EXISTS (SELECT 1 FROM products checkout_product
    WHERE checkout_product.id = ? AND checkout_product.location_id = customer_requests.location_id
      AND checkout_product.active = 1 AND checkout_product.stock_status NOT IN ('soldout', 'sold-out')
      AND ${columns.map(column => `checkout_product.${column} IS ?`).join(' AND ')})`)
  return db.prepare(`UPDATE customer_requests SET status = CASE WHEN
    EXISTS (SELECT 1 FROM business_locations checkout_location
      JOIN businesses checkout_business ON checkout_business.id = checkout_location.business_id
      JOIN location_seasons checkout_association ON checkout_association.location_id = checkout_location.id
      JOIN business_seasons checkout_season ON checkout_season.id = checkout_association.season_id
      WHERE checkout_location.id = customer_requests.location_id AND checkout_association.season_id = customer_requests.season_id
        AND checkout_location.status = 'active' AND checkout_business.status = 'active'
        AND checkout_association.status = 'active' AND checkout_season.status = 'active')
    AND ${predicates.join(' AND ')} THEN status ELSE NULL END WHERE id = ? AND season_id = ?`)
    .bind(...lines.flatMap(line => [line.productId, ...columns.map(column => line.catalogueSnapshot[column])]), requestId, season)
}

/** No shared writer is executed here: their statement constants pass through the
 * existing ownership wrapper. Only ONE D1 batch commits the complete checkout. */
export async function commitAtomicQuickBill(db, data, opts, operation, { resolved, built, audit, warnings }) {
  const season = operation.seasonId
  if (!season || !resolved.lines.length || !built.ok) return unavailable()
  const { requestId, quotationId } = operation
  const c = data.customer
  const auditInsert = resolveQuotationQuickBillAuditInsert({ quickBillAudit: audit })
  const message = buildQuotationWhatsAppMessage({ id: quotationId, customerName: c.name, customerPhone: c.mobile,
    pickupPreference: c.pickupPreference, totalPaise: built.totalPaise }, built.quoteLines, { requestSource: 'manual' })
  for (let attempt = 0; attempt < PUBLIC_REFERENCE_MAX_GENERATION_ATTEMPTS; attempt++) {
    const reference = await generatePublicReference()
    const statements = [db.prepare(INSERT_CUSTOMER_REQUEST_WITH_SEASON_SQL).bind(requestId, reference, c.name, c.mobile,
      c.area || null, c.pickupPreference || null, c.note || null, c.deliveryAddress || null, c.deliveryLandmark || null,
      c.deliveryMapsUrl || null, 'manual', season)]
    for (const line of built.quoteLines) statements.push(db.prepare(INSERT_CUSTOMER_REQUEST_ITEM_SQL).bind(requestId,
      line.line_number, line.product_id, line.family_pack_id??null, line.product_name, line.quantity, line.unit_rate_paise))
    statements.push(db.prepare(`UPDATE customer_requests SET finalization_status = 'pending', raw_message = ?, updated_at = datetime('now')
      WHERE id = ? AND source = 'manual' AND season_id = ?`).bind(operation.fingerprint, requestId, season))
    // Keep each assertion below 100 parameters even for the 50-line cart limit.
    // These remain statements in ONE batch, never separately committed chunks.
    const productLines=resolved.lines.filter(line=>!line.familyPackId)
    for (let start = 0; start < productLines.length; start += 16) {
      statements.push(catalogueGuard(db, requestId, productLines.slice(start, start + 16), season))
    }
    statements.push(customerRequestScope(db)
      ? quotationReplacementGuard(db, { id: requestId, status: 'received', finalization_status: 'pending' }, null, season)
      : db.prepare(`UPDATE customer_requests SET status = CASE WHEN status = 'received' AND finalization_status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM quotations WHERE customer_request_id = ? AND season_id = ? AND status != 'void')
          THEN status ELSE NULL END WHERE id = ? AND season_id = ?`).bind(requestId, season, requestId, season))
    statements.push(db.prepare(INSERT_QUOTATION_WITH_SEASON_SQL).bind(quotationId, requestId, c.name ?? null, c.mobile ?? null,
      c.note ?? null, built.subtotalPaise, built.totalPaise, message, opts.createdByEmail ?? null,
      auditInsert.pricing_mode, auditInsert.selling_subtotal_paise, auditInsert.final_subtotal_paise,
      auditInsert.bargain_floor_paise, auditInsert.accepted_amount_paise, season))
    for (const line of built.quoteLines) statements.push(db.prepare(`INSERT INTO quotation_items
      (quotation_id, line_number, product_id, product_name, quantity, unit_rate_paise, line_total_paise)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(quotationId, line.line_number, line.product_id,
      line.product_name, line.quantity, line.unit_rate_paise, line.line_total_paise))
    statements.push(db.prepare(`UPDATE customer_requests SET status = ?, updated_at = datetime('now')
      WHERE id = ? AND season_id = ?`).bind('quoted', requestId, season))
    if (opts.assigneeEmail) statements.push(
      assignmentMembershipGuard(db, requestId, opts.assigneeEmail, season),
      requestAssignmentStatement(db, requestId, opts.assigneeEmail, opts.createdByEmail, season),
    )
    try {
      await db.batch(statements)
    } catch (error) {
      // A lost success response or competing identical checkout may have committed.
      // Never replay a partially present/different payload and never write a repair.
      const replay = await replayQuickBill(db, operation)
      if (replay) return replay
      if (isPublicReferenceUniqueConstraintError(error?.message ?? error)) continue
      return unavailable()
    }
    const replay = await replayQuickBill(db, operation)
    if (!replay?.ok) return replay ?? unavailable()
    return { ...replay, quotationCreated: true, idempotentReplay: false, warnings: warnings.length ? warnings : undefined }
  }
  return unavailable()
}
