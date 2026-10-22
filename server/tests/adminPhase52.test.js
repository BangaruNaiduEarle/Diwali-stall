import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { PUBLIC_PRODUCT_LIST_SQL } from '../src/services/publicProducts.js'
import { lineTotalPaise } from '../src/services/money.js'
import {
  createOrGetQuotationForRequest,
  getQuotationById,
} from '../src/services/adminQuotations.js'
import { upsertCurrentPrivateRate } from '../src/services/adminPrivateRates.js'
import { upsertCurrentPurchaseRate } from '../src/services/adminPurchaseRates.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const ALLOWED_EMAIL = 'owner@example.com'
const REQUEST_ID = '11111111-1111-4111-8111-111111111111'

describe('Phase 5.2 purchase vs X4 selling separation', () => {
  it('public product SQL excludes purchase and private rate tables', () => {
    const sql = PUBLIC_PRODUCT_LIST_SQL.toLowerCase()
    assert.ok(!sql.includes('private_rates'))
    assert.ok(!sql.includes('product_purchase_rates'))
  })

  it('updates purchase and X4 selling rates independently', async () => {
    const db = createPhase52MockDb()
    await upsertCurrentPrivateRate(db, 'P001', 169400)
    await upsertCurrentPurchaseRate(db, 'P001', 42350)
    assert.equal(db.state.rates.get('P001'), 169400)
    assert.equal(db.state.purchaseRates.get('P001'), 42350)

    await upsertCurrentPurchaseRate(db, 'P001', 50000)
    assert.equal(db.state.rates.get('P001'), 169400)
    assert.equal(db.state.purchaseRates.get('P001'), 50000)

    await upsertCurrentPrivateRate(db, 'P001', 170000)
    assert.equal(db.state.rates.get('P001'), 170000)
    assert.equal(db.state.purchaseRates.get('P001'), 50000)
  })

  it('quotation totals use X4 selling rate only, not purchase cost', async () => {
    const db = createPhase52MockDb()
    await upsertCurrentPrivateRate(db, 'P001', 169400)
    await upsertCurrentPurchaseRate(db, 'P001', 100)
    const result = await createOrGetQuotationForRequest(db, REQUEST_ID)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(Number(result.quotation.items[0].unitRatePaise), 169400)
    assert.equal(
      Number(result.quotation.items[0].lineTotalPaise),
      lineTotalPaise(2, 169400),
    )

    await upsertCurrentPurchaseRate(db, 'P001', 999999)
    const reloaded = await getQuotationById(db, result.quotation.id)
    assert.equal(Number(reloaded?.items[0].unitRatePaise), 169400)
  })

  it('regenerate rolls back void when batch insert fails', async () => {
    const db = createPhase52MockDb()
    const first = await createOrGetQuotationForRequest(db, REQUEST_ID)
    assert.equal(first.ok, true)
    if (!first.ok) return
    const oldId = first.quotation.id
    db.state.batchFailOn = 'INSERT INTO quotation_items'

    await assert.rejects(
      () => createOrGetQuotationForRequest(db, REQUEST_ID, { regenerate: true }),
      /injected quotation_items failure/,
    )

    const oldQuote = await getQuotationById(db, oldId)
    assert.equal(oldQuote?.status, 'draft')
    const active = db.state.quotations.get(oldId)
    assert.equal(active?.status, 'draft')
    assert.equal([...db.state.quotations.values()].filter((q) => q.status !== 'void').length, 1)
  })

  it('rejects a second active quotation for the same request (mock UNIQUE)', async () => {
    const db = createPhase52MockDb()
    db.state.enforceOneActiveQuotation = true
    await createOrGetQuotationForRequest(db, REQUEST_ID)
    const dupId = crypto.randomUUID()
    await assert.rejects(
      () =>
        db.batch([
          db
            .prepare(
              `INSERT INTO quotations (
          id, customer_request_id, status, customer_name, customer_phone, customer_note,
          subtotal_paise, adjustment_paise, total_paise, wa_message_text, created_by_email, updated_at
        ) VALUES (?, ?, 'draft', ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))`,
            )
            .bind(dupId, REQUEST_ID, 'A', '9', null, 0, 0, 'x', null),
        ]),
      /UNIQUE constraint failed.*quotations/,
    )
  })

  it('purchase-rate admin route requires auth', async () => {
    const db = createPhase52MockDb()
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/products/P001/purchase-rate', { method: 'PUT' }),
      { DB: db },
      {},
    )
    assert.ok(res.status === 401 || res.status === 503)
  })

  it('authenticated purchase-rate PUT does not change X4 selling rate', async () => {
    const db = createPhase52MockDb()
    db.state.rates.set('P001', 169400)
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL },
      { email: ALLOWED_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/products/P001/purchase-rate', {
        method: 'PUT',
        headers: {
          'Cf-Access-Jwt-Assertion': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ purchaseRateInr: 423.5 }),
      }),
      {
        DB: db,
        ADMIN_LOCAL_DEV_AUTH: '1',
        ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
        ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL,
      },
      {},
    )
    assert.equal(res.status, 200)
    assert.equal(db.state.rates.get('P001'), 169400)
    assert.equal(db.state.purchaseRates.get('P001'), 42350)
  })
})

function clonePhase52State(state) {
  return {
    products: new Map([...state.products.entries()].map(([k, v]) => [k, { ...v }])),
    categories: new Map(state.categories),
    rates: new Map(state.rates),
    purchaseRates: new Map(state.purchaseRates),
    rateHistory: [...state.rateHistory],
    purchaseHistory: [...state.purchaseHistory],
    requests: new Map([...state.requests.entries()].map(([k, v]) => [k, { ...v }])),
    requestItems: state.requestItems.map((i) => ({ ...i })),
    quotations: new Map([...state.quotations.entries()].map(([k, v]) => [k, { ...v }])),
    quotationItems: state.quotationItems.map((i) => ({ ...i })),
    batchFailOn: state.batchFailOn,
    enforceOneActiveQuotation: state.enforceOneActiveQuotation,
  }
}

function restorePhase52State(state, snapshot) {
  state.products = snapshot.products
  state.categories = snapshot.categories
  state.rates = snapshot.rates
  state.purchaseRates = snapshot.purchaseRates
  state.rateHistory = snapshot.rateHistory
  state.purchaseHistory = snapshot.purchaseHistory
  state.requests = snapshot.requests
  state.requestItems = snapshot.requestItems
  state.quotations = snapshot.quotations
  state.quotationItems = snapshot.quotationItems
  state.batchFailOn = snapshot.batchFailOn
  state.enforceOneActiveQuotation = snapshot.enforceOneActiveQuotation
}

function createPhase52MockDb() {
  const state = {
    products: new Map([
      [
        'P001',
        {
          id: 'P001',
          category_slug: 'gift-boxes',
          name: 'EMERALD GIFT BOX',
          active: 1,
          stock_status: 'available',
          selling_price_paise: null,
          sort_order: 1,
          images_json: '[]',
          pack: '',
          description: '',
          featured: 0,
          company: null,
        },
      ],
    ]),
    categories: new Map([['gift-boxes', { slug: 'gift-boxes', label: 'Gift Boxes' }]]),
    rates: new Map([['P001', 169400]]),
    purchaseRates: new Map(),
    rateHistory: [],
    purchaseHistory: [],
    requests: new Map([
      [
        REQUEST_ID,
        {
          id: REQUEST_ID,
          status: 'received',
          customer_name: 'Test',
          customer_phone: '9876543210',
          customer_note: null,
          pickup_preference: null,
        },
      ],
    ]),
    requestItems: [
      {
        request_id: REQUEST_ID,
        line_number: 1,
        product_id: 'P001',
        product_name: 'EMERALD GIFT BOX',
        quantity: 2,
      },
    ],
    quotations: new Map(),
    quotationItems: [],
    batchFailOn: null,
    enforceOneActiveQuotation: false,
  }

  const db = {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      const makeStmt = (params) => ({
        bind(...next) {
          return makeStmt(next.length ? next : params)
        },
        async first() {
          if (normalized.includes('FROM admin_users WHERE lower(email)')) {
            if (String(params[0]).toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) return null
            return {
              id: 'u-owner',
              email: ALLOWED_EMAIL,
              display_name: 'Owner',
              role: 'owner',
              password_hash: 'x',
              disabled_at: null,
            }
          }
          if (normalized.includes('FROM products WHERE id = ?')) {
            const p = state.products.get(String(params[0]))
            if (!p) return null
            return { id: p.id, name: p.name, active: p.active }
          }
          if (normalized.includes('FROM private_rates') && normalized.includes('effective_to IS NULL')) {
            const paise = state.rates.get(String(params[0]))
            return paise == null ? null : { id: 1, product_id: params[0], unit_rate_paise: paise, effective_to: null }
          }
          if (normalized.includes('FROM product_purchase_rates') && normalized.includes('effective_to IS NULL')) {
            const paise = state.purchaseRates.get(String(params[0]))
            return paise == null
              ? null
              : { id: 1, product_id: params[0], unit_rate_paise: paise, effective_to: null, notes: null }
          }
          if (normalized.includes('FROM customer_requests') && normalized.includes('WHERE id = ?')) {
            return state.requests.get(String(params[0])) ?? null
          }
          if (normalized.includes('FROM quotations') && normalized.includes('customer_request_id = ?')) {
            for (const q of state.quotations.values()) {
              if (q.customer_request_id === params[0] && q.status !== 'void') return q
            }
            return null
          }
          if (normalized.includes('FROM quotations WHERE id = ?')) {
            return state.quotations.get(String(params[0])) ?? null
          }
          return null
        },
        async all() {
          if (normalized.includes('FROM customer_request_items')) {
            return { results: state.requestItems.filter((i) => i.request_id === params[0]) }
          }
          if (normalized.includes('FROM quotation_items')) {
            return { results: state.quotationItems.filter((i) => i.quotation_id === params[0]) }
          }
          return { results: [] }
        },
        async run() {
          if (normalized.includes('UPDATE private_rates') && normalized.includes('effective_to')) {
            state.rateHistory.push({ product_id: params[0], paise: state.rates.get(params[0]) })
            return { meta: { changes: 1 } }
          }
          if (normalized.startsWith('INSERT INTO private_rates')) {
            state.rates.set(params[0], params[1])
            return { meta: { changes: 1 } }
          }
          if (normalized.includes('UPDATE product_purchase_rates') && normalized.includes('effective_to')) {
            state.purchaseHistory.push({ product_id: params[0], paise: state.purchaseRates.get(params[0]) })
            return { meta: { changes: 1 } }
          }
          if (normalized.startsWith('INSERT INTO product_purchase_rates')) {
            state.purchaseRates.set(params[0], params[1])
            return { meta: { changes: 1 } }
          }
          if (normalized.startsWith('INSERT INTO quotations')) {
            if (state.enforceOneActiveQuotation) {
              for (const q of state.quotations.values()) {
                if (q.customer_request_id === params[1] && q.status !== 'void') {
                  throw new Error('UNIQUE constraint failed: quotations.customer_request_id')
                }
              }
            }
            state.quotations.set(params[0], {
              id: params[0],
              customer_request_id: params[1],
              status: 'draft',
              customer_name: params[2],
              customer_phone: params[3],
              customer_note: params[4],
              currency: 'INR',
              subtotal_paise: params[5],
              adjustment_paise: 0,
              total_paise: params[6],
              wa_message_text: params[7],
              created_by_email: params[8],
            })
            return { meta: { changes: 1 } }
          }
          if (normalized.startsWith('INSERT INTO quotation_items')) {
            if (state.batchFailOn && normalized.startsWith(state.batchFailOn)) {
              throw new Error('injected quotation_items failure')
            }
            state.quotationItems.push({
              quotation_id: params[0],
              line_number: params[1],
              product_id: params[2],
              product_name: params[3],
              quantity: params[4],
              unit_rate_paise: params[5],
              line_total_paise: params[6],
            })
            return { meta: { changes: 1 } }
          }
          if (normalized.includes("UPDATE quotations SET status = 'void'")) {
            const q = state.quotations.get(String(params[0]))
            if (q) q.status = 'void'
            return { meta: { changes: 1 } }
          }
          if (normalized.includes('UPDATE customer_requests SET status')) {
            const r = state.requests.get(String(params[1]))
            if (r) r.status = params[0]
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 1 } }
        },
      })
      return makeStmt([])
    },
    async batch(stmts) {
      const snapshot = clonePhase52State(state)
      try {
        for (const s of stmts) {
          await s.run()
        }
      } catch (err) {
        restorePhase52State(state, snapshot)
        throw err
      }
    },
  }

  return db
}
