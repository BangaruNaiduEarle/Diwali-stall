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
import { validatePayload, transferCustomer, canonicalJson } from '../../../src/shared/handoverProtocol.js'
import { offlineFamilyPackCatalogue, validateOfflineFamilyPacks, familyPackGuards } from './offlineFamilyPacks.js'
import { transferProductIds } from '../../../src/shared/familyPackSnapshot.js'
import { validateGrantedOperation, grantUseStatement } from './adminOfflineGrants.js'
import { authorizeOfflineFinalization, authorizeHandoverSource, hasHandoverSource } from '../lib/offlineFinalizationAuthority.js'
import { attachAdminRequestContext, getAdminContext } from '../middleware/requireAdmin.js'

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
  // Optional presentation data stays outside the strict selling snapshot contract.
  const photos = await db.prepare(`SELECT p.id,p.images_json FROM products p WHERE p.location_id = ?
    AND EXISTS (SELECT 1 FROM categories c WHERE c.slug = p.category_slug AND c.location_id = p.location_id)
    ORDER BY p.id LIMIT 5000`).bind(scope.locationId).all()
  const productImages = {}
  for (const row of photos.results) {
    try {
      const images = JSON.parse(row.images_json ?? '[]')
      if (Array.isArray(images) && typeof images[0] === 'string') productImages[row.id] = images[0]
    } catch { /* Missing/legacy photos do not make a selling catalogue unusable. */ }
  }
  return { ok: true, products: result.results, productImages, ...await offlineFamilyPackCatalogue(db,scope.locationId), capturedAt: new Date().toISOString(), scope }
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
  let delegated = false
  if (scope.effectiveRole === 'admin') {
    try { delegated = Boolean(await db.prepare(`SELECT 1 FROM offline_final_price_uses used JOIN offline_final_price_grants granted ON granted.id=used.grant_id
      WHERE used.request_id=? AND granted.business_id=? AND granted.location_id=? AND granted.season_id=? AND granted.user_id=? LIMIT 1`).bind(requestId,scope.businessId,scope.locationId,scope.seasonId,scope.userId).first()) }
    catch (error) { if (!/no such table: offline_final_price_/i.test(error.message)) throw error }
    if(!delegated){
      try{delegated=Boolean(await db.prepare('SELECT 1 FROM live_billing_finalization_permissions WHERE business_id=? AND location_id=? AND season_id=? AND user_id=?').bind(scope.businessId,scope.locationId,scope.seasonId,scope.userId).first())}
      catch(error){if(!/no such (?:table|view): live_billing_finalization_permissions/i.test(error.message))throw error}
    }
  }
  return { ok: true, request: safe, paymentSummary: summary,
    acceptedAmountPaise: canViewSensitiveProductPricing(scope.effectiveRole) || delegated ? quotation?.acceptedAmountPaise ?? null : null }
}

async function receipt(db, operationId, scope, deviceId) {
  return db.prepare(`SELECT * FROM offline_sync_receipts WHERE operation_id = ? AND ${deviceWhere}`).bind(operationId, ...values(scope), deviceId).first()
}
function acknowledgement(row, replay, operation) {
  const grant=operation?.authorization?.grant?.claims
  return { ok: true, operationId: row.operation_id, requestId: row.request_id, revision: row.revision, receivedAt: row.received_at, idempotentReplay: replay,
    ...(row.resolution_of?{resolutionOf:row.resolution_of}:{}),
    ...(grant?{delegation:{grantId:grant.grantId,ownerUserId:grant.ownerUserId,grantorUserId:grant.ownerUserId,actorUserId:row.user_id,actorRole:row.actor_role}}:{}) }
}

/** Wrap the RAW binding below the existing request scope wrapper. Only the one
 * business write batch receives a receipt; read batches remain untouched. */
function operationDb(raw, operation, scope, fingerprint, requestId, expectedRevision, handover, grant) {
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
      if(operation.kind==='PAYMENT')before.push(raw.prepare(`UPDATE customer_requests SET status=CASE WHEN NOT EXISTS
        (SELECT 1 FROM offline_sync_receipts WHERE resolution_of=? AND operation_type='PAYMENT') THEN status ELSE NULL END
        WHERE id=? AND location_id=? AND season_id=?`).bind(operation.operationId,requestId,scope.locationId,scope.seasonId))
      if(operation.kind==='PAYMENT'&&operation.resolutionOf)before.push(raw.prepare(`UPDATE customer_requests SET status=CASE WHEN NOT EXISTS
        (SELECT 1 FROM offline_sync_receipts WHERE operation_id=? OR (resolution_of=? AND operation_type='PAYMENT')) AND NOT EXISTS
        (SELECT 1 FROM request_payment_ledger WHERE operation_id=?) THEN status ELSE NULL END
        WHERE id=? AND location_id=? AND season_id=?`).bind(operation.resolutionOf,operation.resolutionOf,operation.resolutionOf,requestId,scope.locationId,scope.seasonId))
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
        const uses = grant ? [grantUseStatement(raw,operation,grant,requestId)] : []
        const result = await raw.batch([...uses, ...(requestId ? before : []), ...inserts, ...claims, save])
        committed = true
        const offset = (requestId ? before.length : 0) + uses.length
        return requestId ? result.slice(offset, -(1 + claims.length)) : [result[0], ...result.slice(1 + before.length, -(1 + claims.length))]
      } catch (error) { batchError = error; throw error }
    },
  }
  inheritAdminServiceMode(wrapped, raw)
  return { db: wrapped, error: () => batchError }
}

export async function synchronizeOfflineOperation(db, operation, options) {
  const scope = scopeFor(db, options, true)
  if (!object(operation) || Object.keys(operation).some(key => !['operationId','kind','scope','deviceToken','occurredAt','requestId','expectedRevision','parentOperationId','body','catalogue','resolutionOf','capturedRole','lineSnapshots','authorization'].includes(key)) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operation.operationId ?? '') || !['CREATE','EDIT','AGREEMENT','CLOSE','PAYMENT','HANDOVER'].includes(operation.kind) ||
      !object(operation.scope) || !object(operation.body) || typeof operation.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(operation.occurredAt) ||
      !Number.isFinite(Date.parse(operation.occurredAt)) || new Date(operation.occurredAt).toISOString() !== operation.occurredAt) fail(400, 'invalid_operation', 'Invalid offline operation envelope.')
  if (operation.capturedRole != null && !['admin','super_admin','owner'].includes(operation.capturedRole)) fail(400, 'invalid_operation', 'Invalid reported capture role.')
  if(['parentOperationId','resolutionOf'].some(key=>operation[key]!=null&&(typeof operation[key]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operation[key]))))fail(400,'invalid_operation','Invalid predecessor or reviewed operation identity.')
  validateOperationOwnership(scope, operation.scope)
  if (operation.scope.userId !== scope.userId) fail(403, 'user_mismatch', 'The offline operation belongs to another user.')
  if(hasHandoverSource(options.context,operation)){
    const registered=await db.prepare(`SELECT token_hash,disabled_at FROM offline_sync_devices WHERE ${deviceWhere}`).bind(...values(scope),operation.scope.deviceId).first()
    if(!registered||registered.disabled_at)fail(403,'sender_device_denied','The original signing device is no longer registered.')
    await validateDevice(db,scope,operation.scope.deviceId,registered.token_hash)
  }else{
    deviceInput({ deviceId: operation.scope.deviceId, deviceToken: operation.deviceToken })
    await validateDevice(db, scope, operation.scope.deviceId, await offlineDigest(operation.deviceToken))
  }
  const privileged = canViewSensitiveProductPricing(scope.effectiveRole)
  if (['PAYMENT','HANDOVER'].includes(operation.kind) && !privileged) fail(403, 'forbidden', 'Only Owner or Super Admin can accept handovers or record payments.')
  if (!privileged && ['AGREEMENT','CLOSE'].includes(operation.kind) && !operation.authorization) fail(403,'forbidden','Admin agreements and finalization require an Owner-issued device grant.')
  const fingerprint = await offlineDigest({ ...operation, deviceToken: undefined })
  const replay = await receipt(db, operation.operationId, scope, operation.scope.deviceId)
  if (replay) {
    if (replay.fingerprint !== fingerprint) fail(409, 'operation_conflict', 'This operation ID belongs to different offline input.')
    return acknowledgement(replay, true, operation)
  }
  if(operation.kind==='PAYMENT'&&operation.resolutionOf){
    const recovered=await db.prepare("SELECT 1 FROM offline_sync_receipts WHERE operation_id=? OR (resolution_of=? AND operation_type='PAYMENT') LIMIT 1").bind(operation.resolutionOf,operation.resolutionOf).first()
    const originalPayment=await db.prepare('SELECT 1 FROM request_payment_ledger WHERE operation_id=? LIMIT 1').bind(operation.resolutionOf).first()
    if(recovered||originalPayment)fail(409,'payment_recovery_conflict','The original payment or its reviewed replacement is already acknowledged. Refresh payments; do not record it again.')
  }
  let grant = null
  if (!privileged && ['AGREEMENT','CLOSE'].includes(operation.kind)) {
    if (!operation.authorization) fail(403,'forbidden','Admin agreements and finalization require a current Owner-issued device grant.')
    grant = await validateGrantedOperation(db,operation,scope,options.grantEnv ?? {})
  } else if (operation.authorization) fail(400,'invalid_operation','This operation does not accept an offline delegation.')
  let handover = null
  if (operation.kind === 'HANDOVER') {
    if (Object.keys(operation.body).some(key => key !== 'transfer') || operation.parentOperationId || operation.lineSnapshots || operation.requestId !== operation.body.transfer?.payload?.requestId || operation.expectedRevision !== operation.body.transfer?.payload?.revision) fail(400, 'invalid_transfer', 'Invalid handover operation envelope.')
    handover = await resolveHandover(db, operation.body.transfer, scope, options, options.handoverEnv ?? {})
    if(handover.kind==='FINALIZED')return synchronizeFinalizedHandover(db,operation,scope,fingerprint,handover,options)
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
  if (grant) authorizeOfflineFinalization(context,scope,operation.kind,grant.grantId)
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
  const transaction = operationDb(db, operation, scope, fingerprint, requestId, expectedRevision, handover, grant)
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
    return acknowledgement(saved, Boolean(result?.idempotentReplay || !result?.ok), operation)
  }
  const error = transaction.error()
  if (String(error?.message).includes('offline_grant_authority_changed') || grant && /offline_authority_changed|bill_purchase_cost_authority_changed/.test(String(error?.message))) fail(403,'offline_grant_denied','Owner authorization changed before commit. Pending work is preserved.')
  if (String(error?.message).includes('handover_authority_changed')) fail(403, 'forbidden', 'Handover authority changed before commit. Pending work remains preserved.')
  if (/UNIQUE constraint failed: request_handover_claims/.test(String(error?.message))) fail(409, 'handover_claim_conflict', 'Another device accepted this request first. Preserve and explicitly review both versions.')
  if (String(error?.message).includes('offline_authority_changed')) fail(403, 'forbidden', 'Device, membership or role changed before commit.')
  if (String(error?.message).includes('NOT NULL constraint failed: customer_requests.status')) fail(409, 'revision_or_catalogue_conflict', 'The request or catalogue changed during synchronization. Review both versions.')
  if (String(error?.message).includes('UNIQUE constraint failed: offline_sync_receipts')) fail(409, 'operation_conflict', 'This operation ID is already in use.')
  if (result?.ok) fail(409, 'unacknowledged_operation', 'No new atomic change was committed. Review the server version before continuing.')
  return { ...result, error: result?.error ?? result?.code ?? 'sync_failed', status: result?.status ?? 503 }
}

// Each source action has its own atomic receipt. A partial source-chain commit
// survives a connection failure and is resumed with identical IDs. Acceptance
// and its recipient receipt commit together only after the original CLOSE.
async function synchronizeFinalizedHandover(db,operation,scope,fingerprint,handover,options){
  await db.prepare('SELECT 1 FROM offline_final_price_devices LIMIT 1').bind().first()
  const payload=handover.envelope.payload, chain=payload.bill.operations
  const sourceRequest=new Request('http://localhost/internal-offline-handover',{headers:{'X-Admin-Location-Id':scope.locationId,'X-Admin-Season-Id':scope.seasonId}})
  const identity={userId:handover.creator.userId,email:handover.creator.email}
  const attached=await attachAdminRequestContext(sourceRequest,db,identity,{ADMIN_LOCATION_MODE:true})
  if(!attached.ok)fail(403,'sender_denied','The original creator is no longer authorized.')
  const context=getAdminContext(sourceRequest)
  authorizeHandoverSource(context,handover.creator.deviceId,chain.map(op=>op.operationId))
  let last
  for(const source of chain){
    try{last=await synchronizeOfflineOperation(db,source,{...options,context,email:identity.email})}
    catch(error){if(error.status===403&&error.code!=='offline_grant_denied')fail(403,'sender_denied',error.message);throw error}
    if(!last.ok)fail(last.status??409,last.status===403&&last.error!=='offline_grant_denied'?'sender_denied':last.error??'source_pending',last.message??'The original bill chain is not acknowledged yet.')
    if(last.requestId!==payload.requestId)fail(409,'source_conflict','A source operation belongs to a different request.')
  }
  const current=await db.prepare('SELECT revision,status,finalization_status,creator_user_id,customer_name,customer_phone,customer_area,customer_note,pickup_preference,delivery_address,delivery_landmark,delivery_maps_url FROM customer_requests WHERE id=? AND location_id=? AND season_id=?').bind(payload.requestId,scope.locationId,scope.seasonId).first()
  if(!current||current.revision!==last.revision||current.status!=='closed'||current.finalization_status!=='finalized'||current.creator_user_id!==handover.creator.userId)fail(409,'revision_conflict','The finalized bill changed before payment handoff. Review the server version; pending payments remain preserved.')
  const quotation=await getActiveQuotationForRequest(customerRequestDb(db,scope.seasonId,options.context),payload.requestId,scope.seasonId)
  if(quotation?.acceptedAmountPaise!==payload.bill.agreedAmountPaise)fail(409,'agreement_conflict','The saved server agreement differs from this finalized QR. Review the preserved bill before collecting replacement payments.')
  const normalizeCustomer=customer=>Object.fromEntries(Object.entries(transferCustomer(customer)).map(([key,value])=>[key,key==='mobile'?value.replace(/\D/g,''):value.trim()]))
  const serverCustomer={name:current.customer_name??'',mobile:current.customer_phone??'',area:current.customer_area??'',note:current.customer_note??'',pickupPreference:current.pickup_preference??'',deliveryAddress:current.delivery_address??'',deliveryLandmark:current.delivery_landmark??'',deliveryMapsUrl:current.delivery_maps_url??''}
  if(canonicalJson(normalizeCustomer(serverCustomer))!==canonicalJson(normalizeCustomer(payload.customer)))fail(409,'customer_snapshot_conflict','The finalized customer details differ from this signed bill.')
  const serverLines=(await db.prepare('SELECT i.line_id,i.product_id,i.family_pack_id,i.quantity,i.unit_type,i.unit_price_paise,i.pack_snapshot FROM customer_request_items i JOIN customer_requests r ON r.id=i.request_id WHERE r.id=? AND r.location_id=? AND r.season_id=? ORDER BY i.line_number').bind(payload.requestId,scope.locationId,scope.seasonId).all()).results
  const lastItems=chain.filter(op=>['CREATE','EDIT'].includes(op.kind)).at(-1).body.items
  const expectedLines=payload.lines.map(line=>{const input=lastItems.find(item=>line.familyPackId?item.familyPackId===line.familyPackId:item.productId===line.productId&&(item.unitType??'box')===line.unitType);return [line.lineId,line.productId??null,line.familyPackId??null,line.quantity,line.unitType,input?.unitRatePaise??line.sellingUnitPaise,line.packSnapshot]})
  const actualLines=serverLines.map(line=>[line.line_id,line.product_id,line.family_pack_id,line.quantity,line.unit_type??'box',line.unit_price_paise,line.pack_snapshot?JSON.parse(line.pack_snapshot):null])
  if(canonicalJson(expectedLines)!==canonicalJson(actualLines))fail(409,'line_snapshot_conflict','The finalized server items differ from this QR. Keep both versions and review before replacing payment captures.')
  handover.expectedRevision=current.revision
  const claims=handoverClaimStatements(db,handover,operation,scope,payload.requestId)
  const save=db.prepare(`INSERT INTO offline_sync_receipts(operation_id,fingerprint,business_id,location_id,season_id,user_id,device_id,actor_role,captured_role,operation_type,parent_operation_id,resolution_of,request_id,revision,occurred_at)
    VALUES(?,?,?,?,?,?,?,?,?,'EDIT',NULL,NULL,?,(SELECT revision FROM customer_requests WHERE id=?),?)`)
    .bind(operation.operationId,fingerprint,...values(scope),operation.scope.deviceId,scope.effectiveRole,operation.capturedRole??null,payload.requestId,payload.requestId,operation.occurredAt)
  try{
    await db.batch([db.prepare("UPDATE customer_requests SET status=CASE WHEN revision=? AND status='closed' AND finalization_status='finalized' THEN status ELSE NULL END WHERE id=? AND location_id=? AND season_id=?").bind(current.revision,payload.requestId,scope.locationId,scope.seasonId),...claims,save])
  }catch(error){
    const replay=await receipt(db,operation.operationId,scope,operation.scope.deviceId)
    if(replay&&replay.fingerprint===fingerprint)return acknowledgement(replay,true,operation)
    if(/handover_authority_changed|offline_authority_changed/.test(error.message))fail(403,'forbidden','Handoff authority changed before commit.')
    fail(409,'handover_claim_conflict','Another device changed or accepted this bill. Review preserved versions before recording replacement payments.')
  }
  return acknowledgement(await receipt(db,operation.operationId,scope,operation.scope.deviceId),false,operation)
}
