import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { handleAdminQuotationRoutes } from '../src/routes/adminQuotations.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'
import { fixture, attach, A, B, OLD, WEB, season, previous } from './helpers/mockAdminTransactionDb.js'
import { checkoutQuickBill } from '../src/services/adminQuickBill.js'

const customer = { name: 'Guest', mobile: '9876543210' }
const items = [{ productId: 'P001', quantity: 2 }]
const identity = { userId: 'u-1', email: 'owner@test.com', role: 'owner' }

async function api(db, path, method = 'GET', payload, options = {}) {
  const request = new Request('https://example.test/api/admin/' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Season-Id': options.season ?? season,
      'X-Admin-Location-Id': options.location ?? 'loc-a', 'Idempotency-Key': 'location-api-checkout' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })
  const attached = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: true })
  options.context?.(getAdminContext(request))
  if (options.expectAttachmentDenied) assert.equal(attached.ok, false)
  const url = new URL(request.url)
  if (path.startsWith('quick-bill/')) return handleAdminQuickBillRoutes(request, { DB: db }, identity)
  if (/\/(quotation|quotations|order-confirmation)(\/|$)/.test(url.pathname)) return handleAdminQuotationRoutes(request, { DB: db }, url, identity)
  return handleAdminCustomerRequestRoutes(request, { DB: db }, url, identity)
}

const requestOperations = id => [
  [`customer-requests/${id}`, 'GET'],
  [`customer-requests/${id}/status`, 'PATCH', { status: 'reviewing' }],
  [`customer-requests/${id}/assign`, 'PATCH', { assigneeUserId: 'assignee' }],
  [`customer-requests/${id}/finalize`, 'PATCH', {}],
  [`customer-requests/${id}/adjust-bill`, 'PATCH', { items }],
  [`customer-requests/${id}/adjust-bill/preview`, 'POST', { items }],
  [`customer-requests/${id}/quotation`, 'GET'],
  [`customer-requests/${id}/quotation`, 'POST', {}],
  [`customer-requests/${id}/quotation/regenerate`, 'POST', {}],
  [`customer-requests/${id}/quotation/customer-agreed-amount`, 'PATCH', { acceptedAmountInr: 100 }],
  [`customer-requests/${id}/order-confirmation/whatsapp`, 'GET'],
]

for (const id of [B, OLD]) test(`billing APIs deny foreign location/operating-season request ${id}`, async () => {
  const db = fixture(), before = structuredClone(db.state)
  for (const [path, method, payload] of requestOperations(id)) {
    const response = await api(db, path, method, payload)
    assert.equal(response.status, 404, path)
    if (payload) {
      const forged = await api(db, path, method, { ...payload, locationId: 'loc-a', seasonId: season, requestId: A })
      assert.ok([400, 404].includes(forged.status), path)
    }
    assert.deepEqual(db.state, before)
  }
})

test('quotation ID and list filter substitution cannot expose other stalls', async () => {
  const db = fixture()
  for (const id of ['q-b', 'q-old']) {
    assert.equal((await api(db, 'quotations/' + id)).status, 404)
    assert.equal((await api(db, 'quotations/' + id + '/whatsapp')).status, 404)
  }
  const response = await api(db, 'customer-requests?locationId=loc-b&seasonId=' + previous)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).requests.map(row => row.id).sort(), [A, WEB].sort())
})

test('all billing endpoints deny an unauthorized location header even with payload membership hints', async () => {
  const db = fixture(), before = structuredClone(db.state)
  const operations = [...requestOperations(A), ['customer-requests', 'GET'], ['quotations/q-a', 'GET'],
    ['quick-bill/preview', 'POST', { items }], ['quick-bill/checkout', 'POST', { customer, items }]]
  for (const [path, method, payload] of operations) {
    const response = await api(db, path, method, payload && { ...payload, locationId: 'loc-a', locationRole: 'owner', businessId: 'shop' },
      { location: 'loc-b', expectAttachmentDenied: true })
    assert.equal(response.status, 403, path)
    assert.deepEqual(db.state, before)
  }
  assert.ok(db.calls.every(call => call.mode !== 'run'))
})

test('binding-enforced location prerequisite survives a missing context mode flag', async () => {
  const db = fixture(), before = structuredClone(db.state)
  for (const [path, method, payload] of [requestOperations(A)[0], requestOperations(A)[2], ['quotations/q-a', 'GET'], ['quick-bill/preview', 'POST', { items }]]) {
    const response = await api(db, path, method, payload, { context: context => { context.locationModeEnabled = false } })
    assert.equal(response.status, 403, path)
    assert.deepEqual(db.state, before)
  }
})

test('foreign catalogue IDs cannot be authorized through payload ownership hints', async () => {
  const db = fixture(), before = structuredClone(db.state)
  const foreignItems = [{ productId: 'P002', quantity: 1, locationId: 'loc-a', seasonId: season }]
  for (const [path, method, payload] of [
    ['quick-bill/preview', 'POST', { items: foreignItems }],
    ['quick-bill/checkout', 'POST', { customer, items: foreignItems }],
    [`customer-requests/${A}/adjust-bill`, 'PATCH', { items: foreignItems }],
  ]) {
    const response = await api(db, path, method, { ...payload, locationId: 'loc-b', businessId: 'other', seasonId: previous })
    assert.equal(response.status, 400, path)
    assert.deepEqual(db.state, before)
  }
})

test('successful checkout stamps authorized scope despite body location, season and request IDs', async () => {
  const db = fixture()
  const response = await api(db, 'quick-bill/checkout', 'POST', { customer, items, locationId: 'loc-b', location_id: 'loc-b', businessId: 'other', seasonId: previous, requestId: B })
  assert.equal(response.status, 201)
  const result = await response.json()
  const request = db.state.customer_requests.find(row => row.id === result.request.id)
  const quotation = db.state.quotations.find(row => row.id === result.quotation.id)
  assert.equal(request.location_id, 'loc-a'); assert.equal(request.season_id, season)
  assert.equal(quotation.location_id, 'loc-a'); assert.equal(quotation.season_id, season)
  assert.notEqual(request.id, B)
})

for (const category of ['cat-b', 'missing-category']) test(`billing rejects owned products referencing ${category}`, async () => {
  const db = fixture()
  db.state.products[0].category_slug = category
  const before = structuredClone(db.state)
  for (const [path, method, payload] of [requestOperations(A)[0], requestOperations(A)[2], requestOperations(A)[3],
    [`customer-requests/${A}/quotation/regenerate`, 'POST', {}], ['quick-bill/preview', 'POST', { items }], ['quick-bill/checkout', 'POST', { customer, items }]]) {
    const response = await api(db, path, method, payload)
    assert.ok([400, 409].includes(response.status), path + ': ' + response.status)
    assert.deepEqual(db.state, before)
  }
})

test('category ownership is rechecked inside checkout batch and rolls back all writes', async () => {
  const db = fixture(), { context } = await attach(db)
  let before
  db.beforeBatch = state => { state.categories[0].location_id = 'loc-b'; before = structuredClone(state) }
  const result = await checkoutQuickBill(db, { customer, items }, { context, seasonId: season, idempotencyKey: 'category-race' })
  assert.equal(result.ok, false)
  assert.deepEqual(db.state, before)
})

test('2026 request access requires its own validated operating-season scope', async () => {
  const db = fixture()
  assert.equal((await api(db, `customer-requests/${OLD}`, 'GET', undefined, { season: previous })).status, 200)
  assert.equal((await api(db, `customer-requests/${A}`, 'GET', undefined, { season: previous })).status, 404)
})

test('assignment rejects a privileged recipient whose membership belongs to another stall', async () => {
  const db = fixture()
  db.state.assigneeSeason.role = 'owner'
  db.state.assigneeLocation.role = 'owner'
  db.state.assigneeLocation.location_id = 'loc-b'
  const before = structuredClone(db.state)
  assert.equal((await api(db, `customer-requests/${A}/assign`, 'PATCH', { assigneeUserId: 'assignee' })).status, 400)
  assert.deepEqual(db.state, before)
})

test('locked family-pack snapshots cannot hide a foreign catalogue reference', async () => {
  const db = fixture()
  Object.assign(db.state.customer_request_items[0], { product_id: null, family_pack_id: 'FP002' })
  const before = structuredClone(db.state)
  for (const [path, method, payload] of [requestOperations(A)[0], requestOperations(A)[3], requestOperations(A)[6], requestOperations(A)[8]]) {
    assert.equal((await api(db, path, method, payload)).status, 409)
    assert.deepEqual(db.state, before)
  }
})

test('finalization rechecks product/category ownership at the write boundary', async () => {
  const db = fixture()
  db.beforeRun = (sql, state) => { if (sql.startsWith('UPDATE customer_requests')) state.categories[0].location_id = 'loc-b' }
  const response = await api(db, `customer-requests/${A}/finalize`, 'PATCH', {})
  assert.equal(response.status, 409)
  assert.equal(db.state.customer_requests[0].status, 'quoted')
  assert.equal(db.state.customer_requests[0].finalization_status, 'pending')
})
