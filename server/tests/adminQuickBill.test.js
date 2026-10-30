import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { validateQuickBillPreviewBody } from '../src/lib/quickBillValidation.js'
import { lineTotalPaise, sumPaise } from '../src/services/money.js'
import { checkoutQuickBill, previewQuickBill } from '../src/services/adminQuickBill.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const ALLOWED_EMAIL = 'owner@example.com'

function localEnv(db) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL,
  }
}

async function adminFetch(path, { method = 'GET', body, db } = {}) {
  const token = await signLocalDevAdminJwt(
    { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL },
    { email: ALLOWED_EMAIL },
  )
  return worker.fetch(
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers: {
        'Cf-Access-Jwt-Assertion': token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    localEnv(db),
    {},
  )
}

describe('quick bill validation', () => {
  it('preview requires at least one valid item', () => {
    const bad = validateQuickBillPreviewBody({ items: [] })
    assert.equal(bad.ok, false)
    const good = validateQuickBillPreviewBody({ items: [{ productId: 'P001', quantity: 1 }] })
    assert.equal(good.ok, true)
  })
})

describe('quick bill authorization', () => {
  it('rejects unauthenticated preview and checkout', async () => {
    const db = createQuickBillMockDb()
    for (const path of ['/api/admin/quick-bill/preview', '/api/admin/quick-bill/checkout']) {
      const res = await worker.fetch(
        new Request(`http://127.0.0.1${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ productId: 'P001', quantity: 1 }] }),
        }),
        localEnv(db),
        {},
      )
      assert.equal(res.status, 401, path)
    }
  })
})

describe('quick bill service (mock D1)', () => {
  it('previews totals from products.selling_price_paise', async () => {
    const db = createQuickBillMockDb()
    const result = await previewQuickBill(db, [{ productId: 'P001', quantity: 2 }])
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.preview.totalPaise, lineTotalPaise(2, 169400))
    assert.equal(result.preview.items.length, 1)
  })

  it('reports missing selling price on preview', async () => {
    const db = createQuickBillMockDb({ sellingPaise: null })
    const result = await previewQuickBill(db, [{ productId: 'P001', quantity: 1 }])
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'missing_selling_price')
    assert.deepEqual(result.missingProductIds, ['P001'])
  })

  it('checkout creates manual request and quotation', async () => {
    const db = createQuickBillMockDb()
    const result = await checkoutQuickBill(
      db,
      {
        customer: { name: 'Stall Guest', mobile: '9876543210', area: '', pickupPreference: '', note: '' },
        items: [{ productId: 'P001', quantity: 2 }],
      },
      { createdByEmail: ALLOWED_EMAIL },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.request.source, 'manual')
    assert.equal(result.quotation.totalPaise, lineTotalPaise(2, 169400))
    assert.equal(db.state.quotations.size, 1)
  })
})

describe('quick bill HTTP (mock D1)', () => {
  it('preview and checkout via admin routes', async () => {
    const db = createQuickBillMockDb()
    const previewRes = await adminFetch('/api/admin/quick-bill/preview', {
      method: 'POST',
      db,
      body: { items: [{ productId: 'P001', quantity: 1 }] },
    })
    assert.equal(previewRes.status, 200)
    const previewBody = await previewRes.json()
    assert.equal(previewBody.preview.totalPaise, 169400)

    const checkoutRes = await adminFetch('/api/admin/quick-bill/checkout', {
      method: 'POST',
      db,
      body: {
        customer: { name: 'Walk-in', mobile: '9123456789' },
        items: [{ productId: 'P001', quantity: 1 }],
      },
    })
    assert.equal(checkoutRes.status, 201)
    const checkoutBody = await checkoutRes.json()
    assert.ok(checkoutBody.request?.id)
    assert.equal(checkoutBody.quotation.totalPaise, 169400)
    assert.equal(sumPaise([checkoutBody.quotation.totalPaise]), 169400)
  })
})

/** @param {{ sellingPaise?: number | null }} [opts] */
function createQuickBillMockDb(opts = {}) {
  const sellingPaise = opts.sellingPaise === undefined ? 169400 : opts.sellingPaise
  const state = {
    products: new Map([
      [
        'P001',
        {
          id: 'P001',
          name: 'EMERALD GIFT BOX',
          company: null,
          active: 1,
          stock_status: 'available',
          selling_price_paise: sellingPaise,
          final_price_paise: null,
          pieces_per_pack: null,
          allow_loose_sale: 0,
        },
      ],
    ]),
    requests: new Map(),
    requestItems: [],
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
          if (normalized.includes('FROM products WHERE id = ?')) {
            return state.products.get(String(params[0])) ?? null
          }
          if (normalized.includes('FROM customer_requests') && normalized.includes('WHERE id = ?')) {
            const id = String(params[0])
            const r = state.requests.get(id)
            if (!r) return null
            if (normalized.includes('public_reference') && normalized.includes('created_at')) {
              return {
                id: r.id,
                public_reference: r.public_reference ?? null,
                status: r.status,
                source: r.source,
                created_at: r.created_at,
              }
            }
            return {
              id: r.id,
              public_reference: r.public_reference ?? null,
              status: r.status,
              customer_name: r.customer_name,
              customer_phone: r.customer_phone,
              customer_area: r.customer_area,
              pickup_preference: r.pickup_preference,
              customer_note: r.customer_note,
            }
          }
          if (normalized.includes('COUNT(*) AS n FROM customer_request_items')) {
            const n = state.requestItems.filter((i) => i.request_id === params[0]).length
            return { n }
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
          if (normalized.startsWith('INSERT INTO customer_requests')) {
            const [
              id,
              publicReference,
              name,
              phone,
              area,
              pickup,
              note,
              deliveryAddress,
              deliveryLandmark,
              deliveryMapsUrl,
              source = 'web',
            ] = params
            state.requests.set(id, {
              id,
              public_reference: publicReference ?? null,
              status: 'received',
              source,
              customer_name: name,
              customer_phone: phone,
              customer_area: area,
              pickup_preference: pickup,
              customer_note: note,
              delivery_address: deliveryAddress ?? null,
              delivery_landmark: deliveryLandmark ?? null,
              delivery_maps_url: deliveryMapsUrl ?? null,
              created_at: '2026-10-18 00:00:00',
            })
            return { meta: { changes: 1 } }
          }
          if (normalized.startsWith('INSERT INTO customer_request_items')) {
            const [requestId, lineNumber, productId, familyPackId, productName, quantity, unitPricePaise] =
              params
            state.requestItems.push({
              request_id: requestId,
              line_number: lineNumber,
              product_id: productId,
              family_pack_id: familyPackId ?? null,
              product_name: productName,
              quantity,
              unit_price_paise: unitPricePaise ?? null,
            })
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
              subtotal_paise: params[5],
              adjustment_paise: 0,
              total_paise: params[6],
              wa_message_text: params[7],
              created_by_email: params[8],
              pricing_mode: params[9] ?? null,
              selling_subtotal_paise: params[10] ?? null,
              final_subtotal_paise: params[11] ?? null,
              bargain_floor_paise: params[12] ?? null,
              accepted_amount_paise: params[13] ?? null,
              created_at: '2026-10-18 00:00:00',
              updated_at: '2026-10-18 00:00:00',
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
          if (normalized.includes('SET finalization_status')) {
            const r = state.requests.get(String(params[0]))
            if (r) r.finalization_status = 'pending'
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 1 } }
        },
      })
      return makeStmt([])
    },
    async batch(statements) {
      for (const stmt of statements) {
        await stmt.run()
      }
    },
  }

  return db
}
