import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, attach, season, previous } from './helpers/mockAdminTransactionDb.js'
import { checkoutQuickBill } from '../src/services/adminQuickBill.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'

const customer = { name: 'Guest', mobile: '9876543210', area: 'Town', pickupPreference: 'pickup' }
const data = { customer, items: [{ productId: 'P001', quantity: 2, unitType: 'box' }, { productId: 'P001', quantity: 3, unitType: 'piece' }] }
const opts = { seasonId: season, idempotencyKey: 'checkout-123', createdByEmail: 'owner@test.com', pricingMode: 'bargain', acceptedAmountPaise: 17000 }
function atomicFixture() {
  const db = fixture(), original = db.batch.bind(db)
  db.batches = []
  // Model the runtime's serialized batches, not arbitrary interleaved statements.
  let queue = Promise.resolve()
  db.batch = statements => {
    db.batches.push(statements.length)
    const result = queue.then(() => original(statements))
    queue = result.catch(() => {})
    return result
  }
  return db
}
const counts = db => [db.state.customer_requests.length, db.state.customer_request_items.length, db.state.quotations.length, db.state.quotation_items.length]

test('enabled checkout commits the full owned request, pending state and quotation in exactly one batch', async () => {
  const db = atomicFixture(), { context } = await attach(db), before = counts(db)
  const original = structuredClone(db.state)
  const result = await checkoutQuickBill(db, data, { ...opts, context })
  assert.equal(result.ok, true)
  assert.equal(result.quotationCreated, true)
  assert.equal(result.idempotentReplay, false)
  assert.deepEqual(counts(db).map((n, i) => n - before[i]), [1, 2, 1, 2])
  assert.equal(db.batches.length, 1)
  const r = db.state.customer_requests.find(r => r.id === result.request.id)
  assert.equal(r.location_id, 'loc-a'); assert.equal(r.season_id, season)
  assert.equal(r.finalization_status, 'pending'); assert.equal(r.status, 'quoted')
  assert.match(r.raw_message, /^admin-quick-bill-v1:[a-f0-9]{64}$/)
  assert.ok(!r.raw_message.includes(opts.idempotencyKey))
  assert.equal(result.quotation.customerRequestId, r.id)
  const q = db.state.quotations.find(q => q.id === result.quotation.id)
  assert.equal(q.location_id, 'loc-a'); assert.equal(q.season_id, season)
  assert.equal(q.selling_subtotal_paise, 23000); assert.equal(q.final_subtotal_paise, 18400)
  assert.equal(q.bargain_floor_paise, 68400); assert.equal(q.accepted_amount_paise, 17000)
  assert.equal(q.total_paise, 23000)
  assert.deepEqual(result.quotation.items.map(line => [line.quantity, line.unitRatePaise]), [[2, 10000], [3, 1000]])
  assert.equal(result.warnings[0].code, 'accepted_below_final_subtotal')
  assert.ok(result.quotation.items[1].productName.endsWith(' (loose pc)'))
  assert.ok(db.calls.some(c => c.sql.includes('checkout_product.selling_price_paise IS ?')))
  assert.ok(db.calls.some(c => c.sql.includes('guard_quote')))
  for (const table of ['customer_requests', 'customer_request_items', 'quotations', 'quotation_items']) {
    assert.deepEqual(db.state[table].slice(0, original[table].length), original[table])
  }
})

for (const prefix of ['INSERT INTO quotations', 'INSERT INTO quotation_items']) test(`late ${prefix} failure rolls back everything; same-key retries create exactly one complete bill`, async () => {
  const db = atomicFixture(), { context } = await attach(db), before = structuredClone(db.state), originalCounts = counts(db)
  db.beforeRun = sql => { if (sql.startsWith(prefix)) { db.beforeRun = null; throw Error('Injected late write failure') } }
  const failed = await checkoutQuickBill(db, data, { ...opts, context })
  assert.equal(failed.status, 503)
  assert.deepEqual(db.state, before)
  const retry = await checkoutQuickBill(db, data, { ...opts, context })
  assert.equal(retry.ok, true)
  assert.deepEqual(counts(db).map((n, i) => n - originalCounts[i]), [1, 2, 1, 2])
  const after = structuredClone(db.state), batches = db.batches.length
  const replay = await checkoutQuickBill(db, data, { ...opts, context })
  assert.equal(replay.ok, true); assert.equal(replay.idempotentReplay, true)
  assert.equal(replay.request.id, retry.request.id); assert.equal(replay.quotation.id, retry.quotation.id)
  assert.deepEqual(replay.warnings, retry.warnings)
  assert.deepEqual(db.state, after); assert.equal(db.batches.length, batches)
})

test('a lost batch success acknowledgement is recovered by durable scoped replay', async () => {
  const db = atomicFixture(), { context } = await attach(db), batch = db.batch.bind(db), before = counts(db)
  db.batch = async statements => { await batch(statements); throw Error('Lost acknowledgement') }
  const result = await checkoutQuickBill(db, data, { ...opts, context })
  assert.equal(result.ok, true); assert.equal(result.idempotentReplay, true)
  assert.deepEqual(counts(db).map((n, i) => n - before[i]), [1, 2, 1, 2])
  assert.equal((await checkoutQuickBill(db, data, { ...opts, context })).request.id, result.request.id)
  assert.equal(db.batches.length, 1)
})

test('competing same-key checkouts return one transaction, with no duplicate children or quotations', async () => {
  const db = atomicFixture(), { context } = await attach(db), before = counts(db)
  const results = await Promise.all([1, 2].map(() => checkoutQuickBill(db, data, { ...opts, context })))
  assert.ok(results.every(r => r.ok))
  assert.equal(results[0].request.id, results[1].request.id)
  assert.equal(results[0].quotation.id, results[1].quotation.id)
  assert.deepEqual(counts(db).map((n, i) => n - before[i]), [1, 2, 1, 2])
})

test('same key with changed customer/cart/pricing input conflicts without a write', async () => {
  const db = atomicFixture(), { context } = await attach(db)
  assert.equal((await checkoutQuickBill(db, data, { ...opts, context })).ok, true)
  const before = structuredClone(db.state), batches = db.batches.length
  for (const [body, change] of [
    [{ ...data, customer: { ...customer, name: 'Another' } }, {}],
    [{ ...data, items: [{ productId: 'P001', quantity: 9 }] }, {}],
    [data, { acceptedAmountPaise: 18000 }], [data, { pricingMode: 'selling' }],
  ]) assert.equal((await checkoutQuickBill(db, body, { ...opts, ...change, context })).status, 409)
  assert.deepEqual(db.state, before); assert.equal(db.batches.length, batches)
})

test('replay preserves persisted financial snapshots even after prices change or the request is finalized', async () => {
  const db = atomicFixture(), { context } = await attach(db)
  const first = await checkoutQuickBill(db, data, { ...opts, context })
  db.state.products[0].selling_price_paise = null
  const request = db.state.customer_requests.find(r => r.id === first.request.id)
  request.status = 'closed'; request.finalization_status = 'finalized'
  const before = structuredClone(db.state), batches = db.batches.length
  const retry = await checkoutQuickBill(db, data, { ...opts, context })
  assert.equal(retry.ok, true); assert.equal(retry.quotation.id, first.quotation.id)
  assert.equal(retry.quotation.totalPaise, 23000)
  assert.equal(retry.quotation.acceptedAmountPaise, 17000)
  assert.deepEqual(db.state, before); assert.equal(db.batches.length, batches)
})

test('checkout retains existing box/loose name normalization without duplicate loose suffixes', async () => {
  const db = atomicFixture(), { context } = await attach(db)
  db.state.products[0].name = 'Product (loose pc)'
  const result = await checkoutQuickBill(db, data, { ...opts, context })
  assert.equal(result.ok, true)
  assert.deepEqual(result.quotation.items.map(i => i.productName), ['Product', 'Product (loose pc)'])
  assert.deepEqual(db.state.customer_request_items.filter(i => i.request_id === result.request.id).map(i => i.product_name), ['Product', 'Product (loose pc)'])
})

for (const race of ['location', 'price', 'stock', 'context']) test(`${race} changes before the batch cannot bypass ownership/price/context checks`, async () => {
  const db = atomicFixture(), { context } = await attach(db), before = counts(db)
  db.beforeBatch = state => {
    db.beforeBatch = null
    if (race === 'location') state.products[0].location_id = 'loc-b'
    if (race === 'price') state.products[0].final_price_paise = 5000
    if (race === 'stock') state.products[0].stock_status = 'soldout'
    if (race === 'context') state.checkoutContextActive = false
  }
  assert.equal((await checkoutQuickBill(db, data, { ...opts, context })).status, 503)
  assert.deepEqual(counts(db), before)
})

test('cross-location products are rejected before any batch and do not reserve the key', async () => {
  const db = atomicFixture(), { context } = await attach(db), before = structuredClone(db.state)
  assert.equal((await checkoutQuickBill(db, { customer, items: [{ productId: 'P002', quantity: 1 }] }, { ...opts, context })).ok, false)
  assert.equal(db.batches.length, 0); assert.deepEqual(db.state, before)
  assert.equal((await checkoutQuickBill(db, data, { ...opts, context })).ok, true)
})

test('idempotency keys are isolated by operating season and physical location', async () => {
  const db = atomicFixture(), { context } = await attach(db)
  const a = await checkoutQuickBill(db, data, { ...opts, context })
  const old = await attach(db, { operatingSeason: previous })
  const b = await checkoutQuickBill(db, data, { ...opts, context: old.context, seasonId: previous })
  assert.notEqual(a.request.id, b.request.id)
  const other = structuredClone(context), loc = other.locationContext
  loc.activeLocationId = 'loc-b'; loc.location.id = 'loc-b'; loc.locationMembership.locationId = 'loc-b'; loc.association.locationId = 'loc-b'
  db.state.products[1].stock_status = 'available'
  const c = await checkoutQuickBill(db, { customer, items: [{ productId: 'P002', quantity: 1 }] }, { ...opts, context: other })
  assert.equal(c.ok, true); assert.notEqual(a.request.id, c.request.id)
  assert.equal(db.state.customer_requests.find(r => r.id === c.request.id).location_id, 'loc-b')
})

for (const partial of ['missing quote child', 'not quoted', 'missing pending state']) test(`incomplete persisted state (${partial}) is rejected without repair writes`, async () => {
    const db = atomicFixture(), { context } = await attach(db)
    const first = await checkoutQuickBill(db, data, { ...opts, context })
    if (partial === 'missing quote child') db.state.quotation_items = db.state.quotation_items.filter(i => i.quotation_id !== first.quotation.id || i.line_number !== 2)
    if (partial === 'not quoted') db.state.customer_requests.find(r => r.id === first.request.id).status = 'received'
    if (partial === 'missing pending state') db.state.customer_requests.find(r => r.id === first.request.id).finalization_status = null
    const before = structuredClone(db.state), batches = db.batches.length
    assert.equal((await checkoutQuickBill(db, data, { ...opts, context })).status, 409)
    assert.deepEqual(db.state, before); assert.equal(db.batches.length, batches)
  })

test('public-reference collisions retry the entire batch without leaving partial records', async () => {
  const db = atomicFixture(), { context } = await attach(db), before = counts(db)
  db.beforeRun = sql => { if (sql.startsWith('INSERT INTO customer_requests')) { db.beforeRun = null; throw Error('UNIQUE constraint failed: customer_requests.public_reference') } }
  assert.equal((await checkoutQuickBill(db, data, { ...opts, context })).ok, true)
  assert.equal(db.batches.length, 2)
  assert.deepEqual(counts(db).map((n, i) => n - before[i]), [1, 2, 1, 2])
})

test('maximum-size carts use one batch with bounded assertion parameter counts', async () => {
  const db = atomicFixture(), { context } = await attach(db)
  const result = await checkoutQuickBill(db, { customer, items: Array.from({ length: 50 }, () => ({ productId: 'P001', quantity: 1 })) }, { ...opts, context })
  assert.equal(result.ok, true); assert.equal(result.quotation.items.length, 50)
  assert.equal(db.batches.length, 1)
  assert.ok(db.calls.every(call => call.v.length < 100))
})

test('enabled route requires and forwards Idempotency-Key; replay does not write again', async () => {
  const db = atomicFixture()
  async function call(key) {
    const { req } = await attach(db, { method: 'POST', payload: { ...data, pricingMode: 'bargain', acceptedAmountPaise: 17000 } })
    Object.defineProperty(req, 'url', { value: 'https://example.test/api/admin/quick-bill/checkout' })
    if (key) req.headers.set('Idempotency-Key', key)
    return handleAdminQuickBillRoutes(req, { DB: db }, { email: 'owner@test.com' })
  }
  assert.equal((await call()).status, 400)
  assert.equal(db.batches.length, 0)
  const first = await call('route-key')
  assert.equal(first.status, 201)
  const initial = await first.json(), repeated = await (await call('route-key')).json()
  assert.equal(initial.request.id, repeated.request.id); assert.equal(repeated.idempotentReplay, true)
  assert.equal(db.batches.length, 1)
})

test('gate OFF uses atomic idempotency without depending on location schema', async () => {
  const db = atomicFixture(), { context } = await attach(db, { mode: false })
  const result = await checkoutQuickBill(db, { customer, items: [data.items[0]] }, { seasonId: previous, context, idempotencyKey: 'legacy-checkout' })
  assert.equal(result.ok, true)
  assert.equal(result.idempotentReplay, false)
  assert.equal(db.batches.length, 1)
  assert.ok(db.calls.every(c => !/location_id|location_seasons/.test(c.sql)))
})

test('legacy retries, lost commit acknowledgement and concurrent submissions retain one transaction', async () => {
  const db = atomicFixture(), { context } = await attach(db, { mode: false })
  const legacyData = { customer, items: [data.items[0]] }
  const legacyOpts = { seasonId: previous, context, idempotencyKey: 'legacy-timeout', createdByEmail: 'owner@test.com' }
  const original = db.batch.bind(db), before = counts(db)
  let lost = true
  db.batch = async statements => { const result = await original(statements); if (lost) { lost = false; throw Error('Timed out after commit') } return result }
  const responses = await Promise.all(Array.from({ length: 4 }, () => checkoutQuickBill(db, legacyData, legacyOpts)))
  assert.ok(responses.every(result => result.ok), JSON.stringify(responses))
  assert.equal(new Set(responses.map(result => result.request.id)).size, 1)
  assert.equal(new Set(responses.map(result => result.quotation.id)).size, 1)
  assert.deepEqual(counts(db).map((count, index) => count - before[index]), [1, 1, 1, 1])
  const retry = await checkoutQuickBill(db, legacyData, legacyOpts)
  assert.equal(retry.idempotentReplay, true)
  assert.equal(retry.quotation.totalPaise, responses[0].quotation.totalPaise)
  const changed = await checkoutQuickBill(db, { ...legacyData, customer: { ...customer, name: 'Different' } }, legacyOpts)
  assert.equal(changed.status, 409)
  const separate = await checkoutQuickBill(db, legacyData, { ...legacyOpts, idempotencyKey: 'legacy-separate' })
  assert.equal(separate.ok, true); assert.notEqual(separate.request.id, retry.request.id)
  assert.equal((await checkoutQuickBill(db, legacyData, { ...legacyOpts, idempotencyKey: null })).status, 400)
})

test('legacy failed batch rolls back all checkout writes and retries safely', async () => {
  const db = atomicFixture(), { context } = await attach(db, { mode: false }), before = counts(db)
  const legacyOpts = { seasonId: previous, context, idempotencyKey: 'legacy-rollback' }
  db.beforeRun = sql => { if (sql.startsWith('INSERT INTO quotation_items')) throw Error('write interrupted') }
  assert.equal((await checkoutQuickBill(db, { customer, items: [data.items[0]] }, legacyOpts)).status, 503)
  assert.deepEqual(counts(db), before)
  db.beforeRun = null
  assert.equal((await checkoutQuickBill(db, { customer, items: [data.items[0]] }, legacyOpts)).ok, true)
})
