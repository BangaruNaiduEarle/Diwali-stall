// Shared browser/Worker wire format. Only explicit selling/customer fields cross QR.
import { validateFamilyPackSnapshot, verifyFamilyPackSnapshot } from './familyPackSnapshot.js'
export const HANDOVER_VERSION = 1
export const MAX_TRANSFER_BYTES = 65536
const encoder = new TextEncoder()
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const bad = message => { throw Object.assign(Error(message), { status: 400, code: 'invalid_transfer' }) }
const keys = (value, allowed) => { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(value, key))) bad('Unsupported or incomplete QR structure.') }
const text = (value, limit = 128) => typeof value === 'string' && value.length > 0 && value.length <= limit && !Array.from(value).some(ch=>ch.charCodeAt(0)<32)
const identifier = (value,limit=128) => text(value,limit) && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value)
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
export const canonicalJson = value => JSON.stringify(sort(value))
function sort(value) { return Array.isArray(value) ? value.map(sort) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value }
export function base64url(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') }
export function unbase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 100000) bad('Invalid transfer encoding.')
  try { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0)) } catch { bad('Invalid transfer encoding.') }
}
export async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalJson(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('') }
export async function offlineRequestId(scope, operationId) {
  const hex = (await digest(['admin-quick-bill-v1', scope.locationId, scope.seasonId, 'offline-' + await digest(operationId)])).slice(0, 32).split('')
  hex[12] = '4'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16)
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}
export async function sign(value, key) { return base64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(canonicalJson(value)))) }
export function validatePublicKey(jwk) {
  keys(jwk, ['kty', 'crv', 'x', 'y'])
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !/^[\w-]{43}$/.test(jwk.x) || !/^[\w-]{43}$/.test(jwk.y)) bad('Only public P-256 verification keys are supported.')
}
export function publicJwk(jwk) { const value = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }; validatePublicKey(value); return value }
export async function verify(value, signature, jwk) {
  validatePublicKey(jwk)
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unbase64url(signature), encoder.encode(canonicalJson(value)))) bad('QR signature verification failed. Do not accept this transfer.')
}
export function validateScope(scope) {
  keys(scope, ['businessId', 'locationId', 'seasonId'])
  if (Object.values(scope).some(value => !identifier(value))) bad('Invalid QR business/stall/season scope.')
}
export const transferScope = scope => ({ businessId: scope.businessId, locationId: scope.locationId, seasonId: scope.seasonId })
export const CUSTOMER_FIELDS = {name:80,mobile:10,area:120,pickupPreference:40,note:300,deliveryAddress:240,deliveryLandmark:120,deliveryMapsUrl:500}
export function transferCustomer(customer) { return Object.fromEntries(Object.keys(CUSTOMER_FIELDS).map(key=>[key,customer[key]??''])) }
export function validatePayload(payload) {
  keys(payload, ['v', 'transferId', 'scope', 'requestId', 'revision', 'sourceOperationId', 'creatorUserId', 'recipientUserId', 'occurredAt', 'sourceOccurredAt', 'customer', 'lines'])
  if (![HANDOVER_VERSION,2].includes(payload.v)) bad('Unsupported QR version. Update both devices online.')
  validateScope(payload.scope)
  if (![payload.transferId, payload.requestId, payload.creatorUserId, payload.recipientUserId].every(value=>identifier(value)) || !/^[A-Za-z0-9_-]{8,128}$/.test(payload.transferId) || !date(payload.occurredAt) || !date(payload.sourceOccurredAt) || Date.parse(payload.sourceOccurredAt)>Date.parse(payload.occurredAt)) bad('Invalid transfer identity or time.')
  if (payload.revision === null ? !identifier(payload.sourceOperationId) : !Number.isSafeInteger(payload.revision) || payload.revision < 0 || payload.sourceOperationId !== null) bad('Invalid source request revision.')
  if (!object(payload.customer) || Object.keys(payload.customer).some(key=>!Object.hasOwn(CUSTOMER_FIELDS,key)) || Object.entries(payload.customer).some(([key,value])=>typeof value!=='string'||value.length>CUSTOMER_FIELDS[key])) bad('Invalid customer details in QR.')
  if (!text(payload.customer.name,80) || payload.customer.name.trim().length<2 || !/^\d{10}$/.test(payload.customer.mobile)) bad('Customer name and a 10-digit mobile are required.')
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 50) bad('QR requests support 1–50 complete lines; split larger requests explicitly.')
  const ids = new Set(), products = new Set()
  for (const line of payload.lines) {
    if(payload.v===2 && line?.familyPackId){
      keys(line,['lineId','familyPackId','productName','quantity','unitType','packSnapshot','sellingUnitPaise'])
      validateFamilyPackSnapshot(line.packSnapshot)
      const pack=line.packSnapshot
      if(!identifier(line.lineId,256)||line.familyPackId!==pack.familyPackId||line.productName!==pack.name||line.sellingUnitPaise!==pack.sellingUnitPaise||line.unitType!=='box'||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>99||pack.locationId!==payload.scope.locationId)bad('Invalid Family Pack line or scope.')
      const packKey='family:'+line.familyPackId
      if(ids.has(line.lineId)||products.has(packKey))bad('Duplicate line identity in QR.')
      ids.add(line.lineId);products.add(packKey);continue
    }
    keys(line, ['lineId', 'productId', 'productName', 'quantity', 'unitType', 'packSnapshot', 'sellingUnitPaise'])
    keys(line.packSnapshot, ['pack', 'company', 'piecesPerPack', 'allowLooseSale'])
    const pack = line.packSnapshot
    if (!identifier(line.lineId,256) || !identifier(line.productId) || !text(line.productName, 300) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99 || !['box', 'piece'].includes(line.unitType) || !Number.isSafeInteger(line.sellingUnitPaise) || line.sellingUnitPaise <= 0 ||
      typeof pack.pack !== 'string' || pack.pack.length > 300 || typeof pack.company !== 'string' || pack.company.length > 300 || !Number.isInteger(pack.piecesPerPack) || pack.piecesPerPack < 1 || pack.piecesPerPack > 100000 || ![0, 1].includes(pack.allowLooseSale)) bad('Invalid product, quantity, unit or selling snapshot in QR.')
    const productKey = line.productId + ':' + line.unitType
    if (ids.has(line.lineId) || products.has(productKey)) bad('Duplicate line identity in QR.')
    ids.add(line.lineId); products.add(productKey)
  }
}
export async function verifyTransfer(envelope, { rootKey, scope, recipientUserId, now = Date.now(), allowExpired = false }) {
  keys(envelope, ['payload', 'certificate', 'signature'])
  if (encoder.encode(canonicalJson(envelope)).length > MAX_TRANSFER_BYTES) bad('Transfer is too large. No data was imported.')
  validatePayload(envelope.payload)
  keys(envelope.certificate, ['claims', 'signature'])
  const cert = envelope.certificate.claims, payload = envelope.payload
  keys(cert, ['v', 'scope', 'userId', 'deviceId', 'role', 'publicKey', 'issuedAt', 'expiresAt'])
  validateScope(cert.scope); validatePublicKey(cert.publicKey)
  if (cert.v !== 1 || !identifier(cert.userId) || !identifier(cert.deviceId) || !['admin', 'owner', 'super_admin'].includes(cert.role) || !date(cert.issuedAt) || !date(cert.expiresAt) ||
    Date.parse(cert.expiresAt) - Date.parse(cert.issuedAt) > 7 * 86400000 || Date.parse(cert.expiresAt) <= Date.parse(cert.issuedAt)) bad('Invalid device certificate.')
  await verify(cert, envelope.certificate.signature, rootKey)
  if (!allowExpired && now > Date.parse(cert.expiresAt) || now + 300000 < Date.parse(cert.issuedAt) || Date.parse(payload.occurredAt) < Date.parse(cert.issuedAt) || Date.parse(payload.occurredAt) > Date.parse(cert.expiresAt) || Date.parse(payload.occurredAt) > now + 300000) bad('QR preparation has expired or the device clock is incorrect. Refresh preparation online; keep pending work.')
  if (canonicalJson(transferScope(scope)) !== canonicalJson(payload.scope) || canonicalJson(cert.scope) !== canonicalJson(payload.scope) || payload.recipientUserId !== recipientUserId) bad('QR is addressed to a different user, business, stall or season.')
  if (payload.creatorUserId !== cert.userId) bad('QR initiator must be the original request creator.')
  await verify(payload, envelope.signature, cert.publicKey)
  for(const line of payload.lines)if(line.familyPackId)await verifyFamilyPackSnapshot(line.packSnapshot)
  return envelope
}

export function encodeFrames(envelope) {
  validatePayload(envelope.payload)
  const bytes = encoder.encode(canonicalJson(envelope))
  if (bytes.length > MAX_TRANSFER_BYTES) bad('Request exceeds the safe transfer limit. No data was truncated.')
  const encoded = base64url(bytes), size = 900, total = Math.ceil(encoded.length / size)
  return Array.from({ length: total }, (_, index) => `DW7:${envelope.payload.transferId}:${index + 1}:${total}:${encoded.slice(index * size, (index + 1) * size)}`)
}
export function createFrameCollector() {
  let transferId = null, count = 0, parts = new Map(), started = 0
  return (frame, now = Date.now()) => {
    if (typeof frame !== 'string' || frame.length > 1200) bad('This is not a supported Diwali QR frame.')
    const match = /^DW7:([\w-]{8,128}):(\d{1,3}):(\d{1,3}):([A-Za-z0-9_-]{1,900})$/.exec(frame)
    if (!match) bad('This is not a supported Diwali QR frame.')
    const [, id, indexText, totalText, chunk] = match, index = Number(indexText), total = Number(totalText)
    if (total < 1 || total > 100 || index < 1 || index > total) bad('Invalid QR sequence length.')
    if (started && now - started > 10 * 60000) { parts = new Map(); transferId = null; started = 0 }
    if (transferId && (id !== transferId || count !== total)) bad('Another transfer is in progress. Reset the scanner before switching requests.')
    if (parts.has(index) && parts.get(index) !== chunk) bad('Conflicting QR frames. Reset and scan the original transfer.')
    transferId = id; count = total; started ||= now; parts.set(index, chunk)
    if (parts.size !== total) return { received: parts.size, total }
    try {
      const bytes = unbase64url(Array.from({ length: total }, (_, offset) => parts.get(offset + 1)).join(''))
      if (bytes.length > MAX_TRANSFER_BYTES) bad('Transfer exceeds the safe size limit.')
      const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      if (envelope?.payload?.transferId !== id) bad('Transfer frame identity mismatch.')
      return { received: total, total, envelope }
    } catch (error) { bad(error.code === 'invalid_transfer' ? error.message : 'QR data could not be decoded. Nothing was imported.') }
  }
}
