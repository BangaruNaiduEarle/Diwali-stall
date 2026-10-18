import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { PUBLIC_PRODUCT_LIST_SQL } from '../src/services/publicProducts.js'
import { lineTotalPaise, sumPaise } from '../src/services/money.js'
import {
  createOrGetQuotationForRequest,
  getQuotationById,
} from '../src/services/adminQuotations.js'
import { upsertCurrentPrivateRate } from '../src/services/adminPrivateRates.js'
import { listAdminProductsPage, updateAdminProduct } from '../src/services/adminProducts.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const ALLOWED_EMAIL = 'owner@example.com'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('public frontend private rate exposure', () => {
  it('products.js bundle source has no x4 keys', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src/data/products.js'), 'utf8')
    assert.ok(!/"x4":/.test(text))
    assert.ok(!/\bx4\b:/.test(text))
  })

  it('familyPacks.json has no x4UnitPrice fields', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src/data/familyPacks.json'), 'utf8')
    assert.ok(!text.includes('x4UnitPrice'))
    assert.ok(!text.includes('x4LineTotal'))
  })

  it('public product SQL still excludes private_rates', () => {
    assert.ok(!PUBLIC_PRODUCT_LIST_SQL.toLowerCase().includes('private_rates'))
  })
})

describe('admin phase 5 API (mock D1)', () => {
  it('rejects unauthenticated product search and quotation routes', async () => {
    const db = createPhase5MockDb()
    const env = { DB: db }
    const paths = [
      ['GET', '/api/admin/products?page=1&q=P001'],
      ['PUT', '/api/admin/products/P001/private-rate'],
      ['POST', '/api/admin/customer-requests/11111111-1111-4111-8111-111111111111/quotation'],
    ]
    for (const [method, p] of paths) {
      const res = await worker.fetch(new Request(`http://127.0.0.1${p}`, { method }), env, {})
      assert.ok(res.status === 401 || res.status === 503, `${p} status ${res.status}`)
    }
  })

  it('lists products with pagination and missing-rate filter', async () => {
    const db = createPhase5MockDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL },
      { email: ALLOWED_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/products?page=1&limit=10&missingRate=1', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      { DB: db, ADMIN_LOCAL_DEV_AUTH: '1', ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL },
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body.products))
    assert.ok(body.pagination.total >= 0)
  })

  it('updates selling price without changing private rate', async () => {
    const db = createPhase5MockDb()
    const beforeRate = db.state.rates.get('P001')
    await updateAdminProduct(db, 'P001', { sellingPriceInr: 999 })
    const product = db.state.products.get('P001')
    assert.equal(product.selling_price_paise, 99900)
    assert.equal(db.state.rates.get('P001'), beforeRate)
  })

  it('updates private rate without changing selling price', async () => {
    const db = createPhase5MockDb()
    db.state.products.get('P001').selling_price_paise = 50000
    await upsertCurrentPrivateRate(db, 'P001', 12345)
    assert.equal(db.state.products.get('P001').selling_price_paise, 50000)
    assert.equal(db.state.rates.get('P001'), 12345)
  })

  it('creates quotation from request lines with integer paise totals', async () => {
    const db = createPhase5MockDb()
    const requestId = '11111111-1111-4111-8111-111111111111'
    const result = await createOrGetQuotationForRequest(db, requestId, { createdByEmail: ALLOWED_EMAIL })
    assert.equal(result.ok, true)
    if (!result.ok) return
    const q = result.quotation
    assert.ok(q.items.length >= 1)
    const expectedLine = lineTotalPaise(2, 169400)
    assert.equal(Number(q.items[0].lineTotalPaise), expectedLine)
    assert.equal(Number(q.items[0].quantity), 2)
    assert.equal(q.totalPaise, sumPaise(q.items.map((i) => i.lineTotalPaise)))
  })

  it('blocks quotation when private rate missing', async () => {
    const db = createPhase5MockDb()
    db.state.rates.delete('P002')
    const result = await createOrGetQuotationForRequest(db, '22222222-2222-4222-8222-222222222222')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'missing_private_rates')
  })

  it('returns existing quotation on retry without duplicate active rows', async () => {
    const db = createPhase5MockDb()
    const requestId = '11111111-1111-4111-8111-111111111111'
    const first = await createOrGetQuotationForRequest(db, requestId)
    const second = await createOrGetQuotationForRequest(db, requestId)
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (!first.ok || !second.ok) return
    assert.equal(second.created, false)
    assert.equal(first.quotation.id, second.quotation.id)
    assert.equal(db.state.quotations.size, 1)
  })

  it('keeps quotation snapshot stable after rate change', async () => {
    const db = createPhase5MockDb()
    const requestId = '11111111-1111-4111-8111-111111111111'
    const created = await createOrGetQuotationForRequest(db, requestId)
    assert.equal(created.ok, true)
    if (!created.ok) return
    const quoteId = created.quotation.id
    const totalBefore = created.quotation.totalPaise
    await upsertCurrentPrivateRate(db, 'P001', 1)
    const reloaded = await getQuotationById(db, quoteId)
    assert.equal(reloaded?.totalPaise, totalBefore)
  })
})

function createPhase5MockDb() {
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
      [
        'P002',
        {
          id: 'P002',
          category_slug: 'gift-boxes',
          name: 'SILVER',
          active: 1,
          stock_status: 'available',
          selling_price_paise: null,
          sort_order: 2,
          images_json: '[]',
          pack: '',
          description: '',
          featured: 0,
          company: null,
        },
      ],
    ]),
    categories: new Map([['gift-boxes', { slug: 'gift-boxes', label: 'Gift Boxes' }]]),
    rates: new Map([
      ['P001', 169400],
      ['P002', 229200],
    ]),
    rateHistory: [],
    requests: new Map([
      [
        '11111111-1111-4111-8111-111111111111',
        {
          id: '11111111-1111-4111-8111-111111111111',
          status: 'received',
          customer_name: 'Test',
          customer_phone: '9876543210',
          customer_note: null,
          pickup_preference: null,
        },
      ],
      [
        '22222222-2222-4222-8222-222222222222',
        {
          id: '22222222-2222-4222-8222-222222222222',
          status: 'received',
          customer_name: 'Bob',
          customer_phone: '9123456789',
          customer_note: null,
          pickup_preference: null,
        },
      ],
    ]),
    requestItems: [
      {
        request_id: '11111111-1111-4111-8111-111111111111',
        line_number: 1,
        product_id: 'P001',
        product_name: 'EMERALD GIFT BOX',
        quantity: 2,
      },
      {
        request_id: '22222222-2222-4222-8222-222222222222',
        line_number: 1,
        product_id: 'P002',
        product_name: 'SILVER',
        quantity: 1,
      },
    ],
    quotations: new Map(),
    quotationItems: [],
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
          if (normalized.includes('admin_users')) {
            return String(params[0]).toLowerCase() === ALLOWED_EMAIL.toLowerCase() ? { ok: 1 } : null
          }
          if (normalized.includes('COUNT(*) AS total') && normalized.includes('products p')) {
            let n = [...state.products.values()].filter((p) => {
              if (normalized.includes('pr.id IS NULL')) return !state.rates.has(p.id)
              return true
            }).length
            return { total: n }
          }
          if (normalized.includes('FROM products WHERE id = ?')) {
            const p = state.products.get(String(params[0]))
            if (!p) return null
            return { ...p, category_label: state.categories.get(p.category_slug)?.label }
          }
          if (normalized.includes('FROM private_rates') && normalized.includes('effective_to IS NULL')) {
            const paise = state.rates.get(String(params[0]))
            return paise == null ? null : { id: 1, product_id: params[0], unit_rate_paise: paise, effective_to: null }
          }
          if (normalized.includes('SELECT id, status FROM customer_requests')) {
            const r = state.requests.get(String(params[0]))
            return r ? { id: r.id, status: r.status } : null
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
            return {
              results: state.requestItems.filter((i) => i.request_id === params[0]),
            }
          }
          if (normalized.includes('FROM quotation_items')) {
            return {
              results: state.quotationItems.filter((i) => i.quotation_id === params[0]),
            }
          }
          if (normalized.includes('FROM products p')) {
            const rows = [...state.products.values()].map((p) => ({
              ...p,
              category_label: state.categories.get(p.category_slug)?.label,
              private_x4_paise: state.rates.get(p.id) ?? null,
            }))
            return { results: rows.slice(0, params[params.length - 2] ?? 10) }
          }
          return { results: [] }
        },
        async run() {
          if (normalized.startsWith('UPDATE products SET')) {
            const id = params[params.length - 1]
            const p = state.products.get(String(id))
            if (!p) return { meta: { changes: 0 } }
            if (normalized.includes('selling_price_paise')) {
              p.selling_price_paise = params[0]
            }
            return { meta: { changes: 1 } }
          }
          if (normalized.includes('UPDATE private_rates') && normalized.includes('effective_to')) {
            state.rateHistory.push({ product_id: params[0], paise: state.rates.get(params[0]) })
            return { meta: { changes: 1 } }
          }
          if (normalized.startsWith('INSERT INTO private_rates')) {
            state.rates.set(params[0], params[1])
            return { meta: { changes: 1 } }
          }
          if (normalized.startsWith('INSERT INTO quotations')) {
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
          if (normalized.includes('UPDATE customer_requests SET status')) {
            const r = state.requests.get(String(params[1]))
            if (r) r.status = params[0]
            return { meta: { changes: 1 } }
          }
          if (normalized.includes("UPDATE quotations SET status = 'void'")) {
            const q = state.quotations.get(String(params[0]))
            if (q) q.status = 'void'
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 1 } }
        },
      })
      return makeStmt([])
    },
    async batch(stmts) {
      for (const s of stmts) {
        await s.run()
      }
    },
  }

  return db
}
