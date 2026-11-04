import { adminOperationScope } from '../lib/adminOperationScope.js'
import { canonicalJson, digest, publicJwk, sign, validatePublicKey, verifyTransfer, transferScope, transferCustomer, offlineRequestId } from '../../../src/shared/handoverProtocol.js'

const fail = (status, code, message) => { throw Object.assign(Error(message), { status, code }) }
export async function handoverRoot(env) {
  try {
    const jwk = JSON.parse(env.HANDOVER_SIGNING_JWK)
    const rootKey = publicJwk(jwk)
    const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    return { rootKey, privateKey }
  } catch { fail(503, 'handover_not_configured', 'Secure QR handover is not configured. Existing offline billing remains available.') }
}
const scopeValues = scope => [scope.businessId, scope.locationId, scope.seasonId]
export async function handoverMember(db, scope, userId) {
  return db.prepare(`SELECT u.id,u.email,u.display_name,
    CASE WHEN sm.role = 'admin' OR lm.role = 'admin' THEN 'admin'
      WHEN sm.role = 'super_admin' OR lm.role = 'super_admin' THEN 'super_admin' ELSE 'owner' END role
    FROM admin_users u JOIN season_members sm ON sm.admin_user_id = u.id
    JOIN location_members lm ON lm.admin_user_id = u.id AND lm.season_id = sm.season_id
    WHERE u.id = ? AND sm.season_id = ? AND lm.location_id = ?
      AND (u.disabled_at IS NULL OR u.disabled_at = '') AND (sm.disabled_at IS NULL OR sm.disabled_at = '') AND (lm.disabled_at IS NULL OR lm.disabled_at = '')
      AND sm.role IN ('admin','owner','super_admin') AND lm.role IN ('admin','owner','super_admin')`)
    .bind(userId, scope.seasonId, scope.locationId).first()
}
export async function prepareHandover(db, body, options, env) {
  const scope = adminOperationScope(db, options.seasonId, options.context, true)
  if (!scope.locationId) fail(403, 'location_required', 'Select an authorized stall.')
  const { rootKey, privateKey } = await handoverRoot(env)
  if (!body || Object.keys(body).some(key => !['publicKey','deviceId','deviceToken'].includes(key))) fail(400, 'invalid_device', 'Invalid signing device.')
  validatePublicKey(body.publicKey)
  const device = await db.prepare(`SELECT * FROM offline_sync_devices WHERE business_id = ? AND location_id = ? AND season_id = ? AND user_id = ? AND device_id = ?`).bind(...scopeValues(scope), scope.userId, body.deviceId).first()
  if (!device || device.disabled_at || device.token_hash !== await digest(body.deviceToken)) fail(403, 'device_denied', 'Register this device before preparing QR handover.')
  await db.prepare(`INSERT INTO handover_device_keys(business_id,location_id,season_id,user_id,device_id,public_key_json) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(...scopeValues(scope), scope.userId, body.deviceId, canonicalJson(body.publicKey)).run()
  const registered = await db.prepare(`SELECT public_key_json FROM handover_device_keys WHERE business_id = ? AND location_id = ? AND season_id = ? AND user_id = ? AND device_id = ?`).bind(...scopeValues(scope), scope.userId, body.deviceId).first()
  if (registered.public_key_json !== canonicalJson(body.publicKey)) fail(409, 'signing_key_conflict', 'This device already has a different signing key. Keep pending work and contact the operator.')
  const issued = Date.now()
  const claims = { v: 1, scope: transferScope(scope), userId: scope.userId, deviceId: body.deviceId, role: scope.effectiveRole, publicKey: body.publicKey, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 7 * 86400000).toISOString() }
  const users = await db.prepare(`SELECT DISTINCT admin_user_id FROM location_members WHERE location_id = ? AND season_id = ?`).bind(scope.locationId, scope.seasonId).all()
  const recipients = []
  for (const user of users.results) { const member = await handoverMember(db, scope, user.admin_user_id); if (member && ['owner','super_admin'].includes(member.role)) recipients.push({ userId: member.id, name: member.display_name, role: member.role }) }
  let privateCatalogue = []
  if (['owner','super_admin'].includes(scope.effectiveRole)) {
    const result = await db.prepare(`SELECT p.id,p.final_price_paise,pr.unit_rate_paise purchase_unit_paise FROM products p
      LEFT JOIN product_purchase_rates pr ON pr.product_id = p.id AND pr.location_id = p.location_id AND pr.effective_to IS NULL
      WHERE p.location_id = ? ORDER BY p.id LIMIT 5001`).bind(scope.locationId).all()
    if (result.results.length > 5000) fail(409, 'catalogue_too_large', 'Privileged offline snapshot exceeds the limit.')
    privateCatalogue = result.results
  }
  return { ok: true, rootKey, certificate: { claims, signature: await sign(claims, privateKey) }, recipients, privateCatalogue, preparedAt: claims.issuedAt }
}

export async function resolveHandover(db, envelope, scope, options, env) {
  if (!['owner','super_admin'].includes(scope.effectiveRole)) fail(403, 'forbidden', 'Only Owner or Super Admin can accept a handover.')
  const { rootKey } = await handoverRoot(env)
  // A previously accepted transfer may sync after expiry. Live registry,
  // membership and transactional authority checks below still apply.
  await verifyTransfer(envelope, { rootKey, scope, recipientUserId: scope.userId, allowExpired:true })
  const { payload, certificate } = envelope, signer = certificate.claims
  const member = await handoverMember(db, scope, signer.userId)
  if (!member || member.role !== signer.role) fail(403, 'sender_denied', 'The original creator no longer has the certified role at this stall.')
  const key = await db.prepare(`SELECT k.public_key_json FROM handover_device_keys k JOIN offline_sync_devices d
    ON d.business_id=k.business_id AND d.location_id=k.location_id AND d.season_id=k.season_id AND d.user_id=k.user_id AND d.device_id=k.device_id
    WHERE k.business_id=? AND k.location_id=? AND k.season_id=? AND k.user_id=? AND k.device_id=? AND d.disabled_at IS NULL`).bind(...scopeValues(scope), signer.userId, signer.deviceId).first()
  if (!key || key.public_key_json !== canonicalJson(signer.publicKey)) fail(403, 'sender_device_denied', 'The sending device key is not currently authorized.')
  const claim = await db.prepare('SELECT transfer_id FROM request_handover_claims WHERE transfer_id = ? OR request_id = ?').bind(payload.transferId, payload.requestId).first()
  if (claim) fail(409, 'handover_claim_conflict', 'Another acceptance already owns the server claim. Both local versions must be reviewed; no pending work was removed.')
  const request = await db.prepare('SELECT id,revision,status,creator_user_id,customer_name,customer_phone,customer_area,customer_note,pickup_preference,delivery_address,delivery_landmark,delivery_maps_url FROM customer_requests WHERE id = ? AND location_id = ? AND season_id = ?').bind(payload.requestId, scope.locationId, scope.seasonId).first()
  let expectedRevision = payload.revision
  if (payload.revision === null) {
    if (await offlineRequestId(scope, payload.sourceOperationId) !== payload.requestId) fail(400, 'request_identity_mismatch', 'Offline source request identity does not match its operation.')
    if (request) {
      const source = await db.prepare(`SELECT revision FROM offline_sync_receipts WHERE operation_id=? AND request_id=? AND business_id=? AND location_id=? AND season_id=? AND user_id=? AND device_id=? AND operation_type='CREATE'`).bind(payload.sourceOperationId, payload.requestId, ...scopeValues(scope), signer.userId, signer.deviceId).first()
      if (!source) fail(409, 'source_conflict', 'A different request already uses this source identity.')
      expectedRevision = source.revision
    }
  } else if (!request) fail(409, 'source_pending', 'The source request must synchronize before accepting this revision.')
  if (request && (request.revision !== expectedRevision || request.creator_user_id !== signer.userId || ['closed','void'].includes(request.status))) fail(409, 'revision_conflict', 'The source request changed or was finalized. Review the preserved local and server versions.')
  if (request) {
    const customer={name:request.customer_name,mobile:request.customer_phone,area:request.customer_area,note:request.customer_note,pickupPreference:request.pickup_preference,deliveryAddress:request.delivery_address,deliveryLandmark:request.delivery_landmark,deliveryMapsUrl:request.delivery_maps_url}
    if(canonicalJson(transferCustomer(customer))!==canonicalJson(transferCustomer(payload.customer)))fail(409,'customer_snapshot_conflict','Customer details differ from the source request. Save a fresh snapshot before transfer.')
    const result = await db.prepare('SELECT line_id,product_id,family_pack_id,unit_type FROM customer_request_items WHERE request_id = ?').bind(request.id).all()
    if(payload.v===1&&result.results.some(row=>row.family_pack_id))fail(409,'family_pack_snapshot_required','This request contains Family Packs. A complete version 2 handover is required; no partial product-only handover was applied.')
    for (const line of payload.lines) {
      const prior = result.results.find(row=>(line.familyPackId?row.family_pack_id===line.familyPackId:row.product_id===line.productId)&&(row.unit_type??'box')===line.unitType)
      if (prior && prior.line_id!==line.lineId) fail(409,'line_identity_conflict','Stable request line identities changed. Save a fresh source snapshot before transfer.')
    }
  }
  const items = payload.lines.map(line => line.familyPackId?{familyPackId:line.familyPackId,quantity:line.quantity}:{productId: line.productId, quantity: line.quantity, unitType: line.unitType})
  return { kind: request ? 'EDIT' : 'CREATE', requestId: request?.id, expectedRevision,
    sourceOperationId: payload.sourceOperationId, envelope, creator: { userId: member.id, name: member.display_name, role: member.role,deviceId:signer.deviceId,occurredAt:payload.sourceOccurredAt },
    lines: payload.lines, body: request ? { items } : { customer: payload.customer, items, pricingMode: 'selling' } }
}

export function handoverClaimStatements(db, handover, operation, scope, requestId) {
  const { payload, certificate } = handover.envelope
  return [db.prepare(`INSERT INTO request_handover_claims(transfer_id,request_id,operation_id,business_id,location_id,season_id,
    initiator_user_id,initiator_role,initiator_device_id,recipient_user_id,recipient_role,recipient_device_id,source_revision,occurred_at,signed_transfer_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(payload.transferId,requestId,operation.operationId,...scopeValues(scope),certificate.claims.userId,
      handover.creator.role,certificate.claims.deviceId,scope.userId,scope.effectiveRole,operation.scope.deviceId,
      handover.expectedRevision,operation.occurredAt,canonicalJson(handover.envelope))]
}
