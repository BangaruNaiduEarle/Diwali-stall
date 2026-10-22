import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { getAdminCustomerRequestById } from '../src/services/adminCustomerRequests.js'
import { buildQuoteLinesForRequestItems } from '../src/services/adminQuotations.js'
import {
  createPublicCustomerRequest,
  resolveRequestLines,
} from '../src/services/publicCustomerRequests.js'
import { createMockCustomerRequestDb } from './helpers/mockCustomerRequestDb.js'

const baseProducts = [
  { id: 'P001', name: 'Gift Box', active: 1, stock_status: 'available' },
  { id: 'P002', name: 'Inactive', active: 0, stock_status: 'available' },
]
const baseFamilyPacks = [
  { id: 'FP001', name: 'Budget Pack', active: 1, selling_price_paise: 50_000 },
  { id: 'FP002', name: 'Off Shelf', active: 0, selling_price_paise: 10_000 },
]

function workflowDb(overrides = {}) {
  return createMockCustomerRequestDb({
    products: baseProducts,
    familyPacks: baseFamilyPacks,
    privateRates: new Map([['P001', 169_400]]),
    ...overrides,
  })
}

describe('mixed estimate → D1 → admin', () => {
  it('persists product-only, family-pack-only, and mixed lines with pack price snapshot', async () => {
    const db = workflowDb()

    const mixed = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Meera', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [
          { productId: 'P001', quantity: 2 },
          { familyPackId: 'FP001', quantity: 1 },
        ],
      },
      { requestId: 'req-mixed-001' },
    )
    assert.equal(mixed.ok, true)
    assert.equal(db.state.items.length, 2)

    const detail = await getAdminCustomerRequestById(db, 'req-mixed-001')
    assert.ok(detail)
    assert.equal(detail.items.length, 2)
    const productLine = detail.items.find((l) => l.productId === 'P001')
    const packLine = detail.items.find((l) => l.familyPackId === 'FP001')
    assert.ok(productLine)
    assert.ok(packLine)
    assert.equal(productLine.lineType, 'product')
    assert.equal(packLine.lineType, 'family_pack')
    assert.equal(packLine.unitPricePaise, 50_000)
    assert.equal(packLine.productName, 'Budget Pack')
    assert.equal(productLine.unitPricePaise, null)

    const packOnly = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Meera', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ familyPackId: 'FP001', quantity: 3 }],
      },
      { requestId: 'req-pack-only' },
    )
    assert.equal(packOnly.ok, true)
    assert.equal((await getAdminCustomerRequestById(db, 'req-pack-only'))?.items.length, 1)

    const productOnly = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Meera', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ productId: 'P001', quantity: 1 }],
      },
      { requestId: 'req-product-only' },
    )
    assert.equal(productOnly.ok, true)
    assert.equal((await getAdminCustomerRequestById(db, 'req-product-only'))?.items[0].lineType, 'product')
  })

  it('rejects deactivated family pack and inactive product on forged API payload', async () => {
    const db = workflowDb()
    const badProduct = await resolveRequestLines(db, [{ productId: 'P002', quantity: 1 }])
    assert.equal(badProduct.ok, false)
    const badPack = await resolveRequestLines(db, [{ familyPackId: 'FP002', quantity: 1 }])
    assert.equal(badPack.ok, false)
  })

  it('builds quotation from two billable lines only (pack contents not expanded)', async () => {
    const db = workflowDb()
    await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Meera', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [
          { productId: 'P001', quantity: 1 },
          { familyPackId: 'FP001', quantity: 2 },
        ],
      },
      { requestId: 'req-quote-001' },
    )

    const itemsResult = await db
      .prepare(
        `SELECT line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise
         FROM customer_request_items WHERE request_id = ? ORDER BY line_number ASC`,
      )
      .bind('req-quote-001')
      .all()

    assert.equal(itemsResult.results?.length, 2)
    const built = await buildQuoteLinesForRequestItems(db, itemsResult.results ?? [])
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.equal(built.quoteLines.length, 2)
    const packQuote = built.quoteLines.find((l) => l.product_name === 'Budget Pack')
    assert.ok(packQuote)
    assert.equal(packQuote.unit_rate_paise, 50_000)
    assert.equal(packQuote.line_total_paise, 100_000)
    assert.equal(packQuote.product_id, null)
    assert.equal(built.totalPaise, 169_400 + 100_000)
  })

  it('keeps historical pack unit_price_paise after catalogue price increases', async () => {
    const db = workflowDb()
    await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Meera', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ familyPackId: 'FP001', quantity: 1 }],
      },
      { requestId: 'req-snapshot' },
    )
    db.state.familyPacks.get('FP001').selling_price_paise = 99_999

    const itemsResult = await db
      .prepare(
        `SELECT line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise
         FROM customer_request_items WHERE request_id = ?`,
      )
      .bind('req-snapshot')
      .all()
    const built = await buildQuoteLinesForRequestItems(db, itemsResult.results ?? [])
    assert.equal(built.ok, true)
    if (built.ok) assert.equal(built.quoteLines[0].unit_rate_paise, 50_000)
  })

  it('replays mixed estimate idempotently via worker Idempotency-Key', async () => {
    const db = workflowDb()
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'mixed-est-key-001',
    }
    const payload = {
      customer: { name: 'Meera', mobile: '9876543210' },
      items: [
        { productId: 'P001', quantity: 1 },
        { familyPackId: 'FP001', quantity: 1 },
      ],
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
    assert.equal(body1.request.itemCount, 2)

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
    assert.equal(db.state.items.length, 2)
  })
})
