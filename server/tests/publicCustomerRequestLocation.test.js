import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixture, attach, season, previous, A, B } from './helpers/mockAdminTransactionDb.js'
import { createMockCustomerRequestDb } from './helpers/mockCustomerRequestDb.js'
import { preparePublicCustomerRequestWriter, PUBLIC_REQUEST_CONTEXT_SQL } from '../src/services/publicCustomerRequestContext.js'
import { createPublicCustomerRequest, createManualCustomerRequest, getPublicRequestSummary, ensurePublicReferenceOnRequest } from '../src/services/publicCustomerRequests.js'
import { handlePublicCustomerRequestPost } from '../src/routes/publicCustomerRequests.js'
import { checkoutQuickBill } from '../src/services/adminQuickBill.js'

const config = {
  ADMIN_LOCATION_MODE: 'true', PUBLIC_REQUEST_BUSINESS_ID: 'shop',
  PUBLIC_REQUEST_LOCATION_ID: 'loc-a', PUBLIC_REQUEST_SEASON_ID: season,
}
const customer = { name: 'Guest', mobile: '9876543210', area: 'Town', pickupPreference: 'pickup' }
const data = { customer, items: [{ productId: 'P001', quantity: 2 }, { familyPackId: 'FP001', quantity: 1 }] }
const meta = { requestId: 'new-public', generateReference: async () => 'DWL-ABCDEFGH' }

// Extend the in-memory transaction mock with foundation-row reads and guarded
// public inserts. No SQLite files, SQL execution, or Wrangler are involved.
function publicFixture() {
  const db = fixture()
  db.state.publicContexts = ['loc-a', 'loc-b'].flatMap(location_id => [season, previous].map(season_id => ({
    location_id, business_id: 'shop', season_id, operating_year: Number(season_id.slice(-4)),
    business_status: 'active', location_status: 'active', association_status: 'active', season_status: 'active',
  })))
  db.publicCalls = []
  const prepare = db.prepare.bind(db)
  db.prepare = sql => ({ bind(...v) {
    assert.equal((sql.match(/\?/g) ?? []).length, v.length, sql)
    db.publicCalls.push({ sql, values: v })
    if (sql === PUBLIC_REQUEST_CONTEXT_SQL) return { async all() {
      return { results: db.state.publicContexts.filter(r => r.location_id === v[0] && r.business_id === v[1] && r.season_id === v[2]) }
    } }
    const guarded = sql.startsWith('INSERT INTO customer_requests') && sql.includes('(SELECT ? FROM business_locations')
    const translated = guarded ? sql.replace(/\(SELECT \? FROM business_locations[\s\S]+?s.status = 'active'\)/, '?') : sql
    const statement = prepare(translated).bind(...(guarded ? [...v.slice(0, 11), ...v.slice(14)] : v))
    return { ...statement, async run() {
      if (guarded && !db.state.publicContexts.some(r => r.location_id === v[11] && r.business_id === v[12] && r.season_id === v[13] &&
        ['business_status', 'location_status', 'association_status', 'season_status'].every(key => r[key] === 'active'))) throw Error('NOT NULL constraint failed: customer_requests.source')
      if (/UPDATE customer_requests\s+SET public_reference/.test(sql)) {
        const request = db.state.customer_requests.find(r => r.id === v[1] && r.location_id === v[2] && r.season_id === v[3] && r.public_reference == null)
        if (request) request.public_reference = v[0]
        return { meta: { changes: request ? 1 : 0 } }
      }
      if (guarded && db.state.customer_requests.some(r => r.id === v[0])) throw Error('UNIQUE constraint failed: customer_requests.id')
      return statement.run()
    } }
  } })
  return db
}
function post(body = data, key) {
  return new Request('https://example.test/api/public/customer-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}), 'X-Admin-Location-Id': 'loc-b', 'X-Admin-Season-Id': 'season-2099' },
    body: JSON.stringify(body),
  })
}

describe('public customer-request location writer (mocked D1 only)', () => {
  it('preserves disabled-mode DB, season queries, public pricing and response shape', async () => {
    const db = createMockCustomerRequestDb({ products: [{ id: 'P001', name: 'A', active: 1, stock_status: 'available' }] })
    const off = { ADMIN_LOCATION_MODE: 'false', PUBLIC_REQUEST_LOCATION_ID: 'invalid' }
    assert.equal((await preparePublicCustomerRequestWriter(db, off)).db, db)
    const response = await handlePublicCustomerRequestPost(post({ customer, items: [data.items[0]] }), { DB: db, ...off })
    assert.equal(response.status, 201)
    const payload = await response.json()
    assert.deepEqual(Object.keys(payload).sort(), ['idempotentReplay', 'request'])
    assert.deepEqual(Object.keys(payload.request).sort(), ['createdAt', 'id', 'itemCount', 'publicReference', 'source', 'status'])
    assert.equal([...db.state.requests.values()][0].location_id, undefined)
  })

  it('stamps configured location/operating season while using older catalogue provenance', async () => {
    const db = publicFixture()
    const result = await createPublicCustomerRequest(db, data, meta, config)
    assert.equal(result.ok, true)
    const request = db.state.customer_requests.find(r => r.id === meta.requestId)
    assert.equal(request.location_id, 'loc-a'); assert.equal(request.season_id, season); assert.equal(request.source, 'web')
    const children = db.state.customer_request_items.filter(i => i.request_id === request.id)
    assert.equal(children.length, 2)
    assert.equal(children[0].unit_price_paise, null)
    assert.equal(children[1].unit_price_paise, 5000)
    assert.equal(result.request.itemCount, 2)
    assert.equal(db.state.products[0].season_id, previous)
    assert.ok(db.publicCalls.every(c => !/private_rates|product_purchase_rates|final_price_paise/.test(c.sql)))
    assert.ok(!('locationId' in result.request) && !('totalPaise' in result.request))
  })

  for (const key of ['PUBLIC_REQUEST_BUSINESS_ID', 'PUBLIC_REQUEST_LOCATION_ID', 'PUBLIC_REQUEST_SEASON_ID']) it(`rejects missing ${key} without reading or writing`, async () => {
    const db = publicFixture()
    const result = await createPublicCustomerRequest(db, data, meta, { ...config, [key]: '' })
    assert.equal(result.status, 503); assert.equal(db.publicCalls.length, 0)
  })

  it('rejects invalid gate, mismatched/unmapped selection, 2099, duplicates and schema failure', async () => {
    for (const override of [{ ADMIN_LOCATION_MODE: 'invalid' }, { PUBLIC_REQUEST_BUSINESS_ID: 'foreign' }, { PUBLIC_REQUEST_LOCATION_ID: 'unmapped' }, { PUBLIC_REQUEST_SEASON_ID: 'season-2099' }]) {
      const db = publicFixture(), before = structuredClone(db.state)
      assert.equal((await createPublicCustomerRequest(db, data, meta, { ...config, ...override })).status, 503)
      assert.deepEqual(db.state, before)
    }
    const db = publicFixture(); db.state.publicContexts.push({ ...db.state.publicContexts[0] })
    assert.equal((await createPublicCustomerRequest(db, data, meta, config)).status, 503)
    db.prepare = () => { throw Error('no such table: location_seasons') }
    const response = await handlePublicCustomerRequestPost(post(), { DB: db, ...config })
    assert.equal(response.status, 503)
    assert.ok(!(await response.text()).includes('location_seasons'))
  })

  for (const status of ['business_status', 'location_status', 'association_status', 'season_status']) it(`rejects archived ${status}`, async () => {
    const db = publicFixture(); db.state.publicContexts[0][status] = 'archived'
    assert.equal((await createPublicCustomerRequest(db, data, meta, config)).status, 503)
    assert.equal(db.state.customer_requests.length, 4)
  })

  it('rejects foreign product/pack IDs and ignores fabricated resolved prices/tenant selectors', async () => {
    const db = publicFixture()
    for (const item of [{ productId: 'P002', quantity: 1 }, { familyPackId: 'FP002', quantity: 1 }]) {
      assert.equal((await createPublicCustomerRequest(db, { customer, items: [item] }, meta, config)).error, 'validation_error')
    }
    assert.equal(db.state.customer_requests.length, 4)
    const response = await handlePublicCustomerRequestPost(post({ ...data, location_id: 'loc-b', business_id: 'other', season_id: 'season-2099' }), { DB: db, ...config })
    assert.equal(response.status, 201)
    assert.equal(db.state.customer_requests.at(-1).location_id, 'loc-a')
    const result = await createPublicCustomerRequest(db, data, { ...meta, resolvedLines: [{ productId: 'P002', productName: 'Forged', quantity: 1, unitPricePaise: 1 }] }, config)
    assert.equal(result.ok, true)
    assert.equal(db.state.customer_request_items.find(i => i.request_id === meta.requestId).product_id, 'P001')
  })

  it('isolates idempotent replays by configured location and operating season', async () => {
    const db = publicFixture(), key = 'public-location-replay-001'
    const first = await handlePublicCustomerRequestPost(post(data, key), { DB: db, ...config })
    assert.equal(first.status, 201)
    const firstId = (await first.json()).request.id
    const replay = await handlePublicCustomerRequestPost(post(data, key), { DB: db, ...config })
    assert.equal(replay.status, 200); assert.equal((await replay.json()).request.id, firstId)
    const other = await handlePublicCustomerRequestPost(post({ customer, items: [{ productId: 'P002', quantity: 1 }] }, key), { DB: db, ...config, PUBLIC_REQUEST_LOCATION_ID: 'loc-b' })
    assert.equal(other.status, 201); assert.notEqual((await other.json()).request.id, firstId)
    const nextSeason = await handlePublicCustomerRequestPost(post(data, key), { DB: db, ...config, PUBLIC_REQUEST_SEASON_ID: previous })
    assert.equal(nextSeason.status, 201); assert.notEqual((await nextSeason.json()).request.id, firstId)
  })

  it('never adopts unmapped catalogue records, even with a matching provenance season', async () => {
    const db = publicFixture()
    db.state.products[0].location_id = null
    db.state.products[0].season_id = season
    db.state.family_packs[0].location_id = null
    db.state.family_packs[0].season_id = season
    const before = structuredClone(db.state)
    const result = await createPublicCustomerRequest(db, data, meta, config)
    assert.equal(result.error, 'validation_error')
    assert.deepEqual(Object.keys(result.fields).sort(), ['items[0].productId', 'items[1].familyPackId'])
    assert.deepEqual(db.state, before)
  })

  it('retains enabled public input, availability and delivery-field behavior', async () => {
    const db = publicFixture()
    for (const payload of [
      { ...data, total: 1 },
      { customer, items: [{ ...data.items[0], unitRatePaise: 1 }] },
      { customer, items: [] },
    ]) assert.equal((await handlePublicCustomerRequestPost(post(payload), { DB: db, ...config })).status, 400)
    assert.equal(db.publicCalls.length, 0)
    db.state.products[0].active = 0
    assert.equal((await createPublicCustomerRequest(db, data, meta, config)).error, 'validation_error')
    db.state.products[0].active = 1; db.state.products[0].stock_status = 'soldout'
    assert.equal((await createPublicCustomerRequest(db, data, meta, config)).error, 'validation_error')
    db.state.products[0].stock_status = 'available'; db.state.family_packs[0].active = 0
    assert.equal((await createPublicCustomerRequest(db, data, meta, config)).error, 'validation_error')
    db.state.family_packs[0].active = 1
    const delivered = { ...data, customer: { ...customer, deliveryAddress: 'A street', deliveryLandmark: 'A landmark', deliveryMapsUrl: 'https://maps.google.com/?q=Town' } }
    assert.equal((await handlePublicCustomerRequestPost(post(delivered), { DB: db, ...config })).status, 201)
    assert.equal(db.state.customer_requests.at(-1).delivery_address, 'A street')
    assert.equal(db.state.customer_requests.at(-1).delivery_landmark, 'A landmark')
  })

  it('scopes summary, reference repair and uniqueness-race replays to owned parents', async () => {
    const db = publicFixture(), writer = await preparePublicCustomerRequestWriter(db, config)
    assert.equal(await getPublicRequestSummary(writer.db, B), null)
    assert.equal(await ensurePublicReferenceOnRequest(writer.db, B, meta.generateReference), null)
    db.state.customer_requests[0].public_reference = null
    assert.equal((await ensurePublicReferenceOnRequest(writer.db, A, meta.generateReference)).publicReference, 'DWL-ABCDEFGH')
    const foreign = await createPublicCustomerRequest(db, data, { ...meta, requestId: B }, config)
    assert.equal(foreign.ok, false); assert.ok(!foreign.request)
  })

  it('rolls back parent and children on context archival or reference movement before batch', async () => {
    for (const change of [state => { state.publicContexts[0].association_status = 'archived' }, state => { state.products[0].location_id = 'loc-b' }, state => { state.family_packs[0].location_id = 'loc-b' }]) {
      const db = publicFixture(), count = db.state.customer_requests.length, itemCount = db.state.customer_request_items.length
      db.beforeBatch = change
      assert.equal((await createPublicCustomerRequest(db, data, meta, config)).ok, false)
      assert.equal(db.state.customer_requests.length, count); assert.equal(db.state.customer_request_items.length, itemCount)
    }
  })

  it('requires admin context for enabled manual writes and preserves Quick Bill ownership', async () => {
    const db = publicFixture()
    await assert.rejects(createManualCustomerRequest(db, data, { ...meta, seasonId: season }, config), error => error.code === 'location_context_unavailable')
    const publicWriter = await preparePublicCustomerRequestWriter(db, config)
    assert.equal((await createManualCustomerRequest(publicWriter.db, data, { ...meta, seasonId: season })).status, 403)
    const { context } = await attach(db)
    const manual = await createManualCustomerRequest(db, data, { ...meta, seasonId: season, context }, { ...config, PUBLIC_REQUEST_LOCATION_ID: 'loc-b', PUBLIC_REQUEST_SEASON_ID: previous })
    assert.equal(manual.ok, true)
    const request = db.state.customer_requests.find(r => r.id === meta.requestId)
    assert.equal(request.source, 'manual'); assert.equal(request.location_id, 'loc-a'); assert.equal(request.season_id, season)
    await assert.rejects(createManualCustomerRequest(db, data, { ...meta, seasonId: previous, context }, config), e => e.status === 403)
    await assert.rejects(createManualCustomerRequest(db, data, { ...meta, seasonId: season, context, resolvedLines: [{ productId: 'P002', quantity: 1 }] }, config), e => e.code === 'request_ownership_mismatch')
    const quickBill = await checkoutQuickBill(db, { customer, items: [data.items[0]] }, { context, seasonId: season, idempotencyKey: 'manual-checkout' })
    assert.equal(quickBill.ok, true)
    assert.equal(db.state.customer_requests.find(r => r.id === quickBill.request.id).location_id, 'loc-a')
  })
})
