import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import {
  createPublicCustomerRequest,
  resolveRequestLines,
} from '../src/services/publicCustomerRequests.js'
import { createMockCustomerRequestDb } from './helpers/mockCustomerRequestDb.js'

const OTHER_SEASON_ID = 'season-2099'
const PUBLIC_SEASON_ID = DEFAULT_ADMIN_SEASON_ID

describe('public customer request season assignment', () => {
  it('stores public catalogue season_id on create', async () => {
    const db = createMockCustomerRequestDb({
      products: [{ id: 'P005', name: 'Gift', active: 1, stock_status: 'available' }],
    })
    const result = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210' },
        items: [{ productId: 'P005', quantity: 1 }],
      },
      { requestId: 'req-season-001', generateReference: async () => 'DWL-ABCDEFGH' },
    )
    assert.equal(result.ok, true)
    assert.equal(db.state.requests.get('req-season-001')?.season_id, PUBLIC_SEASON_ID)
  })

  it('returns 503 when public catalogue season is unset', async () => {
    const db = createMockCustomerRequestDb({
      publicSeasonId: null,
      products: [{ id: 'P005', name: 'Gift', active: 1, stock_status: 'available' }],
    })
    const result = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210' },
        items: [{ productId: 'P005', quantity: 1 }],
      },
      { requestId: 'req-no-season' },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 503)
    assert.equal(result.error, 'catalogue_unavailable')
    assert.equal(db.state.requests.size, 0)
  })

  it('returns 503 when public catalogue season is archived', async () => {
    const db = createMockCustomerRequestDb({
      publicSeasonStatus: 'archived',
      products: [{ id: 'P005', name: 'Gift', active: 1, stock_status: 'available' }],
    })
    const result = await createPublicCustomerRequest(
      db,
      {
        customer: { name: 'Ravi', mobile: '9876543210' },
        items: [{ productId: 'P005', quantity: 1 }],
      },
      { requestId: 'req-archived-season' },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 503)
    assert.equal(db.state.requests.size, 0)
  })

  it('rejects cross-season products in resolveRequestLines', async () => {
    const db = createMockCustomerRequestDb({
      products: [
        {
          id: 'P005',
          name: 'Other season product',
          active: 1,
          stock_status: 'available',
          season_id: OTHER_SEASON_ID,
        },
      ],
    })
    const result = await resolveRequestLines(db, [{ productId: 'P005', quantity: 1 }], PUBLIC_SEASON_ID)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.fields?.['items[0].productId'] ?? '', /not found/i)
  })

  it('rejects cross-season family packs for the same catalogue season', async () => {
    const db = createMockCustomerRequestDb({
      familyPacks: [
        {
          id: 'FP001',
          name: 'Other season pack',
          active: 1,
          selling_price_paise: 10_000,
          season_id: OTHER_SEASON_ID,
        },
      ],
    })
    const result = await resolveRequestLines(db, [{ familyPackId: 'FP001', quantity: 1 }], PUBLIC_SEASON_ID)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.fields?.['items[0].familyPackId'] ?? '', /not found/i)
  })

  it('POST /api/public/customer-requests returns 503 without public season', async () => {
    const db = createMockCustomerRequestDb({
      publicSeasonId: null,
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
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.error, 'catalogue_unavailable')
  })
})
