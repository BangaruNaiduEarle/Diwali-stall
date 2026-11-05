import { adminOperationScope } from '../lib/adminOperationScope.js'
import { handoverMember, handoverRoot } from './adminHandover.js'
import { canonicalJson, digest, sign, verify, validatePublicKey, transferScope } from '../../../src/shared/handoverProtocol.js'
import { MAX_GRANT_MS, verifyOfflineGrant, grantOperationMessage } from '../../../src/shared/offlineGrant.js'

const fail = (status, code, message) => { throw Object.assign(Error(message), { status, code }) }
const tuple = scope => [scope.businessId,scope.locationId,scope.seasonId]
const where = 'business_id=? AND location_id=? AND season_id=? AND user_id=? AND device_id=?'
function scopeFor(db, options, owner = false) {
  const scope = adminOperationScope(db, options.seasonId, options.context, true)
  if (!scope.locationId || owner && scope.effectiveRole !== 'owner') fail(403, 'offline_grant_denied', 'Only the selected stall Owner can issue or revoke Admin offline authorization.')
  return scope
}
async function root(env) {
  try { return await handoverRoot({ HANDOVER_SIGNING_JWK: env.OFFLINE_GRANT_SIGNING_JWK || env.HANDOVER_SIGNING_JWK }) }
  catch { fail(503, 'offline_grant_not_configured', 'Offline authorization signing is not configured. Ordinary offline billing remains available.') }
}
export async function prepareOfflineAuthorization(db, body, options, env) {
  const scope = scopeFor(db, options)
  if (scope.effectiveRole !== 'admin') fail(403, 'offline_grant_denied', 'Device grants are for Admin members; Owners and Super Admins retain their existing authority.')
  if (!body || Object.keys(body).some(key => !['deviceId','deviceToken','publicKey'].includes(key))) fail(400, 'invalid_device', 'Provide the registered device and public key only.')
  validatePublicKey(body.publicKey)
  const device = await db.prepare(`SELECT token_hash,disabled_at FROM offline_sync_devices WHERE ${where}`).bind(...tuple(scope),scope.userId,body.deviceId).first()
  if (!device || device.disabled_at || device.token_hash !== await digest(body.deviceToken)) fail(403, 'device_denied', 'Prepare this device before requesting offline authorization.')
  const { rootKey } = await root(env)
  await db.prepare(`INSERT INTO offline_final_price_devices(business_id,location_id,season_id,user_id,device_id,public_key_json) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(...tuple(scope),scope.userId,body.deviceId,canonicalJson(body.publicKey)).run()
  const registered = await db.prepare(`SELECT public_key_json FROM offline_final_price_devices WHERE ${where}`).bind(...tuple(scope),scope.userId,body.deviceId).first()
  if (registered.public_key_json !== canonicalJson(body.publicKey)) fail(409, 'signing_key_conflict', 'This registered device has another key. Keep pending work; do not clear site data.')
  await prepareBillingPermissionGrant(db,scope,body.deviceId,env)
  const grant = await db.prepare(`SELECT * FROM live_offline_final_price_grants WHERE ${where} ORDER BY can_finalize DESC,issued_at DESC,id DESC LIMIT 1`).bind(...tuple(scope),scope.userId,body.deviceId).first()
  return { ok: true, registered: true, authorization: grant ? { rootKey, grant: JSON.parse(grant.certificate_json), finalPrices: JSON.parse(grant.final_prices_json) } : null }
}
export async function listOfflineAuthorizations(db, options) {
  const scope = scopeFor(db, options, true)
  const rows = await db.prepare(`SELECT k.user_id userId,k.device_id deviceId,u.display_name name,u.email,d.disabled_at disabledAt
    FROM offline_final_price_devices k JOIN offline_sync_devices d ON d.business_id=k.business_id AND d.location_id=k.location_id AND d.season_id=k.season_id AND d.user_id=k.user_id AND d.device_id=k.device_id
    JOIN admin_users u ON u.id=k.user_id WHERE k.business_id=? AND k.location_id=? AND k.season_id=? ORDER BY u.email,k.device_id LIMIT 501`).bind(...tuple(scope)).all()
  const devices = []
  if(rows.results.length>500)fail(409,'device_list_too_large','This stall has more than 500 registered authorization devices. No list was truncated; contact the operator.')
  for (const device of rows.results) {
    const member = await handoverMember(db,scope,device.userId)
    if (member?.role === 'admin' && !device.disabledAt) devices.push(device)
  }
  const grants = await db.prepare(`SELECT id,user_id userId,device_id deviceId,owner_user_id ownerUserId,can_finalize canFinalize,issued_at issuedAt,expires_at expiresAt,revoked_at revokedAt,
    (SELECT invalidated_at FROM offline_final_price_invalidations invalid WHERE invalid.grant_id=offline_final_price_grants.id) invalidatedAt
    FROM offline_final_price_grants WHERE business_id=? AND location_id=? AND season_id=? AND revoked_at IS NULL ORDER BY issued_at DESC,id DESC LIMIT 501`).bind(...tuple(scope)).all()
  if(grants.results.length>500)fail(409,'grant_list_too_large','This stall has more than 500 unrevoked device grants. No list was truncated; contact the operator.')
  return { ok:true, devices, grants:grants.results }
}
export async function issueOfflineAuthorization(db, body, options, env) {
  const scope = scopeFor(db, options, true)
  if (!body || Object.keys(body).some(key => !['grantId','userId','deviceId','canFinalize','hours'].includes(key)) ||
      typeof body.grantId !== 'string' || !/^[\w-]{8,128}$/.test(body.grantId) || ![body.userId,body.deviceId].every(value=>typeof value==='string' && /^[\w.:@-]{1,128}$/.test(value)) || typeof body.canFinalize !== 'boolean' || !Number.isInteger(body.hours) || body.hours < 1 || body.hours > 24) fail(400,'invalid_grant','Choose a registered Admin device, permission and duration from 1 to 24 hours.')
  const existing = await db.prepare('SELECT * FROM offline_final_price_grants WHERE id=?').bind(body.grantId).first()
  if (existing) {
    if (existing.business_id !== scope.businessId || existing.location_id !== scope.locationId || existing.season_id !== scope.seasonId || existing.owner_user_id !== scope.userId || existing.user_id !== body.userId || existing.device_id !== body.deviceId || existing.can_finalize !== Number(body.canFinalize) || Date.parse(existing.expires_at)-Date.parse(existing.issued_at) !== body.hours*3600000) fail(409,'grant_identity_conflict','This grant ID already belongs to different authorization input.')
    return { ok:true,grantId:existing.id,idempotentReplay:true,revokedAt:existing.revoked_at }
  }
  return createDeviceAuthorization(db,body,scope,env)
}
async function createDeviceAuthorization(db,body,scope,env,permissionId=null) {
  const member = await handoverMember(db, scope, body.userId)
  if (member?.role !== 'admin') fail(403,'offline_grant_denied','Select an enabled Admin in this stall and season.')
  const device = await db.prepare(`SELECT public_key_json FROM offline_final_price_devices WHERE ${where}`).bind(...tuple(scope),body.userId,body.deviceId).first()
  if (!device) fail(404,'device_not_prepared','The Admin must register their offline authorization key on that device first.')
  const { privateKey } = await root(env)
  const prices = await db.prepare('SELECT id productId,final_price_paise finalPricePaise FROM products WHERE location_id=? ORDER BY id LIMIT 5001').bind(scope.locationId).all()
  if (prices.results.length > 5000) fail(409,'catalogue_too_large','Final Price snapshot exceeds the offline limit.')
  if(prices.results.some(row=>row.finalPricePaise!==null&&(!Number.isSafeInteger(row.finalPricePaise)||row.finalPricePaise<0)))fail(409,'invalid_final_price_snapshot','A product has an invalid Final Price. Correct it online before issuing a signed snapshot.')
  // Use the same clock as commit-time SQLite expiry checks. Different Windows
  // clock resolutions must not make an immediately issued grant future-dated.
  const clock = await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now").bind().first()
  const issued = Date.parse(clock.now)
  const claims = { v:1,type:'diwali-offline-final-price',grantId:body.grantId,scope:transferScope(scope),userId:body.userId,deviceId:body.deviceId,ownerUserId:scope.userId,
    publicKey:JSON.parse(device.public_key_json),canFinalize:body.canFinalize,issuedAt:new Date(issued).toISOString(),expiresAt:new Date(issued+Math.min(MAX_GRANT_MS,body.hours*3600000)).toISOString(),finalPricesDigest:await digest(prices.results) }
  const grant = { claims,signature:await sign(claims,privateKey) }
  const insert=db.prepare(`INSERT INTO offline_final_price_grants(id,business_id,location_id,season_id,user_id,device_id,owner_user_id,can_finalize,issued_at,expires_at,certificate_json,final_prices_json${permissionId?',billing_permission_id':''}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?${permissionId?',?':''})`)
    .bind(body.grantId,...tuple(scope),body.userId,body.deviceId,scope.userId,Number(body.canFinalize),claims.issuedAt,claims.expiresAt,canonicalJson(grant),canonicalJson(prices.results),...(permissionId?[permissionId]:[]))
  // New per-Admin permission never replaces an independent Phase 2 device grant.
  await db.batch(permissionId?[insert]:[
    db.prepare(`UPDATE offline_final_price_grants SET revoked_at=?,revoked_by=? WHERE ${where} AND revoked_at IS NULL`).bind(claims.issuedAt,scope.userId,...tuple(scope),body.userId,body.deviceId),insert])
  return { ok:true,grantId:body.grantId,expiresAt:claims.expiresAt }
}
export async function revokeOfflineAuthorization(db, body, options) {
  const scope = scopeFor(db, options, true)
  if (!body || Object.keys(body).some(key => key !== 'grantId') || typeof body.grantId !== 'string') fail(400,'invalid_grant','Select the grant to revoke.')
  const result = await db.prepare(`UPDATE offline_final_price_grants SET revoked_at=?,revoked_by=? WHERE id=? AND business_id=? AND location_id=? AND season_id=? AND revoked_at IS NULL`).bind(new Date().toISOString(),scope.userId,body.grantId,...tuple(scope)).run()
  if (!result.meta?.changes) {
    const previous = await db.prepare('SELECT revoked_at FROM offline_final_price_grants WHERE id=? AND business_id=? AND location_id=? AND season_id=?').bind(body.grantId,...tuple(scope)).first()
    if (!previous?.revoked_at) fail(404,'not_found','Grant not found in this stall.')
  }
  return { ok:true,grantId:body.grantId }
}
export async function validateGrantedOperation(db, operation, scope, env) {
  if (!['AGREEMENT','CLOSE'].includes(operation.kind) || scope.effectiveRole !== 'admin' || !operation.authorization || Object.keys(operation.authorization).some(key => !['grant','proof'].includes(key))) fail(403,'offline_grant_denied','This grant cannot authorize that action.')
  const { rootKey } = await root(env)
  const claims = await verifyOfflineGrant({rootKey,grant:operation.authorization.grant},operation.scope,{finalize:true,prices:false})
  if (!(Date.parse(operation.occurredAt) >= Date.parse(claims.issuedAt) && Date.parse(operation.occurredAt) < Date.parse(claims.expiresAt)) || Date.parse(operation.occurredAt) > Date.now()+60000) fail(403,'offline_grant_denied','The capture time is outside the valid grant period.')
  const row = await db.prepare(`SELECT g.certificate_json,k.public_key_json FROM live_offline_final_price_grants g JOIN offline_final_price_devices k
    ON k.business_id=g.business_id AND k.location_id=g.location_id AND k.season_id=g.season_id AND k.user_id=g.user_id AND k.device_id=g.device_id
    WHERE g.id=? AND g.business_id=? AND g.location_id=? AND g.season_id=? AND g.user_id=? AND g.device_id=? AND g.can_finalize=1`).bind(claims.grantId,...tuple(scope),scope.userId,operation.scope.deviceId).first()
  if (!row || row.certificate_json !== canonicalJson(operation.authorization.grant) || row.public_key_json !== canonicalJson(claims.publicKey)) fail(403,'offline_grant_denied','Owner authorization expired, was revoked, or its memberships/device changed.')
  await verify(grantOperationMessage(operation),operation.authorization.proof,claims.publicKey)
  return claims
}
export function grantUseStatement(db, operation, claims, requestId) {
  return db.prepare('INSERT INTO offline_final_price_uses(operation_id,grant_id,request_id,kind,occurred_at,proof_json) VALUES(?,?,?,?,?,?)')
    .bind(operation.operationId,claims.grantId,requestId,operation.kind,operation.occurredAt,canonicalJson(operation.authorization))
}

function billingManager(db,options){
  const scope=scopeFor(db,options)
  if(!['owner','super_admin'].includes(scope.effectiveRole))fail(403,'forbidden','Owner or Super Admin authority in this stall is required.')
  return scope
}
export async function listBillingPermissions(db,options){
  const scope=billingManager(db,options)
  const result=await db.prepare(`SELECT id,user_id userId,grantor_user_id grantorUserId,granted_at grantedAt FROM live_billing_finalization_permissions WHERE business_id=? AND location_id=? AND season_id=?`).bind(...tuple(scope)).all()
  return {ok:true,permissions:result.results}
}
export async function setBillingPermission(db,body,options){
  const scope=billingManager(db,options)
  if(!body||Object.keys(body).some(key=>!['userId','enabled','operationId'].includes(key))||typeof body.enabled!=='boolean'||typeof body.userId!=='string'||!/^[-\w.:@]{1,128}$/.test(body.userId)||typeof body.operationId!=='string'||!/^[-\w]{8,128}$/.test(body.operationId))fail(400,'invalid_permission','Provide an Admin, enabled boolean and unique operation ID.')
  const member=await handoverMember(db,scope,body.userId)
  if(member?.role!=='admin')fail(403,'forbidden','Select an enabled Admin in this stall and season.')
  const prior=await db.prepare('SELECT * FROM billing_finalization_permissions WHERE id=? OR revoke_operation_id=?').bind(body.operationId,body.operationId).first()
  if(prior){
    if(prior.business_id!==scope.businessId||prior.location_id!==scope.locationId||prior.season_id!==scope.seasonId||prior.user_id!==body.userId||(body.enabled?prior.id!==body.operationId||prior.grantor_user_id!==scope.userId:prior.revoke_operation_id!==body.operationId||prior.revoked_by!==scope.userId))fail(409,'permission_identity_conflict','This operation ID belongs to another permission change.')
    return {ok:true,idempotentReplay:true}
  }
  if(body.enabled){
    const active=await db.prepare(`SELECT id FROM live_billing_finalization_permissions WHERE business_id=? AND location_id=? AND season_id=? AND user_id=?`).bind(...tuple(scope),body.userId).first()
    if(active)fail(409,'permission_changed','Billing Finalization is already enabled. Refresh before changing it; no new grant was recorded.')
    await db.prepare('INSERT INTO billing_finalization_permissions(id,business_id,location_id,season_id,user_id,grantor_user_id) VALUES(?,?,?,?,?,?)').bind(body.operationId,...tuple(scope),body.userId,scope.userId).run()
  }else{
    const revoked=await db.prepare(`UPDATE billing_finalization_permissions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revoked_by=?,revoke_operation_id=? WHERE business_id=? AND location_id=? AND season_id=? AND user_id=? AND revoked_at IS NULL`).bind(scope.userId,body.operationId,...tuple(scope),body.userId).run()
    if(revoked.meta?.changes!==1)fail(409,'permission_changed','Billing Finalization already changed. Refresh before trying again; no new revocation was recorded.')
  }
  return {ok:true}
}
async function prepareBillingPermissionGrant(db,scope,deviceId,env){
  let permission
  try{permission=await db.prepare(`SELECT * FROM live_billing_finalization_permissions WHERE business_id=? AND location_id=? AND season_id=? AND user_id=?`).bind(...tuple(scope),scope.userId).first()}
  catch(error){if(/no such (?:table|view): (?:live_)?billing_finalization_permissions/.test(error.message))return;throw error}
  if(!permission)return
  const existing=await db.prepare(`SELECT id FROM live_offline_final_price_grants WHERE billing_permission_id=? AND device_id=?`).bind(permission.id,deviceId).first()
  if(existing)return
  await createDeviceAuthorization(db,{grantId:crypto.randomUUID(),userId:scope.userId,deviceId,canFinalize:true,hours:8},{...scope,userId:permission.grantor_user_id},env,permission.id)
}
