// Additional uncovered price and signed cross-season/business cases only.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { publicJwk, sign, verifyTransfer, offlineRequestId, transferScope } from '../../src/shared/handoverProtocol.js'
import { sellingLines } from '../../src/admin/offline/handover.js'

const root = path.resolve(process.argv[2] ?? '')
const { directory } = JSON.parse(await readFile(path.join(root, 'phase2-current.json'), 'utf8'))
assert.ok(directory.startsWith(root + path.sep))
const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'))
const base = 'http://localhost:8793', results = [], requests = []
async function api(actor, route, { location = actor.location, season = state.season, method = 'GET', body } = {}) {
  const response = await fetch(base + route, { method, headers: { Cookie: actor.cookie, Origin: base, 'Content-Type': 'application/json', 'X-Admin-Location-Id': location, 'X-Admin-Season-Id': season }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  requests.push({ actor: actor.id, route, method, location, season, status: response.status })
  return { status: response.status, data }
}
const okay = result => { assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result)); return result.data }
async function check(id, name, scenarios, modules, run) { try { const evidence = await run(); results.push({ id, name, scenarios, modules, status: 'PASS', evidence }); console.log('PASS ' + id) } catch (error) { results.push({ id, name, scenarios, modules, status: 'FAIL', error: error.message }); console.log('FAIL ' + id + ' ' + error.message) } }
await check('SUPPLEMENT-01', 'Purchase and X4 prices are independently scoped and hidden from B Admin', [4, 5, 8, 10], ['adminCatalogue', 'adminPurchaseRates', 'adminPrivateRates'], async () => {
  for (const [actor, location, product, purchase, x4] of [[state.actors.ownerA, state.a, state.products.a, 30, 110], [state.actors.ownerB, state.b, state.products.b, 80, 270]]) {
    for (const [kind, amount] of [['purchase-rate', purchase], ['private-rate', x4]]) {
      okay(await api(actor, `/api/admin/products/${product}/${kind}`, { location, method: 'PUT', body: { unitRateInr: amount } }))
      assert.equal(okay(await api(actor, `/api/admin/products/${product}/${kind}`, { location })).rate.unitRatePaise, amount * 100)
    }
  }
  for (const kind of ['purchase-rate', 'private-rate']) {
    assert.equal((await api(state.actors.ownerA, `/api/admin/products/${state.products.b}/${kind}`)).status, 404)
    assert.equal((await api(state.actors.ownerA, `/api/admin/products/${state.products.b}/${kind}`, { method: 'PUT', body: { unitRateInr: 1 } })).status, 404)
    assert.equal((await api(state.actors.dual, `/api/admin/products/${state.products.b}/${kind}`, { location: state.b })).status, 403)
    assert.equal((await api(state.actors.dual, `/api/admin/products/${state.products.b}/${kind}`, { location: state.b, method: 'PUT', body: { unitRateInr: 1 } })).status, 403)
  }
  for (const [actor, request, due] of [[state.actors.ownerA, state.requests.a, 10000], [state.actors.ownerB, state.requests.b, 25000]]) assert.equal(okay(await api(actor, `/api/admin/customer-requests/${request.requestId}/payments`)).summary.amountDuePaise, due)
  return { purchasePaise: { A: 3000, B: 8000 }, x4Paise: { A: 11000, B: 27000 }, frozenBillAmountsUnchanged: true }
})

async function device(actor, location, business) {
  const deviceId = crypto.randomUUID(), deviceToken = (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '')
  const session = okay(await api(actor, '/api/admin/session', { location }))
  okay(await api(actor, '/api/admin/offline/devices', { location, method: 'POST', body: { deviceId, deviceToken } }))
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  const preparation = okay(await api(actor, '/api/admin/offline/handover/prepare', { location, method: 'POST', body: { deviceId, deviceToken, publicKey: publicJwk(await crypto.subtle.exportKey('jwk', pair.publicKey)) } }))
  return { actor, pair, preparation, deviceToken, role: session.effectiveRole, scope: { businessId: business, locationId: location, seasonId: state.season, userId: actor.id, deviceId }, catalogue: okay(await api(actor, '/api/admin/offline/catalogue', { location })) }
}
await check('SUPPLEMENT-02', 'Valid signed transfer cannot cross businesses with the same recipient identity', [9], ['adminHandover', 'handoverProtocol', 'adminOfflineSync'], async () => {
  const sender = await device(state.actors.dual, state.c, state.otherBusiness)
  const receiver = await device(state.actors.dual, state.a, state.business)
  const sourceOperationId = crypto.randomUUID(), occurredAt = new Date().toISOString()
  const payload = { v: 1, transferId: crypto.randomUUID(), scope: transferScope(sender.scope), requestId: await offlineRequestId(sender.scope, sourceOperationId), revision: null, sourceOperationId, creatorUserId: sender.actor.id, recipientUserId: receiver.actor.id, occurredAt, sourceOccurredAt: occurredAt, customer: { name: 'Additional Scope Boundary', mobile: '9876543210' }, lines: sellingLines([{ productId: state.products.c, quantity: 1, unitType: 'box' }], sender.catalogue.products, crypto.randomUUID()) }
  const envelope = { payload, certificate: sender.preparation.certificate, signature: await sign(payload, sender.pair.privateKey) }
  await verifyTransfer(envelope, { rootKey: sender.preparation.rootKey, scope: payload.scope, recipientUserId: receiver.actor.id })
  const operation = dev => ({ operationId: crypto.randomUUID(), kind: 'HANDOVER', body: { transfer: envelope }, requestId: payload.requestId, expectedRevision: null, scope: dev.scope, deviceToken: dev.deviceToken, capturedRole: dev.role, occurredAt, catalogue: dev.catalogue.products })
  const crossBusiness = await api(receiver.actor, '/api/admin/offline/sync', { location: state.a, method: 'POST', body: operation(receiver) })
  assert.equal(crossBusiness.status, 400)
  const historical = operation(sender); historical.scope = { ...sender.scope, seasonId: state.historical }
  const crossSeason = await api(sender.actor, '/api/admin/offline/sync', { location: state.c, season: state.historical, method: 'POST', body: historical })
  assert.equal(crossSeason.status, 403)
  return { signatureVerified: true, sameRecipientIdentity: true, crossBusiness: { status: crossBusiness.status, error: crossBusiness.data.error }, samePermanentLocationArchivedSeason: { status: crossSeason.status, error: crossSeason.data.error } }
})
const output = path.join(directory, 'supplement-' + Date.now() + '.json')
await writeFile(output, JSON.stringify({ results, requests }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ output, pass: results.filter(x => x.status === 'PASS').length, fail: results.filter(x => x.status === 'FAIL').length }))
if (results.some(x => x.status === 'FAIL')) process.exitCode = 1
