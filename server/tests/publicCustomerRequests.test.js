import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { validateCustomerRequestBody, normalizeIdempotencyKey } from '../src/lib/customerRequestValidation.js'
import {
  RESOLVE_REQUEST_PRODUCTS_SQL,
  createPublicCustomerRequest,
  deriveRequestIdFromIdempotencyKey,
  mapPublicRequestSummary,
} from '../src/services/publicCustomerRequests.js'
describe('customer request validation', () => {
  const validBody = {
    customer: { name: 'Ravi Kumar', mobile: '9876543210', area: 'Chennai', note: '' },
    items: [{ productId: 'P001', quantity: 2 }],
  }

  it('accepts a minimal valid payload', () => {
    const result = validateCustomerRequestBody(validBody)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.data.customer.mobile, '9876543210')
      assert.equal(result.data.items.length, 1)
    }
  })

  it('rejects missing customer and empty items', () => {
    const r1 = validateCustomerRequestBody({ items: [] })
    assert.equal(r1.ok, false)
    const r2 = validateCustomerRequestBody({ customer: { name: 'A', mobile: '9876543210' }, items: [] })
    assert.equal(r2.ok, false)
    if (!r2.ok) assert.ok(r2.errors.items)
  })

  it('rejects invalid mobile and quantities', () => {
    const r = validateCustomerRequestBody({
      customer: { name: 'Ravi Kumar', mobile: '123' },
      items: [{ productId: 'P001', quantity: 0 }],
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.ok(r.errors['customer.mobile'])
      assert.ok(r.errors['items[0].quantity'])
    }
  })

  it('rejects unknown product ids and duplicate lines', () => {
    const badId = validateCustomerRequestBody({
      customer: { name: 'Ravi Kumar', mobile: '9876543210' },
      items: [{ productId: 'BAD', quantity: 1 }],
    })
    assert.equal(badId.ok, false)

    const dup = validateCustomerRequestBody({
      customer: { name: 'Ravi Kumar', mobile: '9876543210' },
      items: [
        { productId: 'P001', quantity: 1 },
        { productId: 'P001', quantity: 2 },
      ],
    })
    assert.equal(dup.ok, false)
  })

  it('rejects client-supplied price and total fields', () => {
    const body = validateCustomerRequestBody({
      customer: { name: 'Ravi Kumar', mobile: '9876543210' },
      items: [{ productId: 'P001', quantity: 1, price: 100, unitRatePaise: 9999 }],
      subtotal: 500,
    })
    assert.equal(body.ok, false)
    if (!body.ok) {
      const joined = JSON.stringify(body.errors)
      assert.match(joined, /price|unitRatePaise|subtotal/i)
    }
  })
})

describe('public customer request SQL separation', () => {
  it('product resolve SQL does not reference private_rates', () => {
    const sql = RESOLVE_REQUEST_PRODUCTS_SQL.toLowerCase()
    assert.ok(!sql.includes('private_rates'))
    assert.ok(!sql.includes('unit_rate'))
    assert.ok(!sql.includes('paise'))
  })

  it('public response shape omits rate fields', () => {
    const mapped = mapPublicRequestSummary(
      { id: 'cr-abc', status: 'received', source: 'web', created_at: '2026-01-01 00:00:00' },
      2,
    )
    assert.equal('unit_rate_paise' in mapped, false)
    assert.equal('price' in mapped, false)
    assert.equal('x4' in mapped, false)
    assert.ok('id' in mapped && 'status' in mapped && 'itemCount' in mapped)
  })
})

describe('public customer request service (in-memory D1 mock)', () => {
  it('creates request and items in one batch', async () => {
    const db = createMockDb({
      products: [{ id: 'P001', name: 'Test Product', active: 1, stock_status: 'available' }],
    })
    const requestId = 'test-req-001'
    const result = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ productId: 'P001', quantity: 3 }],
      },
      { requestId },
    )
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.request.itemCount, 1)
      assert.equal(result.request.status, 'received')
    }
    assert.equal(db.batchCalls, 1)
    assert.equal(db.state.requests.get(requestId)?.status, 'received')
    assert.equal(db.state.items.length, 1)
  })

  it('rejects inactive and sold-out products', async () => {
    const db = createMockDb({
      products: [
        { id: 'P001', name: 'Inactive', active: 0, stock_status: 'available' },
        { id: 'P002', name: 'Sold', active: 1, stock_status: 'soldout' },
      ],
    })
    const r1 = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ productId: 'P001', quantity: 1 }],
      },
      { requestId: 'test-req-002' },
    )
    assert.equal(r1.ok, false)

    const r2 = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ productId: 'P002', quantity: 1 }],
      },
      { requestId: 'test-req-003' },
    )
    assert.equal(r2.ok, false)
    assert.equal(db.state.requests.size, 0)
  })

  it('does not leave partial data when batch fails mid-way', async () => {
    const db = createMockDb({
      products: [
        { id: 'P001', name: 'A', active: 1, stock_status: 'available' },
        { id: 'P002', name: 'B', active: 1, stock_status: 'available' },
      ],
      failOnItemLine: 2,
    })
    const result = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [
          { productId: 'P001', quantity: 1 },
          { productId: 'P002', quantity: 1 },
        ],
      },
      { requestId: 'test-req-004' },
    )
    assert.equal(result.ok, false)
    assert.equal(db.state.requests.size, 0)
    assert.equal(db.state.items.length, 0)
  })
})

describe('POST /api/public/customer-requests (worker + mock DB)', () => {
  it('returns 201 for valid submission without auth', async () => {
    const db = createMockDb({
      products: [{ id: 'P001', name: 'Gift', active: 1, stock_status: 'available' }],
    })
    const res = await worker.fetch(
      new Request('https://example.com/api/public/customer-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: { name: 'Ravi Kumar', mobile: '9876543210' },
          items: [{ productId: 'P001', quantity: 1 }],
        }),
      }),
      { DB: db },
      {},
    )
    assert.equal(res.status, 201)
    const body = await res.json()
    assert.equal(body.request.status, 'received')
    assert.equal(body.request.itemCount, 1)
    assert.equal('unit_rate_paise' in body.request, false)
  })

  it('replays idempotent submission with same Idempotency-Key', async () => {
    const db = createMockDb({
      products: [{ id: 'P001', name: 'Gift', active: 1, stock_status: 'available' }],
    })
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'client-key-12345',
    }
    const payload = {
      customer: { name: 'Ravi Kumar', mobile: '9876543210' },
      items: [{ productId: 'P001', quantity: 1 }],
    }
    const res1 = await worker.fetch(
      new Request('https://example.com/api/public/customer-requests', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
      { DB: db },
      {},
    )
    assert.equal(res1.status, 201)
    const body1 = await res1.json()

    const res2 = await worker.fetch(
      new Request('https://example.com/api/public/customer-requests', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
      { DB: db },
      {},
    )
    assert.equal(res2.status, 200)
    const body2 = await res2.json()
    assert.equal(body2.idempotentReplay, true)
    assert.equal(body2.request.id, body1.request.id)
    assert.equal(db.batchCalls, 1)
  })

  it('returns 400 for malformed JSON', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/public/customer-requests', {
        method: 'POST',
        body: '{not-json',
      }),
      { DB: createMockDb({ products: [] }) },
      {},
    )
    assert.equal(res.status, 400)
  })
})

describe('idempotency key helper', () => {
  it('normalizes safe keys and derives stable request ids', async () => {
    assert.equal(normalizeIdempotencyKey(' abc-123 '), 'abc-123')
    assert.equal(normalizeIdempotencyKey('bad key!'), null)
    const id1 = await deriveRequestIdFromIdempotencyKey('same-key')
    const id2 = await deriveRequestIdFromIdempotencyKey('same-key')
    assert.equal(id1, id2)
    assert.match(id1, /^cr-[a-f0-9]{32}$/)
  })
})

/** @param {{ products: object[], failOnItemLine?: number }} opts */
function createMockDb(opts) {
  const products = new Map(opts.products.map((p) => [p.id, p]))
  const state = {
    requests: new Map(),
    items: /** @type {{ request_id: string, line_number: number, product_id: string, product_name: string, quantity: number }[]} */ ([]),
  }
  let batchCalls = 0
  let itemInsertCount = 0

  const db = {
    batchCalls: 0,
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          const stmt = {
            _sql: normalized,
            _params: params,
            async first() {
              if (normalized.includes('FROM products WHERE id')) {
                return products.get(String(params[0])) ?? null
              }
              if (normalized.includes('FROM customer_requests WHERE id')) {
                return state.requests.get(String(params[0])) ?? null
              }
              if (normalized.includes('COUNT(*) AS n FROM customer_request_items')) {
                const n = state.items.filter((i) => i.request_id === params[0]).length
                return { n }
              }
              return null
            },
            async all() {
              return { results: [] }
            },
            async run() {
              return { meta: { changes: 1 } }
            },
          }
          return stmt
        },
      }
    },
    async batch(statements) {
      batchCalls += 1
      db.batchCalls = batchCalls
      const snap = {
        requests: new Map(state.requests),
        items: [...state.items],
      }
      itemInsertCount = 0
      try {
        for (const stmt of statements) {
          const sql = stmt._sql
          const params = stmt._params
          if (sql.startsWith('INSERT INTO customer_requests')) {
            const [id, name, phone, area, pickup, note, source = 'web'] = params
            if (state.requests.has(id)) {
              throw new Error('UNIQUE constraint failed: customer_requests.id')
            }
            state.requests.set(id, {
              id,
              status: 'received',
              source,
              customer_name: name,
              customer_phone: phone,
              customer_area: area,
              pickup_preference: pickup,
              customer_note: note,
              created_at: '2026-10-15 00:00:00',
            })
          } else if (sql.startsWith('INSERT INTO customer_request_items')) {
            itemInsertCount += 1
            if (opts.failOnItemLine && itemInsertCount === opts.failOnItemLine) {
              throw new Error('SIMULATED_ITEM_INSERT_FAILURE')
            }
            const [requestId, lineNumber, productId, productName, quantity] = params
            state.items.push({ request_id: requestId, line_number: lineNumber, product_id: productId, product_name: productName, quantity })
          }
        }
      } catch (err) {
        state.requests = snap.requests
        state.items = snap.items
        throw err
      }
    },
  }

  return db
}
