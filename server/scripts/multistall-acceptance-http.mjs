import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { publicJwk, sign, offlineRequestId, transferScope } from '../../src/shared/handoverProtocol.js'
import { sellingLines } from '../../src/admin/offline/handover.js'

const root = path.resolve(process.argv[2] ?? '')
const { directory } = JSON.parse(await readFile(path.join(root, 'phase2-current.json'), 'utf8'))
assert.ok(directory.startsWith(root + path.sep))
const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'))
const { actors: u, a, c, season, historical, historicalLocation } = state
const base = 'http://localhost:8793', focus = new Set(process.argv.slice(3))
const previous = focus.size ? JSON.parse(await readFile(path.join(directory, 'http-results.json'), 'utf8')) : { results: [], requests: [] }
const results = previous.results.filter(row => !focus.has(row.id) && !row.id.startsWith('GAP-')), requests = previous.requests
async function api(actor, route, { method = 'GET', body, location = actor?.location, activeSeason = season, revision, headers = {} } = {}) {
  const response = await fetch(base + route, { method, headers: { ...(actor?.cookie ? { Cookie: actor.cookie } : {}), Origin: base, 'Content-Type': 'application/json', 'X-Admin-Season-Id': activeSeason, ...(location ? { 'X-Admin-Location-Id': location } : {}), ...(revision == null ? {} : { 'If-Match': String(revision) }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  let data; try { data = await response.json() } catch { data = { error: 'non_json' } }
  requests.push({ actor: actor?.id, route, method, location, season: activeSeason, status: response.status })
  return { status: response.status, data, headers: response.headers }
}
const okay = result => { assert.ok(result.status >= 200 && result.status < 300, JSON.stringify({ status: result.status, ...result.data })); return result.data }
const denied = result => assert.ok([400, 403, 404, 409].includes(result.status), JSON.stringify(result.data))
async function check(id, name, scenarios, modules, action) { if (focus.size && !focus.has(id)) return; try { const evidence = await action(); results.push({ id, name, scenarios, modules, status: 'PASS', evidence }); console.log('PASS ' + id + ' ' + name) } catch (error) { results.push({ id, name, scenarios, modules, status: 'FAIL', error: error.message }); console.log('FAIL ' + id + ' ' + error.message) } }
async function login(actor) { const r = await api(null, '/api/admin/auth/login', { method: 'POST', body: { email: actor.email, password: actor.password } }); okay(r); actor.cookie = r.headers.get('set-cookie').split(';')[0] }
const detail = async (actor, id, location = actor.location) => okay(await api(actor, '/api/admin/customer-requests/' + id, { location }))
async function checkout(actor, location, product, customer = 'Acceptance ' + location) { return okay(await api(actor, '/api/admin/quick-bill/checkout', { method: 'POST', location, body: { customer: { name: customer, mobile: '9876543210' }, items: [{ productId: product, quantity: 1, unitType: 'box' }], pricingMode: 'selling' }, headers: { 'Idempotency-Key': crypto.randomUUID() } })) }
async function bill(actor, location, product, amount) {
  const data = await checkout(actor, location, product), id = data.request.id
  okay(await api(actor, `/api/admin/customer-requests/${id}/quotation/customer-agreed-amount`, { method: 'PATCH', location, body: { acceptedAmountInr: String(amount) } }))
  okay(await api(actor, `/api/admin/customer-requests/${id}/finalize`, { method: 'PATCH', location, revision: (await detail(actor, id, location)).request.revision, body: {} }))
  const operationId = crypto.randomUUID(), body = { operationId, entryType: 'PAYMENT', amountPaise: amount * 100, paymentMethod: 'CASH', recordingMode: 'ONLINE' }
  okay(await api(actor, `/api/admin/customer-requests/${id}/payments`, { method: 'POST', location, revision: (await detail(actor, id, location)).request.revision, body }))
  return { requestId: id, quotationId: data.quotation.id, operationId }
}
await check('HTTP-01', 'Platform provisions new Stall B and its existing Owner atomically', [1, 12, 13], ['adminPlatformRoutes', 'adminPlatformLocations'], async () => {
  await login(u.platform)
  const body = { businessId: state.business, seasonId: season, operatingYear: 2026, ownerUserId: u.ownerB.id, slug: state.prefix + '-b', name: 'Acceptance Stall B', address: 'Fixture road', stallLabel: 'B' }
  const created = okay(await api(u.platform, '/api/admin/platform/locations', { method: 'POST', body }))
  state.b = created.location.id; u.ownerB.location = state.b
  assert.equal(created.owner.userId, u.ownerB.id); assert.equal(created.owner.locationRole, 'owner')
  assert.equal((await api(u.platform, '/api/admin/platform/locations', { method: 'POST', body })).status, 409)
  return { business: state.business, location: state.b, owner: u.ownerB.id }
})
for (const name of ['ownerA', 'ownerB', 'dual', 'super', 'admin']) await login(u[name])
await check('HTTP-02', 'Owner B independently authenticates; existing users receive only explicit B roles', [2, 3, 4, 10], ['adminSession', 'adminLocationMembers'], async () => {
  const session = okay(await api(u.ownerB, '/api/admin/session')); assert.equal(session.activeLocationId, state.b); assert.equal(session.effectiveRole, 'owner')
  for (const [name, role] of [['dual', 'admin'], ['super', 'super_admin'], ['admin', 'admin']]) okay(await api(u.ownerB, '/api/admin/users', { method: 'POST', body: { email: u[name].email, role, existingOnly: true } }))
  for (const [location, expected] of [[a, 'owner'], [state.b, 'admin']]) assert.equal(okay(await api(u.dual, '/api/admin/session', { location })).effectiveRole, expected)
  assert.equal(okay(await api(u.admin, '/api/admin/session')).effectiveRole, 'admin')
  return { dual: { A: 'owner', B: 'admin' }, globalOwnerDoesNotRaiseAdmin: true }
})
await check('HTTP-03', 'Each stall creates its own category/product and reads independent prices', [2, 5, 14], ['adminCatalogue', 'adminCatalogueScope'], async () => {
  state.products = {}; state.categories = {}
  for (const [key, actor, location, price] of [['a', u.ownerA, a, 100], ['b', u.ownerB, state.b, 250], ['c', u.dual, c, 700]]) {
    const category = state.prefix + '-category-' + key, product = 'P' + Date.now() + (key === 'a' ? '1' : key === 'b' ? '2' : '3')
    okay(await api(actor, '/api/admin/categories', { method: 'POST', location, body: { slug: category, label: 'Acceptance Category ' + key.toUpperCase() } }))
    okay(await api(actor, '/api/admin/products', { method: 'POST', location, body: { id: product, categorySlug: category, name: 'Acceptance Product ' + key.toUpperCase(), pack: 'Box', sellingPriceInr: price, finalPriceInr: price - 10, piecesPerPack: 10, allowLooseSale: true, stockStatus: 'available', active: true } }))
    state.products[key] = product; state.categories[key] = category
    const listed = okay(await api(actor, '/api/admin/products', { location })); assert.equal(listed.products.length, 1); assert.equal(listed.products[0].id, product); assert.equal(listed.products[0].sellingPricePaise, price * 100)
  }
  return { products: state.products, categories: state.categories }
})
await check('HTTP-04', 'Cross-stall modified product/category IDs cannot be read or written', [5, 8, 10, 14], ['adminCatalogueScope', 'adminCategories', 'adminProducts'], async () => {
  denied(await api(u.ownerA, '/api/admin/products/' + state.products.b))
  denied(await api(u.ownerA, '/api/admin/products/' + state.products.b, { method: 'PATCH', body: { sellingPriceInr: 1 } }))
  denied(await api(u.ownerA, '/api/admin/categories/' + state.categories.b, { method: 'PATCH', body: { label: 'Attack' } }))
  denied(await api(u.ownerA, '/api/admin/products/' + state.products.a, { method: 'PATCH', body: { categorySlug: state.categories.b } }))
  assert.equal(okay(await api(u.ownerB, '/api/admin/products/' + state.products.b)).product.sellingPricePaise, 25000)
  assert.equal((await api(u.ownerA, '/api/admin/products', { location: state.b })).status, 403)
  return { deniedCases: 5, BPriceUnchanged: 25000 }
})
await check('HTTP-05', 'Stock status is stall-specific and sold-out checkout is rejected', [5, 14], ['adminProducts', 'adminQuickBill'], async () => {
  okay(await api(u.ownerB, '/api/admin/products/' + state.products.b, { method: 'PATCH', body: { stockStatus: 'soldout' } }))
  assert.equal(okay(await api(u.ownerA, '/api/admin/products/' + state.products.a)).product.stockStatus, 'available')
  const attempt = await api(u.ownerB, '/api/admin/quick-bill/checkout', { method: 'POST', body: { customer: { name: 'Sold Out', mobile: '9876543210' }, items: [{ productId: state.products.b, quantity: 1 }], pricingMode: 'selling' }, headers: { 'Idempotency-Key': crypto.randomUUID() } }); denied(attempt)
  okay(await api(u.ownerB, '/api/admin/products/' + state.products.b, { method: 'PATCH', body: { stockStatus: 'available' } }))
  return { inventoryModel: 'stock_status; no quantity ledger implemented' }
})
await check('HTTP-06', 'Owner and Super Admin finalize/pay independently; Admin creates but cannot finalize or pay', [4, 5, 10], ['adminQuickBill', 'adminCustomerRequests', 'adminPayments'], async () => {
  state.requests.a = await bill(u.ownerA, a, state.products.a, 100)
  state.requests.b = await bill(u.ownerB, state.b, state.products.b, 250)
  state.requests.super = await bill(u.super, state.b, state.products.b, 200)
  const adminBill = await checkout(u.dual, state.b, state.products.b, 'B Admin Customer'); state.requests.admin = { requestId: adminBill.request.id, quotationId: adminBill.quotation.id }
  assert.equal((await api(u.dual, `/api/admin/customer-requests/${adminBill.request.id}/finalize`, { method: 'PATCH', location: state.b, revision: (await detail(u.dual, adminBill.request.id, state.b)).request.revision, body: {} })).status, 403)
  assert.equal((await api(u.dual, `/api/admin/customer-requests/${state.requests.b.requestId}/payments`, { method: 'POST', location: state.b, body: { operationId: crypto.randomUUID(), entryType: 'PAYMENT', amountPaise: 1, paymentMethod: 'CASH', recordingMode: 'ONLINE' } })).status, 403)
  assert.equal((await api(u.super, '/api/admin/users', { method: 'POST', location: state.b, body: { email: u.dual.email, role: 'owner', existingOnly: true } })).status, 403)
  return state.requests
})
await check('HTTP-07', 'Customer/request/quotation/final bill/payment views exclude other stalls', [5, 8, 14], ['adminCustomerRequestScope', 'adminQuotations', 'adminPayments'], async () => {
  for (const [actor, location, own, foreign] of [[u.ownerA, a, state.requests.a, state.requests.b], [u.ownerB, state.b, state.requests.b, state.requests.a]]) {
    const list = okay(await api(actor, '/api/admin/customer-requests?limit=100', { location }))
    const serialized = JSON.stringify(list); assert.ok(serialized.includes(own.requestId)); assert.equal(serialized.includes(foreign.requestId), false)
    denied(await api(actor, '/api/admin/customer-requests/' + foreign.requestId, { location }))
    denied(await api(actor, '/api/admin/quotations/' + foreign.quotationId, { location }))
    denied(await api(actor, `/api/admin/customer-requests/${foreign.requestId}/payments`, { location }))
    denied(await api(actor, `/api/admin/customer-requests/${foreign.requestId}/status`, { method: 'PATCH', location, body: { status: 'reviewing' } }))
    const paid = okay(await api(actor, `/api/admin/customer-requests/${own.requestId}/payments`, { location })); assert.equal(paid.summary.outstandingPaise, 0); assert.equal(paid.entries.length, 1)
  }
  return { reciprocalReadWriteDenials: true, paymentsPerBill: 1 }
})
await check('HTTP-08', 'Historical seasonal location is readable but archived writes and cross-season transaction reads fail', [6, 8], ['adminLocationContext', 'adminSeasonGuards', 'adminCustomerRequestScope'], async () => {
  const historicalRequest = okay(await api(u.ownerA, '/api/admin/customer-requests/' + state.historicalRequest, { location: historicalLocation, activeSeason: historical })); assert.equal(historicalRequest.request.id, state.historicalRequest)
  denied(await api(u.ownerA, '/api/admin/customer-requests/' + state.historicalRequest))
  denied(await api(u.ownerA, '/api/admin/customer-requests/' + state.requests.a.requestId, { location: historicalLocation, activeSeason: historical }))
  assert.equal((await api(u.ownerA, '/api/admin/categories', { method: 'POST', location: historicalLocation, activeSeason: historical, body: { slug: state.prefix + '-forbidden', label: 'Forbidden' } })).status, 403)
  assert.equal((await api(u.ownerA, '/api/admin/products', { location: a, activeSeason: historical })).status, 403)
  const catalogue = okay(await api(u.dual, '/api/admin/products', { location: c, activeSeason: historical })); assert.ok(catalogue.products.some(row => row.id === state.products.c))
  return { seasonalLocationPerYear: true, permanentCatalogueSharedAcrossOperatingSeasonsByDesign: true, transactionsIsolated: true }
})
await check('HTTP-09', 'Platform authority is separate from stall membership and global settings', [5, 10, 13], ['adminPlatformRoutes', 'adminLocationContext'], async () => {
  assert.equal(okay(await api(u.platform, '/api/admin/platform/session')).platformAdmin, true)
  assert.equal((await api(u.platform, '/api/admin/products', { location: state.b })).status, 403)
  assert.equal((await api(u.ownerB, '/api/admin/platform/session')).status, 403)
  assert.equal((await api(u.ownerB, '/api/admin/platform/settings/public-catalogue-season')).status, 403)
  okay(await api(u.platform, '/api/admin/platform/settings/public-catalogue-season'))
  return { platformImplicitOperationalMembership: false, publicCatalogueSetting: 'platform-global; not a stall setting' }
})

async function device(actor, location, business = state.business) {
  const deviceId = crypto.randomUUID(), deviceToken = (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '')
  okay(await api(actor, '/api/admin/offline/devices', { method: 'POST', location, body: { deviceId, deviceToken } }))
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  const preparation = okay(await api(actor, '/api/admin/offline/handover/prepare', { method: 'POST', location, body: { deviceId, deviceToken, publicKey: publicJwk(await crypto.subtle.exportKey('jwk', pair.publicKey)) } }))
  return { actor, deviceId, deviceToken, pair, preparation, catalogue: okay(await api(actor, '/api/admin/offline/catalogue', { location })), scope: { businessId: business, locationId: location, seasonId: season, userId: actor.id, deviceId } }
}
function operation(device, kind, body, more = {}) { return { operationId: crypto.randomUUID(), kind, body, scope: device.scope, deviceToken: device.deviceToken, capturedRole: device.scope.locationId === state.b && device.actor === u.dual ? 'admin' : device.actor.role, occurredAt: new Date().toISOString(), ...more } }
async function transfer(sender, receiver, product) {
  const sourceOperationId = crypto.randomUUID(), occurredAt = new Date().toISOString()
  const payload = { v: 1, transferId: crypto.randomUUID(), scope: transferScope(sender.scope), requestId: await offlineRequestId(sender.scope, sourceOperationId), revision: null, sourceOperationId, creatorUserId: sender.actor.id, recipientUserId: receiver.actor.id, occurredAt, sourceOccurredAt: occurredAt, customer: { name: 'Boundary QR Fixture', mobile: '9876543210' }, lines: sellingLines([{ productId: product, quantity: 1, unitType: 'box' }], sender.catalogue.products, crypto.randomUUID()) }
  return { payload, certificate: sender.preparation.certificate, signature: await sign(payload, sender.pair.privateKey) }
}
await check('HTTP-10', 'Signed QR and offline operations reject location/business/season boundary changes', [8, 9, 10], ['adminOfflineSync', 'adminHandover', 'handoverProtocol'], async () => {
  const sender = await device(u.admin, a), receiverA = await device(u.ownerA, a), receiverB = await device(u.ownerB, state.b), receiverC = await device(u.dual, c, state.otherBusiness)
  const envelope = await transfer(sender, receiverA, state.products.a)
  const valid = operation(receiverA, 'HANDOVER', { transfer: envelope }, { requestId: envelope.payload.requestId, expectedRevision: null, catalogue: receiverA.catalogue.products })
  okay(await api(u.ownerA, '/api/admin/offline/sync', { method: 'POST', body: valid }))
  const cross = await transfer(sender, receiverB, state.products.a)
  for (const receiver of [receiverB, receiverC]) {
    const input = operation(receiver, 'HANDOVER', { transfer: cross }, { requestId: cross.payload.requestId, expectedRevision: null, catalogue: receiver.catalogue.products })
    denied(await api(receiver.actor, '/api/admin/offline/sync', { method: 'POST', location: receiver.scope.locationId, body: input }))
  }
  const items = [{ productId: state.products.a, quantity: 1, unitType: 'box' }]
  const create = operation(sender, 'CREATE', { customer: { name: 'Boundary Outbox', mobile: '9876543210' }, items, pricingMode: 'selling' }, { catalogue: sender.catalogue.products, lineSnapshots: sellingLines(items, sender.catalogue.products, crypto.randomUUID()) })
  for (const changes of [{ locationId: state.b }, { businessId: state.otherBusiness }, { seasonId: historical }]) denied(await api(u.admin, '/api/admin/offline/sync', { method: 'POST', body: { ...create, scope: { ...create.scope, ...changes } } }))
  denied(await api(u.admin, '/api/admin/offline/sync', { method: 'POST', location: state.b, body: create }))
  return { sameScopeAcceptance: true, crossScopeDenials: 6, signedTransferId: envelope.payload.transferId }
})
await check('HTTP-11', 'Last B Owner cannot be removed by platform season demotion/disable', [12, 13], ['adminPlatformSeasonMembers', 'adminLocationMembers'], async () => {
  for (const [route, method, body] of [[`/api/admin/platform/seasons/${season}/members/${u.ownerB.id}`, 'PATCH', { role: 'admin' }], [`/api/admin/platform/seasons/${season}/members/${u.ownerB.id}/disable`, 'POST', {}]]) assert.equal((await api(u.platform, route, { method, body })).status, 409)
  assert.equal((await api(u.ownerB, '/api/admin/users/' + u.ownerB.id, { method: 'DELETE' })).status, 400)
  return { lastOwnerDemotionBlocked: true, lastOwnerDisableBlocked: true, selfRemovalBlocked: true }
})
await check('HTTP-12', 'Removing only A membership preserves the same session and B Admin access', [3, 10, 11], ['adminUsersManagement', 'adminLocationMembers', 'adminLocationContext'], async () => {
  const cookie = u.dual.cookie
  okay(await api(u.ownerA, '/api/admin/users/' + u.dual.id, { method: 'DELETE' }))
  assert.equal((await api(u.dual, '/api/admin/products', { location: a })).status, 403)
  assert.equal(okay(await api(u.dual, '/api/admin/session', { location: state.b })).effectiveRole, 'admin'); assert.equal(u.dual.cookie, cookie)
  okay(await api(u.dual, '/api/admin/products', { location: state.b }))
  // Restore only this fresh fixture's A membership for browser-switch acceptance.
  okay(await api(u.ownerA, '/api/admin/users', { method: 'POST', body: { email: u.dual.email, role: 'super_admin', existingOnly: true } }))
  return { removedLocation: a, remainingLocation: state.b, sessionStillValid: true, restoredFixtureRoleForBrowser: 'super_admin' }
})
for (const [name, route] of [['reports', '/api/admin/reports'], ['stall settings', '/api/admin/settings'], ['customer directory', '/api/admin/customers'], ['quantity inventory', '/api/admin/inventory']]) {
  const result = await api(u.ownerB, route)
  results.push({ id: 'GAP-' + name.replaceAll(' ', '-'), name, scenarios: [5], modules: ['route registry'], status: 'NOT TESTED', evidence: { status: result.status, reason: 'No standalone implementation/route exists; supported stock and embedded-customer behaviors tested separately.' } })
}
await writeFile(path.join(directory, 'state.json'), JSON.stringify(state, null, 2))
await writeFile(path.join(directory, 'http-results.json'), JSON.stringify({ results, requests }, null, 2))
console.log(JSON.stringify({ pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length, notTested: results.filter(r => r.status === 'NOT TESTED').length, directory }))
if (results.some(r => r.status === 'FAIL')) process.exitCode = 1
