import { adminOperationScope, validateOperationOwnership } from '../lib/adminOperationScope.js'
import { inheritAdminServiceMode } from '../lib/adminServiceMode.js'
import { customerRequestDb } from '../lib/adminCustomerRequestScope.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { validateQuickBillCheckoutBody } from '../lib/quickBillValidation.js'
import { validateAdjustBillBody, adjustPendingCustomerRequestBill } from './adminCustomerRequestBillAdjust.js'
import { checkoutQuickBill } from './adminQuickBill.js'
import { finalizeAdminCustomerRequest, getAdminCustomerRequestById } from './adminCustomerRequests.js'
import { getActiveQuotationForRequest, patchActiveQuotationCustomerAgreedAmount } from './adminQuotations.js'
import { recordRequestPayment, getRequestPayments } from './adminPayments.js'
import { filterCustomerRequestDetailForRole } from '../lib/adminQuotationResponse.js'
import { resolveHandover, handoverClaimStatements } from './adminHandover.js'
import { validatePayload } from '../../../src/shared/handoverProtocol.js'
import { offlineFamilyPackCatalogue, validateOfflineFamilyPacks, familyPackGuards } from './offlineFamilyPacks.js'
import { transferProductIds } from '../../../src/shared/familyPackSnapshot.js'

const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }) }
const values = scope => [scope.businessId, scope.locationId, scope.seasonId, scope.userId]
const deviceWhere = 'business_id = ? AND location_id = ? AND season_id = ? AND user_id = ? AND device_id = ?'
const fields = ['id', 'name', 'pack', 'company', 'category_slug', 'selling_price_paise', 'pieces_per_pack', 'allow_loose_sale', 'active', 'stock_status']
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export async function offlineDigest(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
function scopeFor(db, options, write = false) {
  const scope = adminOperationScope(db, options.seasonId, options.context, write)
  if (!scope.locationId) fail(403, 'location_required', 'Offline billing requires an authorized business, location and season.')
  return scope
}
function deviceInput(body) {
  if (!object(body) || typeof body.deviceId !== 'string' || typeof body.deviceToken !== 'string' || !/^[\w.:@-]{8,128}$/.test(body.deviceId) || !/^[a-f0-9]{64}$/.test(body.deviceToken)) fail(400, 'invalid_device', 'A persistent device ID and device secret are required.')
}
export async function registerOfflineDevice(db, body, options) {
  const scope = scopeFor(db, options, true)
  deviceInput(body)
  const tokenHash = await offlineDigest(body.deviceToken)
  await db.prepare(`INSERT INTO offline_sync_devices(business_id,location_id,season_id,user_id,device_id,token_hash)
    VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(...values(scope), body.deviceId, tokenHash).run()
  await validateDevice(db, scope, body.deviceId, tokenHash)
  return { ok: true, scope: { ...scope, deviceId: body.deviceId } }
}
async function validateDevice(db, scope, deviceId, tokenHash) {
  const row = await db.prepare(`SELECT token_hash,disabled_at FROM offline_sync_devices WHERE ${deviceWhere}`).bind(...values(scope), deviceId).first()
  if (!row || row.disabled_at || row.token_hash !== tokenHash) fail(403, 'device_denied', 'This device is not registered or has been disabled for this user and stall.')
}
const productSql = `SELECT ${fields.map(field => 'p.' + field).join(',')} FROM products p
  WHERE p.location_id = ? AND EXISTS (SELECT 1 FROM categories c WHERE c.slug = p.category_slug AND c.location_id = p.location_id)`
export async function offlineCatalogue(db, options) {
  const scope = scopeFor(db, options)
  const result = await db.prepare(productSql + ' ORDER BY p.id LIMIT 5001').bind(scope.locationId).all()
  if (result.results.length > 5000) fail(409, 'catalogue_too_large', 'This catalogue exceeds the offline snapshot limit.')
  return { ok: true, products: result.results, ...await offlineFamilyPackCatalogue(db,scope.locationId), capturedAt: new Date().toISOString(), scope }
}
// Purchase/profit/private pricing are deliberately never cached, even for owners.
export async function offlineRequestSnapshot(db, requestId, options) {
  const scope = scopeFor(db, options)
  const scoped = customerRequestDb(db, scope.seasonId, options.context)
  let request = await getAdminCustomerRequestById(scoped, requestId, scope.seasonId)
  if (!request) fail(404, 'not_found', 'Request not found.')
  request = await filterCustomerRequestDetailForRole(scoped, request, scope.effectiveRole, scope.seasonId)
  const quotation = await getActiveQuotationForRequest(scoped, requestId, scope.seasonId)
  const { summary } = await getRequestPayments(db, requestId, options)
  const safe = Object.fromEntries(['id','revision','publicReference','status','source','customerName','customerPhone','customerArea','customerNote','pickupPreference','deliveryAddress','deliveryLandmark','deliveryMapsUrl','finalizationStatus','createdAt',
    'creatorUserId','creatorName','creatorRole','assignedToUserId','assignedToName','assignedToRole','assignedAt','closedAt','closedByEmail']
    .map(key => [key, request[key] ?? null]))
  safe.items = request.items.map(item => Object.fromEntries(['lineId','productId','familyPackId','productName','quantity','unitType','packSnapshot','unitPricePaise'].map(key => [key, item[key] ?? null])))
  return { ok: true, request: safe, paymentSummary: summary,
    acceptedAmountPaise: canViewSensitiveProductPricing(scope.effectiveRole) ? quotation?.acceptedAmountPaise ?? null : null }
}

async function receipt(db, operationId, scope, deviceId) {
  return db.prepare(`SELECT * FROM offline_sync_receipts WHERE operation_id = ? AND ${deviceWhere}`).bind(operationId, ...values(scope), deviceId).first()
}
function acknowledgement(row, replay) {
  return { ok: true, operationId: row.operation_id, requestId: row.request_id, revision: row.revision, receivedAt: row.received_at, idempotentReplay: replay }
}

/** Wrap the RAW binding below the existing request scope wrapper. Only the one
 * business write batch receives a receipt; read batches remain untouched. */
function operationDb(raw, operation, scope, fingerprint, requestId, expectedRevision, handover) {
  const statements = new WeakMap()
  let createdId = requestId, committed = false, batchError = null
  const wrapped = {
    prepare(sql) {
      return { bind(...binds) {
        const prepared = raw.prepare(sql).bind(...binds)
        statements.set(prepared, { sql, binds })
        if (/^INSERT INTO customer_requests\b/i.test(sql.trim())) createdId = binds[0]
        return prepared
      } }
    },
    async batch(batch) {
      const mutates = batch.some(item => !/^SELECT\b/i.test(statements.get(item)?.sql.trim() ?? ''))
      if (!mutates) return raw.batch(batch)
      if (committed) throw Error('Offline operations must use one business write batch.')
      const before = []
      if (requestId) before.push(raw.prepare(`UPDATE customer_requests SET status = CASE WHEN revision = ? THEN status ELSE NULL END
        WHERE id = ? AND location_id = ? AND season_id = ?`).bind(expectedRevision, requestId, scope.locationId, scope.seasonId))
      // Check offline snapshots in the same transaction as the existing pricing guards.
      for (const snapshot of operation.catalogue ?? []) before.push(raw.prepare(`UPDATE customer_requests SET status = CASE WHEN EXISTS (
        SELECT 1 FROM products p WHERE p.location_id = ? AND ${fields.map(field => `p.${field} IS ?`).join(' AND ')}
        AND EXISTS (SELECT 1 FROM categories c WHERE c.slug = p.category_slug AND c.location_id = p.location_id)) THEN status ELSE NULL END
        WHERE id = ? AND location_id = ? AND season_id = ?`).bind(scope.locationId, ...fields.map(field => snapshot[field]), requestId ?? createdId, scope.locationId, scope.seasonId))
      for(const line of operation.lineSnapshots??[])if(line.familyPackId)before.push(...familyPackGuards(raw,scope,line.packSnapshot,requestId??createdId))
      // Creation guards must run after the INSERT. Existing checkout already guards
      // current catalogue pricing; these additionally compare the OFFLINE snapshot.
      const inserts = requestId ? batch : [batch[0], ...before, ...batch.slice(1)]
      const save = raw.prepare(`INSERT INTO offline_sync_receipts(operation_id,fingerprint,business_id,location_id,season_id,user_id,device_id,
        actor_role,captured_role,operation_type,parent_operation_id,resolution_of,request_id,revision,occurred_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM customer_requests WHERE id = ? AND location_id = ? AND season_id = ?),
          (SELECT revision FROM customer_requests WHERE id = ?),?)`)
        .bind(operation.operationId, fingerprint, ...values(scope), operation.scope.deviceId, scope.effectiveRole, operation.capturedRole ?? null, operation.kind,
          operation.parentOperationId ?? null, operation.resolutionOf ?? null, requestId ?? createdId, scope.locationId, scope.seasonId, requestId ?? createdId, operation.occurredAt)
      try {
        const claims = handover ? handoverClaimStatements(raw, handover, operation, scope, requestId ?? createdId) : []
        const result = await raw.batch([...(requestId ? before : []), ...inserts, ...claims, save])
        committed = true
        const offset = requestId ? before.length : 0
        return requestId ? result.slice(offset, -(1 + claims.length)) : [result[0], ...result.slice(1 + before.length, -(1 + claims.length))]
      } catch (error) { batchError = error; throw error }
    },
  }
  inheritAdminServiceMode(wrapped, raw)
  return { db: wrapped, error: () => batchError }
}

export async function synchronizeOfflineOperation(db, operation, options) {
  const scope = scopeFor(db, options, true)
  if (!object(operation) || Object.keys(operation).some(key => !['operationId','kind','scope','deviceToken','occurredAt','requestId','expectedRevision','parentOperationId','body','catalogue','resolutionOf','capturedRole','lineSnapshots'].includes(key)) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operation.operationId ?? '') || !['CREATE','EDIT','AGREEMENT','CLOSE','PAYMENT','HANDOVER'].includes(operation.kind) ||
      !object(operation.scope) || !object(operation.body) || typeof operation.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(operation.occurredAt) ||
      !Number.isFinite(Date.parse(operation.occurredAt)) || new Date(operation.occurredAt).toISOString() !== operation.occurredAt) fail(400, 'invalid_operation', 'Invalid offline operation envelope.')
  if (operation.capturedRole != null && !['admin','super_admin','owner'].includes(operation.capturedRole)) fail(400, 'invalid_operation', 'Invalid reported capture role.')
  validateOperationOwnership(scope, operation.scope)
  if (operation.scope.userId !== scope.userId) fail(403, 'user_mismatch', 'The offline operation belongs to another user.')
  deviceInput({ deviceId: operation.scope.deviceId, deviceToken: operation.deviceToken })
  await validateDevice(db, scope, operation.scope.deviceId, await offlineDigest(operation.deviceToken))
  const privileged = canViewSensitiveProductPricing(scope.effectiveRole)
  if (['AGREEMENT','CLOSE','PAYMENT','HANDOVER'].includes(operation.kind) && !privileged) fail(403, 'forbidden', 'Only Owner or Super Admin can accept handovers, record agreements, close requests or record payments.')
  const fingerprint = await offlineDigest({ ...operation, deviceToken: undefined })
  const replay = await receipt(db, operation.operationId, scope, operation.scope.deviceId)
  if (replay) {
    if (replay.fingerprint !== fingerprint) fail(409, 'operation_conflict', 'This operation ID belongs to different offline input.')
    return acknowledgement(replay, true)
  }
  let handover = null
  if (operation.kind === 'HANDOVER') {
    if (Object.keys(operation.body).some(key => key !== 'transfer') || operation.parentOperationId || operation.lineSnapshots || operation.requestId !== operation.body.transfer?.payload?.requestId || operation.expectedRevision !== operation.body.transfer?.payload?.revision) fail(400, 'invalid_transfer', 'Invalid handover operation envelope.')
    handover = await resolveHandover(db, operation.body.transfer, scope, options, options.handoverEnv ?? {})
    operation = { ...operation, kind: handover.kind, requestId: handover.requestId, expectedRevision: handover.expectedRevision, body: handover.body, lineSnapshots: handover.lines }
  }
  let requestId = operation.requestId, expectedRevision = operation.expectedRevision
  if (operation.parentOperationId) {
    const parent = await receipt(db, operation.parentOperationId, scope, operation.scope.deviceId)
    if (!parent) fail(409, 'dependency_pending', 'Synchronize the preceding operation first.')
    if (requestId && requestId !== parent.request_id) fail(409, 'dependency_conflict', 'The predecessor belongs to another request.')
    requestId = parent.request_id; expectedRevision = parent.revision
  }
  if (operation.kind === 'CREATE') {
    if (requestId || operation.parentOperationId || expectedRevision != null) fail(400, 'invalid_operation', 'Creation cannot refer to an existing request or revision.')
  } else {
    if (!requestId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail(428, 'revision_required', 'The original server revision or acknowledged predecessor is required.')
    const current = await db.prepare('SELECT revision,status,finalization_status FROM customer_requests WHERE id = ? AND location_id = ? AND season_id = ?').bind(requestId, scope.locationId, scope.seasonId).first()
    if (!current) fail(404, 'not_found', 'Request not found.')
    if (current.revision !== expectedRevision) fail(409, 'revision_conflict', 'Competing changes exist. Preserve both versions and resolve explicitly.')
    if (operation.kind !== 'PAYMENT' && ['closed','void'].includes(current.status)) fail(409, 'closure_conflict', 'This request was already closed or voided by another operation.')
  }
  const context = { ...options.context, workflowTransport: { deviceId: operation.scope.deviceId, occurredAt: operation.occurredAt, expectedRevision,
    handoverCreator: handover?.creator, handoverLines: operation.lineSnapshots } }
  let validated
  if (operation.kind === 'CREATE') validated = validateQuickBillCheckoutBody(operation.body, scope.effectiveRole)
  if (operation.kind === 'EDIT') validated = validateAdjustBillBody(operation.body, scope.effectiveRole, {familyPacks:true})
  if (validated && !validated.ok) return { ok: false, status: validated.status ?? 400, error: validated.code ?? 'validation_error', fields: validated.errors, message: validated.message ?? 'Invalid offline request details.' }
  if (operation.kind === 'CLOSE' && Object.keys(operation.body).length) fail(400, 'invalid_operation', 'Closure does not accept pricing or scope changes.')
  if (operation.kind === 'AGREEMENT' && (Object.keys(operation.body).some(key => key !== 'acceptedAmountPaise') || !Number.isSafeInteger(operation.body.acceptedAmountPaise) || operation.body.acceptedAmountPaise <= 0)) fail(400, 'invalid_operation', 'Agreement requires positive integer paise only.')
  let offlinePacks=[]
  if (['CREATE','EDIT'].includes(operation.kind)) {
    if(operation.body.items.some(item=>item.familyPackId&&Object.keys(item).some(key=>!['familyPackId','quantity'].includes(key))))fail(400,'unsupported_family_pack','Family Packs require a catalogue pack ID and whole-pack quantity. Custom variants, component substitutions and pack price overrides are unsupported.')
    if(validated.data.items.some(item=>item.familyPackId)&&!operation.lineSnapshots)fail(400,'family_pack_snapshot_required','Family Pack operations require complete original line snapshots.')
    if (operation.lineSnapshots) {
      validatePayload({ v:operation.lineSnapshots.some(line=>line.familyPackId)?2:1, transferId:operation.operationId, scope:{businessId:scope.businessId,locationId:scope.locationId,seasonId:scope.seasonId}, requestId:requestId ?? operation.operationId,
        revision:0, sourceOperationId:null, creatorUserId:scope.userId, recipientUserId:scope.userId, occurredAt:operation.occurredAt, sourceOccurredAt:operation.occurredAt, customer:{name:'Validation',mobile:'9876543210'},lines:operation.lineSnapshots })
      if (JSON.stringify(operation.lineSnapshots.map(line=>[line.productId??line.familyPackId,line.quantity,line.unitType])) !== JSON.stringify(validated.data.items.map(line=>[line.productId??line.familyPackId,line.quantity,line.unitType ?? 'box']))) fail(400, 'invalid_transfer', 'Line identities do not match the queued items.')
      offlinePacks=await validateOfflineFamilyPacks(db,scope,operation.lineSnapshots,requestId)
    }
    const ids = operation.lineSnapshots?transferProductIds(operation.lineSnapshots):[...new Set(validated.data.items.map(item=>item.productId))]
    if (!Array.isArray(operation.catalogue) || operation.catalogue.length !== ids.length || operation.catalogue.length > (offlinePacks.length?5000:50) ||
        new Set(operation.catalogue.map(row => row?.id)).size !== ids.length) fail(400, 'catalogue_required', 'Every product requires its saved catalogue snapshot.')
    for (const id of ids) {
      const snapshot = operation.catalogue.find(row => row?.id === id)
      if (!snapshot || Object.keys(snapshot).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(snapshot, key))) fail(400, 'catalogue_required', 'A complete selling catalogue snapshot is required.')
      const current = await db.prepare(productSql + ' AND p.id = ?').bind(scope.locationId, id).first()
      if (!current) fail(404, 'product_not_found', 'Product is outside the authorized catalogue.')
      if (JSON.stringify(canonical(snapshot)) !== JSON.stringify(canonical(current))) fail(409, 'catalogue_conflict', 'The catalogue changed after this draft. Review its prices and units before resubmitting.')
      for (const line of operation.lineSnapshots?.filter(line=>line.productId===id) ?? []) {
        const expectedPrice = line.unitType === 'piece' ? Math.floor(current.selling_price_paise / current.pieces_per_pack) : current.selling_price_paise
        if (line.productName !== current.name || line.sellingUnitPaise !== expectedPrice || line.packSnapshot.pack !== (current.pack ?? '') || line.packSnapshot.company !== (current.company ?? '') || line.packSnapshot.piecesPerPack !== (current.pieces_per_pack ?? 1) || line.packSnapshot.allowLooseSale !== Number(current.allow_loose_sale ?? 0)) fail(409, 'catalogue_conflict', 'Transferred product names, units or selling snapshots changed. Review both versions.')
      }
    }
  } else if (operation.catalogue?.length) fail(400, 'invalid_operation', 'This operation does not accept catalogue changes.')
  const transaction = operationDb(db, operation, scope, fingerprint, requestId, expectedRevision, handover)
  const common = { seasonId: scope.seasonId, context, actorRole: scope.effectiveRole, actorEmail: options.email, adjustedByEmail: options.email,
    offlineFamilyPacks:operation.lineSnapshots&&(!handover||handover.envelope.payload.v===2)?offlinePacks:undefined }
  let result
  try {
    if (operation.kind === 'CREATE') result = await checkoutQuickBill(transaction.db, validated.data, { ...common, createdByEmail: options.email, adminRole: scope.effectiveRole,
      pricingMode: validated.data.pricingMode, acceptedAmountPaise: validated.data.acceptedAmountPaise, idempotencyKey: 'offline-' + await offlineDigest(handover?.sourceOperationId ?? operation.operationId) })
    if (operation.kind === 'EDIT') result = await adjustPendingCustomerRequestBill(transaction.db, requestId, validated.data.items, { ...common, ...validated.data, requireRevision: true })
    if (operation.kind === 'CLOSE') result = await finalizeAdminCustomerRequest(transaction.db, requestId, common)
    if (operation.kind === 'AGREEMENT') result = await patchActiveQuotationCustomerAgreedAmount(transaction.db, requestId, operation.body.acceptedAmountPaise, scope.seasonId, context)
    if (operation.kind === 'PAYMENT') {
      if (operation.body.operationId && operation.body.operationId !== operation.operationId || operation.body.recordingMode !== 'OFFLINE' || operation.body.occurredAt && operation.body.occurredAt !== operation.occurredAt) fail(400, 'invalid_payment', 'Offline payment identity, recording mode and occurrence time must match the envelope.')
      result = await recordRequestPayment(transaction.db, requestId, { ...operation.body, operationId: operation.operationId, occurredAt: operation.occurredAt }, common)
    }
  } catch (error) { result = { ok: false, status: error.status ?? 503, error: error.code ?? 'sync_not_confirmed', message: error.status ? error.message : 'Synchronization was not confirmed. Retry unchanged input.' } }
  const saved = await receipt(db, operation.operationId, scope, operation.scope.deviceId)
  if (saved) {
    if (saved.fingerprint !== fingerprint) fail(409, 'operation_conflict', 'This operation ID belongs to different input.')
    return acknowledgement(saved, Boolean(result?.idempotentReplay || !result?.ok))
  }
  const error = transaction.error()
  if (String(error?.message).includes('handover_authority_changed')) fail(403, 'forbidden', 'Handover authority changed before commit. Pending work remains preserved.')
  if (/UNIQUE constraint failed: request_handover_claims/.test(String(error?.message))) fail(409, 'handover_claim_conflict', 'Another device accepted this request first. Preserve and explicitly review both versions.')
  if (String(error?.message).includes('offline_authority_changed')) fail(403, 'forbidden', 'Device, membership or role changed before commit.')
  if (String(error?.message).includes('NOT NULL constraint failed: customer_requests.status')) fail(409, 'revision_or_catalogue_conflict', 'The request or catalogue changed during synchronization. Review both versions.')
  if (String(error?.message).includes('UNIQUE constraint failed: offline_sync_receipts')) fail(409, 'operation_conflict', 'This operation ID is already in use.')
  if (result?.ok) fail(409, 'unacknowledged_operation', 'No new atomic change was committed. Review the server version before continuing.')
  return { ...result, error: result?.error ?? result?.code ?? 'sync_failed', status: result?.status ?? 503 }
}
