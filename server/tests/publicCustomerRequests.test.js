import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { createMockCustomerRequestDb } from './helpers/mockCustomerRequestDb.js'
import { validateCustomerRequestBody, normalizeIdempotencyKey } from '../src/lib/customerRequestValidation.js'
import { isValidPublicReference } from '../src/lib/customerRequestPublicReference.js'
import {
  RESOLVE_REQUEST_PRODUCTS_SQL,
  createPublicCustomerRequest,
  deriveRequestIdFromIdempotencyKey,
  ensurePublicReferenceOnRequest,
  mapPublicRequestSummary,
} from '../src/services/publicCustomerRequests.js'

const TEST_PUBLIC_REFERENCE = 'DWL-23456789'
async function fixedTestReference() {
  return TEST_PUBLIC_REFERENCE
}
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

  it('rejects client-supplied public reference fields', () => {
    const body = validateCustomerRequestBody({
      customer: { name: 'Ravi Kumar', mobile: '9876543210' },
      items: [{ productId: 'P001', quantity: 1 }],
      publicReference: 'DWL-23456789',
    })
    assert.equal(body.ok, false)
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
    assert.equal(mapped.publicReference, null)
  })

  it('maps public_reference to publicReference', () => {
    const mapped = mapPublicRequestSummary(
      {
        id: 'cr-abc',
        public_reference: 'DWL-ABCDEFGH',
        status: 'received',
        source: 'web',
        created_at: '2026-01-01 00:00:00',
      },
      1,
    )
    assert.equal(mapped.publicReference, 'DWL-ABCDEFGH')
  })
})

describe('public customer request service (in-memory D1 mock)', () => {
  it('creates request and items in one batch', async () => {
    const db = createMockDb({
      products: [{ id: 'P005', name: 'Test Product', active: 1, stock_status: 'available' }],
    })
    const requestId = 'test-req-001'
    const result = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ productId: 'P005', quantity: 3 }],
      },
      { requestId, generateReference: fixedTestReference },
    )
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.request.itemCount, 1)
      assert.equal(result.request.status, 'received')
      assert.equal(result.request.publicReference, TEST_PUBLIC_REFERENCE)
      assert.equal(isValidPublicReference(result.request.publicReference), true)
    }
    assert.equal(db.batchCalls, 1)
    assert.equal(db.state.requests.get(requestId)?.status, 'received')
    assert.equal(db.state.requests.get(requestId)?.public_reference, TEST_PUBLIC_REFERENCE)
    assert.equal(db.state.items.length, 1)
  })

  it('accepts web requests without delivery location regardless of qualifying total', async () => {
    const db = createMockDb({
      products: [{ id: 'P001', name: 'Premium', active: 1, stock_status: 'available' }],
    })
    const result = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210' },
        items: [{ productId: 'P001', quantity: 1 }],
      },
      { requestId: 'test-req-no-delivery-location', generateReference: fixedTestReference },
    )
    assert.equal(result.ok, true)
  })

  it('retries reference generation on unique collision and succeeds', async () => {
    const db = createMockDb({
      products: [{ id: 'P005', name: 'Test Product', active: 1, stock_status: 'available' }],
      rejectPublicReferences: new Set([TEST_PUBLIC_REFERENCE]),
    })
    let calls = 0
    const result = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ productId: 'P005', quantity: 1 }],
      },
      {
        requestId: 'test-req-collision',
        generateReference: async () => {
          calls += 1
          return calls === 1 ? TEST_PUBLIC_REFERENCE : 'DWL-3456789A'
        },
      },
    )
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.request.publicReference, 'DWL-3456789A')
    }
    assert.equal(calls, 2)
    assert.equal(db.batchCalls, 2)
  })

  it('returns reference_generation_failed when collisions are exhausted', async () => {
    const db = createMockDb({
      products: [{ id: 'P005', name: 'Test Product', active: 1, stock_status: 'available' }],
      rejectPublicReferences: new Set([TEST_PUBLIC_REFERENCE]),
    })
    const result = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ productId: 'P005', quantity: 1 }],
      },
      {
        requestId: 'test-req-exhausted',
        generateReference: fixedTestReference,
      },
    )
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, 'reference_generation_failed')
    }
    assert.equal(db.state.requests.size, 0)
    assert.equal(db.state.items.length, 0)
  })

  it('assigns public reference on legacy request missing public_reference', async () => {
    const db = createMockDb({
      products: [{ id: 'P001', name: 'Test Product', active: 1, stock_status: 'available' }],
    })
    const requestId = 'legacy-req-001'
    db.state.requests.set(requestId, {
      id: requestId,
      public_reference: null,
      status: 'received',
      source: 'web',
      customer_name: 'Ravi',
      customer_phone: '9876543210',
      customer_area: null,
      pickup_preference: null,
      customer_note: null,
      created_at: '2026-10-15 00:00:00',
      updated_at: '2026-10-15 00:00:00',
    })
    db.state.items.push({
      request_id: requestId,
      line_number: 1,
      product_id: 'P001',
      family_pack_id: null,
      product_name: 'Test Product',
      quantity: 1,
      unit_price_paise: null,
    })

    const ensured = await ensurePublicReferenceOnRequest(db, requestId, fixedTestReference)
    assert.ok(ensured && !('ok' in ensured))
    assert.equal(ensured.publicReference, TEST_PUBLIC_REFERENCE)
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
      products: [{ id: 'P005', name: 'Gift', active: 1, stock_status: 'available' }],
    })
    const res = await worker.fetch(
      new Request('https://example.com/api/public/customer-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: { name: 'Ravi Kumar', mobile: '9876543210' },
          items: [{ productId: 'P005', quantity: 1 }],
        }),
      }),
      { DB: db },
      {},
    )
    assert.equal(res.status, 201)
    const body = await res.json()
    assert.equal(body.request.status, 'received')
    assert.equal(body.request.itemCount, 1)
    assert.match(String(body.request.publicReference ?? ''), /^DWL-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
    assert.equal('unit_rate_paise' in body.request, false)
  })

  it('replays idempotent submission with same Idempotency-Key', async () => {
    const db = createMockDb({
      products: [{ id: 'P005', name: 'Gift', active: 1, stock_status: 'available' }],
    })
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'client-key-12345',
    }
    const payload = {
      customer: { name: 'Ravi Kumar', mobile: '9876543210' },
      items: [{ productId: 'P005', quantity: 1 }],
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
    assert.equal(body2.request.publicReference, body1.request.publicReference)
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
  return createMockCustomerRequestDb(opts)
}
