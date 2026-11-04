import { adminOperationScope } from '../lib/adminOperationScope.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { paymentFingerprint, validatePaymentBody } from '../lib/paymentValidation.js'

const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }) }
const summarySql = 'SELECT * FROM request_payment_summaries WHERE business_id = ? AND location_id = ? AND season_id = ?'
const ledgerSql = 'SELECT * FROM request_payment_ledger WHERE business_id = ? AND location_id = ? AND season_id = ? AND request_id = ?'
const scopeValues = scope => [scope.businessId, scope.locationId, scope.seasonId]

function scopeFor(db, { seasonId, context }, write = false) {
  const scope = adminOperationScope(db, seasonId, context, write)
  if (!scope.locationId) fail(403, 'location_required', 'Payments require an authorized business location and season.')
  if (write && !canViewSensitiveProductPricing(scope.effectiveRole)) fail(403, 'forbidden', 'Only Owner or Super Admin can record payments or change payment hold.')
  return scope
}

export function mapPaymentSummary(row) {
  return {
    amountDuePaise: row.amount_due_paise ?? null, receivedPaise: row.received_paise,
    outstandingPaise: row.outstanding_paise ?? null, paymentStatus: row.payment_status,
    onHold: row.payment_status === 'HOLD', paymentCount: row.payment_count,
    lastPaymentAt: row.last_payment_at ?? null, revision: row.revision,
    eligible: row.request_status === 'closed' && row.finalization_status === 'finalized' && row.amount_due_paise != null,
    amountBasis: row.amount_due_paise == null ? null : 'finalized_customer_agreed_amount',
  }
}

export function mapPayment(row) {
  return {
    sequence: row.sequence, paymentId: row.payment_id, operationId: row.operation_id, requestId: row.request_id,
    entryType: row.entry_type, amountPaise: row.amount_paise, recordingMode: row.recording_mode,
    paymentMethod: row.payment_method, reference: row.reference, details: row.details,
    actorUserId: row.actor_user_id, actorName: row.actor_name, actorRole: row.actor_role,
    deviceId: row.device_id, occurredAt: row.occurred_at, receivedAt: row.received_at,
  }
}

async function summary(db, requestId, scope) {
  const row = await db.prepare(summarySql + ' AND request_id = ?').bind(...scopeValues(scope), requestId).first()
  if (!row) fail(404, 'not_found', 'Request not found.')
  return mapPaymentSummary(row)
}

export async function attachPaymentSummaries(db, requests, options) {
  const scope = adminOperationScope(db, options.seasonId, options.context)
  if (!scope.locationId || !requests.length) return requests
  const rows = new Map()
  // Keep D1 statements below 100 bound parameters even at maximum list size.
  for (let start = 0; start < requests.length; start += 90) {
    const ids = requests.slice(start, start + 90).map(request => request.id)
    const result = await db.prepare(summarySql + ` AND request_id IN (${ids.map(() => '?').join(',')})`).bind(...scopeValues(scope), ...ids).all()
    for (const row of result.results ?? []) rows.set(row.request_id, mapPaymentSummary(row))
  }
  return requests.map(request => ({ ...request, paymentSummary: rows.get(request.id) ?? null }))
}

export async function getRequestPayments(db, requestId, options) {
  const scope = scopeFor(db, options)
  const [summaryResult, result] = await db.batch([
    db.prepare(summarySql + ' AND request_id = ?').bind(...scopeValues(scope), requestId),
    db.prepare(ledgerSql + ' AND sequence > ? ORDER BY sequence ASC LIMIT ?').bind(...scopeValues(scope), requestId, options.afterSequence ?? 0, options.limit ?? 50),
  ])
  const row = summaryResult.results?.[0]
  if (!row) fail(404, 'not_found', 'Request not found.')
  return { ok: true, summary: mapPaymentSummary(row), entries: (result.results ?? []).map(mapPayment) }
}

export async function recordRequestPayment(db, requestId, body, options) {
  const scope = scopeFor(db, options, true)
  const validated = validatePaymentBody(body, options.context?.workflowTransport)
  if (!validated.ok) return { ok: false, status: 400, code: 'validation_error', fields: validated.errors, message: 'Invalid payment details.' }
  const data = validated.data, deviceId = options.context?.workflowTransport?.deviceId ?? null
  const fingerprint = await paymentFingerprint(data, scope.userId, deviceId)
  const current = await summary(db, requestId, scope)
  const replay = async () => {
    const existing = await db.prepare(ledgerSql + ' AND operation_id = ?').bind(...scopeValues(scope), requestId, data.operationId).first()
    if (!existing) return null
    if (existing.payload_fingerprint !== fingerprint) fail(409, 'operation_conflict', 'This operation ID belongs to different payment details.')
    return { ok: true, idempotentReplay: true, entry: mapPayment(existing), summary: await summary(db, requestId, scope) }
  }
  const existing = await replay()
  if (existing) return existing
  if (!current.eligible) fail(409, 'request_not_payable', 'Finalize the request with a saved customer-agreed amount before recording payments.')
  const expectedRevision = options.context?.workflowTransport?.expectedRevision
  if (expectedRevision == null) fail(428, 'revision_required', 'Refresh payment details and send the displayed revision.')
  if (expectedRevision !== current.revision) fail(409, 'revision_conflict', 'The request changed. Refresh before retrying.')
  if (data.entryType === 'PAYMENT' && data.paymentMethod !== 'CASH' && data.normalizedReference) {
    const duplicate = await db.prepare('SELECT payment_id FROM request_payment_ledger WHERE business_id = ? AND location_id = ? AND season_id = ? AND payment_method = ? AND normalized_reference = ? AND entry_type = ?')
      .bind(...scopeValues(scope), data.paymentMethod, data.normalizedReference, 'PAYMENT').first()
    if (duplicate) fail(409, 'duplicate_transaction', 'This transaction reference has already been recorded.')
  }
  if (data.amountPaise > current.outstandingPaise) fail(400, 'amount_exceeds_outstanding', 'Payment amount exceeds the outstanding balance.')
  if (data.entryType === 'HOLD' && current.outstandingPaise === 0) fail(409, 'already_paid', 'A fully paid request cannot be placed on payment hold.')
  const paymentId = crypto.randomUUID()
  try {
    await db.batch([
      db.prepare(`UPDATE customer_requests SET status = CASE WHEN revision = ? THEN status ELSE NULL END
        WHERE id = ? AND location_id = ? AND season_id = ? AND EXISTS (SELECT 1 FROM business_locations l WHERE l.id = customer_requests.location_id AND l.business_id = ?)`)
        .bind(expectedRevision, requestId, scope.locationId, scope.seasonId, scope.businessId),
      db.prepare(`INSERT INTO request_payment_ledger(payment_id,operation_id,payload_fingerprint,request_id,business_id,location_id,season_id,
        entry_type,amount_paise,recording_mode,payment_method,reference,normalized_reference,details,actor_user_id,actor_name,actor_role,device_id,occurred_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT display_name FROM admin_users WHERE id = ?),?,?,COALESCE(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
        .bind(paymentId, data.operationId, fingerprint, requestId, ...scopeValues(scope), data.entryType, data.amountPaise,
          data.recordingMode, data.paymentMethod, data.reference, data.normalizedReference, data.details, scope.userId, scope.userId, scope.effectiveRole, deviceId, data.occurredAt),
    ])
  } catch (error) {
    const committed = await replay()
    if (committed) return committed
    const message = String(error?.message ?? error)
    if (message.includes('payment_exceeds_outstanding')) fail(409, 'balance_changed', 'The outstanding balance changed. Refresh before retrying.')
    if (message.includes('NOT NULL constraint failed: customer_requests.status')) fail(409, 'revision_conflict', 'The request changed. Refresh before retrying.')
    if (message.includes('payment_scope_or_authority_changed')) fail(403, 'forbidden', 'Payment authority or location scope changed.')
    if (message.includes('UNIQUE constraint failed')) fail(409, 'duplicate_operation_or_transaction', 'The operation ID or transaction reference has already been used.')
    fail(503, 'payment_not_confirmed', 'Payment could not be confirmed. Retry with the same operation ID and payment details.')
  }
  const saved = await replay()
  if (!saved) fail(503, 'payment_not_confirmed', 'Payment could not be confirmed. Retry with the same operation ID.')
  return { ...saved, idempotentReplay: false }
}
