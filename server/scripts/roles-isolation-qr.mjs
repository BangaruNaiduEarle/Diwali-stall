import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { publicJwk, sign, verifyTransfer, offlineRequestId, transferScope } from '../../src/shared/handoverProtocol.js'
import { sellingLines } from '../../src/admin/offline/handover.js'

const root = path.resolve(process.argv[2]), { directory } = JSON.parse(await readFile(path.join(root, 'phase3-current.json'), 'utf8'))
assert.ok(directory.startsWith(root + path.sep))
const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'))
const p2 = JSON.parse(await readFile(path.join(state.p2, 'state.json'), 'utf8'))
const base = 'http://localhost:8793', requests = [], results = []
async function api(actor, route, { method = 'GET', body, location = state.a, season = state.season } = {}) {
  const response = await fetch(base + route, { method, headers: { Cookie: actor.cookie ?? '', Origin: base, 'Content-Type': 'application/json', 'X-Admin-Location-Id': location, 'X-Admin-Season-Id': season }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  requests.push({ actor: actor.id, route, method, location, season, status: response.status, error: data.error })
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
const okay = r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data }
async function check(id, name, run) { try { const evidence = await run(); results.push({ id, name, status: 'PASS', evidence }); console.log('PASS ' + id) } catch (error) { results.push({ id, name, status: 'FAIL', error: error.stack }); console.log('FAIL ' + id + ' ' + error.message) } }
async function device(actor) {
  const deviceId = crypto.randomUUID(), deviceToken = crypto.randomUUID().replaceAll('-', '').repeat(2)
  const session = okay(await api(actor, '/api/admin/session'))
  okay(await api(actor, '/api/admin/offline/devices', { method: 'POST', body: { deviceId, deviceToken } }))
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign','verify'])
  const preparation = okay(await api(actor, '/api/admin/offline/handover/prepare', { method: 'POST', body: { deviceId, deviceToken, publicKey: publicJwk(await crypto.subtle.exportKey('jwk', pair.publicKey)) } }))
  const catalogue = okay(await api(actor, '/api/admin/offline/catalogue'))
  return { actor, pair, preparation, catalogue, deviceToken, role: session.effectiveRole, scope: { businessId: state.business, locationId: state.a, seasonId: state.season, userId: actor.id, deviceId } }
}
async function transfer(sender, receiver) {
  const sourceOperationId = crypto.randomUUID(), occurredAt = new Date().toISOString()
  const payload = { v: 1, transferId: crypto.randomUUID(), scope: transferScope(sender.scope), requestId: await offlineRequestId(sender.scope, sourceOperationId), revision: null, sourceOperationId, creatorUserId: sender.actor.id, recipientUserId: receiver.actor.id, occurredAt, sourceOccurredAt: occurredAt, customer: { name: 'Phase 3 recipient authorization', mobile: '9876543210' }, lines: sellingLines([{ productId: state.products.a, quantity: 1, unitType: 'box' }], sender.catalogue.products, crypto.randomUUID()) }
  const envelope = { payload, certificate: sender.preparation.certificate, signature: await sign(payload, sender.pair.privateKey) }
  await verifyTransfer(envelope, { rootKey: sender.preparation.rootKey, scope: payload.scope, recipientUserId: receiver.actor.id })
  return envelope
}
async function accept(receiver, envelope) { return api(receiver.actor, '/api/admin/offline/sync', { method: 'POST', body: { operationId: crypto.randomUUID(), kind: 'HANDOVER', body: { transfer: envelope }, requestId: envelope.payload.requestId, expectedRevision: null, scope: receiver.scope, deviceToken: receiver.deviceToken, capturedRole: receiver.role, occurredAt: new Date().toISOString(), catalogue: receiver.catalogue.products } }) }
for (const actor of Object.values(state.actors).filter(actor => !actor.id.endsWith('-subject'))) {
  const login = await api(actor, '/api/admin/auth/login', { method: 'POST', body: { email: actor.email, password: actor.password } }); okay(login); actor.cookie = login.cookie
}
const sender = await device(state.actors.sender), recipient = await device(state.actors.recipient), controller = await device(state.actors.controller)
await check('P3-QR-01', 'Signature-valid transfer is recipient-bound even for another authorized Owner', async () => {
  const envelope = await transfer(sender, recipient)
  assert.ok(sender.preparation.recipients.some(row => row.userId === recipient.actor.id))
  assert.ok(!sender.preparation.recipients.some(row => row.userId === sender.actor.id))
  const wrong = await accept(controller, envelope)
  assert.equal(wrong.status, 400)
  const right = okay(await accept(recipient, envelope))
  return { signatureVerified: true, wrongOwner: { status: wrong.status, error: wrong.data.error }, intendedRecipient: { status: 200, requestId: right.requestId }, adminExcludedFromRecipients: true }
})
await check('P3-QR-02', 'Current sender membership and recipient role override prepared certificates', async () => {
  const removedSenderEnvelope = await transfer(sender, recipient)
  okay(await api(controller.actor, '/api/admin/users/' + sender.actor.id, { method: 'DELETE' }))
  const revoked = await accept(recipient, removedSenderEnvelope)
  assert.equal(revoked.status, 403); assert.equal(revoked.data.error, 'sender_denied')
  const demotedRecipientEnvelope = await transfer(controller, recipient)
  okay(await api(controller.actor, '/api/admin/users/' + recipient.actor.id + '/role', { method: 'POST', body: { role: 'admin' } }))
  const demoted = await accept(recipient, demotedRecipientEnvelope)
  assert.equal(demoted.status, 403)
  return { signatureVerifiedBeforeChanges: true, removedSender: { status: revoked.status, error: revoked.data.error }, demotedRecipient: { status: demoted.status, error: demoted.data.error }, capturedRecipientRole: recipient.role }
})
await check('P3-HISTORY-01', 'Active membership grants no historical membership or mismatched stall-season context', async () => {
  const noHistorical = await api(controller.actor, '/api/admin/customer-requests/' + p2.historicalRequest, { location: state.historicalLocation, season: state.historical })
  assert.equal(noHistorical.status, 403)
  for (const location of [state.a,state.b]) assert.equal((await api(controller.actor, '/api/admin/offline/catalogue', { location, season: state.historical })).status, 403)
  return { historicalRequestWithoutMembership: noHistorical.status, activeStallsUnderArchivedSeason: { A: 403, B: 403 } }
})
const output = path.join(directory, 'qr-history-' + Date.now() + '.json')
await writeFile(output, JSON.stringify({ results, requests }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ output, pass: results.filter(row => row.status === 'PASS').length, fail: results.filter(row => row.status === 'FAIL').length }))
if (results.some(row => row.status === 'FAIL')) process.exitCode = 1
