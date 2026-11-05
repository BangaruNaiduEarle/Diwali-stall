import { canonicalJson, digest, sign, verify, validatePublicKey, transferScope } from './handoverProtocol.js'

export const MAX_GRANT_MS = 24 * 60 * 60 * 1000
const denied = message => { throw Object.assign(Error(message), { status: 403, code: 'offline_grant_denied' }) }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
export function grantStatus(authorization, scope, now = Date.now(), finalize = false) {
  const claims = authorization?.grant?.claims
  if (!claims || claims.type !== 'diwali-offline-final-price' || claims.v !== 1) return 'No cached Owner authorization.'
  if (['businessId','locationId','seasonId'].some(key => claims.scope?.[key] !== scope?.[key]) || claims.userId !== scope?.userId || claims.deviceId !== scope?.deviceId) return 'Authorization belongs to another user, device or stall.'
  if (!(Date.parse(claims.issuedAt) <= now && now < Date.parse(claims.expiresAt))) return 'Owner authorization has expired or is not yet valid. Reconnect to refresh.'
  if (finalize && claims.canFinalize !== true) return 'This grant permits Final Price viewing only.'
  return null
}
export async function verifyOfflineGrant(authorization, scope, { now = Date.now(), finalize = false, prices = true } = {}) {
  if (!exact(authorization?.grant, ['claims','signature'])) denied('Invalid Owner authorization certificate.')
  const claims = authorization.grant.claims
  if (!exact(claims, ['v','type','grantId','scope','userId','deviceId','ownerUserId','publicKey','canFinalize','issuedAt','expiresAt','finalPricesDigest']) ||
      !exact(claims.scope, ['businessId','locationId','seasonId']) || typeof claims.canFinalize !== 'boolean' ||
      ![claims.grantId,claims.userId,claims.deviceId,claims.ownerUserId].every(value => typeof value === 'string' && /^[\w.:@-]{1,128}$/.test(value)) ||
      !/^[a-f0-9]{64}$/.test(claims.finalPricesDigest) ||
      ![claims.issuedAt,claims.expiresAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value) ||
      !(Date.parse(claims.expiresAt) > Date.parse(claims.issuedAt)) || Date.parse(claims.expiresAt) - Date.parse(claims.issuedAt) > MAX_GRANT_MS) denied('Invalid Owner authorization claims.')
  const error = grantStatus(authorization, scope, now, finalize)
  if (error) denied(error)
  validatePublicKey(claims.publicKey)
  await verify(claims, authorization.grant.signature, authorization.rootKey)
  if (prices) {
    if (!Array.isArray(authorization.finalPrices) || authorization.finalPrices.length > 5000 || authorization.finalPrices.some(row =>
      !exact(row, ['productId','finalPricePaise']) || typeof row.productId !== 'string' || !(row.finalPricePaise === null || Number.isSafeInteger(row.finalPricePaise) && row.finalPricePaise >= 0)) ||
      new Set(authorization.finalPrices.map(row => row.productId)).size !== authorization.finalPrices.length ||
      await digest(authorization.finalPrices) !== claims.finalPricesDigest) denied('The cached Final Price snapshot does not match its signed grant.')
  }
  return claims
}

// Proof covers the complete immutable operation, including its predecessor,
// amount, occurrence time and grant. Device bearer secrets are never signed.
export function grantOperationMessage(operation) {
  const { deviceToken, authorization, ...message } = operation
  void deviceToken
  return { ...message, authorization: { grant: authorization.grant } }
}
export async function signGrantedOperation(operation, authorization, identity) {
  const claims = await verifyOfflineGrant(authorization, operation.scope, { finalize: true })
  if (canonicalJson(identity.publicKey) !== canonicalJson(claims.publicKey)) denied('This device no longer has the authorized private key.')
  if (!['AGREEMENT','CLOSE'].includes(operation.kind)) denied('This grant cannot authorize this operation.')
  const signed = { ...operation, authorization: { grant: authorization.grant } }
  signed.authorization.proof = await sign(grantOperationMessage(signed), identity.privateKey)
  return signed
}
export const grantScope = scope => ({ ...transferScope(scope), userId: scope.userId, deviceId: scope.deviceId })
