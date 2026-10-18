import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import {
  ADMIN_GET_CUSTOMER_REQUEST_SQL,
  ADMIN_LIST_CUSTOMER_REQUESTS_SQL,
  ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL,
  listAdminCustomerRequests,
  updateAdminCustomerRequestStatus,
} from '../src/services/adminCustomerRequests.js'
import {
  ADMIN_CUSTOMER_REQUEST_LIST_LIMITS,
  parseAdminCustomerRequestListQuery,
  validateCustomerRequestStatusPatchBody,
} from '../src/lib/adminCustomerRequestValidation.js'

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
  const init = {
    method,
    headers: {
      'Cf-Access-Jwt-Assertion': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }
  return worker.fetch(new Request(`http://127.0.0.1${path}`, init), localEnv(db), {})
}

describe('admin customer request SQL separation', () => {
  it('list and detail SQL do not reference private_rates or money columns', () => {
    for (const sql of [
      ADMIN_LIST_CUSTOMER_REQUESTS_SQL,
      ADMIN_GET_CUSTOMER_REQUEST_SQL,
      ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL,
    ]) {
      const lower = sql.toLowerCase()
      assert.ok(!lower.includes('private_rates'))
      assert.ok(!lower.includes('unit_rate'))
      assert.ok(!lower.includes('paise'))
      assert.ok(!lower.includes('subtotal'))
      assert.ok(!lower.includes('total_paise'))
    }
  })
})

describe('admin customer request list query validation', () => {
  it('applies default limit and rejects excessive limit', () => {
    const ok = parseAdminCustomerRequestListQuery(new URLSearchParams(''))
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.data.page, 1)
      assert.equal(ok.data.limit, ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.defaultLimit)
    }
    const bad = parseAdminCustomerRequestListQuery(
      new URLSearchParams(`limit=${ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.maxLimit + 1}`),
    )
    assert.equal(bad.ok, false)
  })

  it('validates status filter', () => {
    const good = parseAdminCustomerRequestListQuery(new URLSearchParams('status=received'))
    assert.equal(good.ok, true)
    const bad = parseAdminCustomerRequestListQuery(new URLSearchParams('status=shipped'))
    assert.equal(bad.ok, false)
  })
})

describe('admin customer request authorization', () => {
  it('rejects unauthenticated access to list, detail, and status endpoints', async () => {
    const db = createAdminMockDb({ requests: [] })
    const env = localEnv(db)
    const paths = [
      ['GET', '/api/admin/customer-requests'],
      ['GET', '/api/admin/customer-requests/cr-0123456789abcdef0123456789abcdef'],
      ['PATCH', '/api/admin/customer-requests/cr-0123456789abcdef0123456789abcdef/status'],
    ]
    for (const [method, path] of paths) {
      const res = await worker.fetch(
        new Request(`http://127.0.0.1${path}`, {
          method,
          headers: method === 'PATCH' ? { 'Content-Type': 'application/json' } : {},
          body: method === 'PATCH' ? JSON.stringify({ status: 'reviewing' }) : undefined,
        }),
        env,
        {},
      )
      assert.equal(res.status, 401, `${method} ${path}`)
    }
  })
})

describe('admin customer request API (mock D1)', () => {
  const sampleRequests = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'received',
      source: 'web',
      customer_name: 'Alice',
      customer_phone: '9876543210',
      customer_area: 'Chennai',
      pickup_preference: null,
      customer_note: 'Note A',
      created_at: '2026-10-16 10:00:00',
      updated_at: '2026-10-16 10:00:00',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'reviewing',
      source: 'web',
      customer_name: 'Bob',
      customer_phone: '9123456789',
      customer_area: 'Madurai',
      pickup_preference: 'Sunday',
      customer_note: null,
      created_at: '2026-10-16 11:00:00',
      updated_at: '2026-10-16 11:00:00',
    },
  ]

  const sampleItems = [
    {
      request_id: sampleRequests[0].id,
      line_number: 1,
      product_id: 'P001',
      product_name: 'Sparkler',
      quantity: 2,
    },
    {
      request_id: sampleRequests[0].id,
      line_number: 2,
      product_id: 'P002',
      product_name: 'Flower Pot',
      quantity: 1,
    },
  ]

  it('lists requests newest first with pagination metadata', async () => {
    const db = createAdminMockDb({ requests: sampleRequests, items: sampleItems })
    const res = await adminFetch('/api/admin/customer-requests', { db })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.requests.length, 2)
    assert.equal(body.requests[0].id, sampleRequests[1].id)
    assert.equal(body.requests[1].itemCount, 2)
    assert.equal(body.pagination.total, 2)
    assert.equal(body.pagination.page, 1)
    assert.equal(body.pagination.limit, ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.defaultLimit)
    assertNoRateFields(body)
    assert.equal('customerNote' in body.requests[0], false)
  })

  it('filters by status', async () => {
    const db = createAdminMockDb({ requests: sampleRequests, items: sampleItems })
    const res = await adminFetch('/api/admin/customer-requests?status=received', { db })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.requests.length, 1)
    assert.equal(body.requests[0].status, 'received')
    assert.equal(body.pagination.total, 1)
  })

  it('returns request detail with items', async () => {
    const db = createAdminMockDb({ requests: sampleRequests, items: sampleItems })
    const res = await adminFetch(`/api/admin/customer-requests/${sampleRequests[0].id}`, { db })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.request.items.length, 2)
    assert.equal(body.request.items[0].quantity, 2)
    assert.equal(body.request.customerNote, 'Note A')
    assertNoRateFields(body)
  })

  it('returns 404 for missing detail', async () => {
    const db = createAdminMockDb({ requests: sampleRequests, items: sampleItems })
    const res = await adminFetch(
      '/api/admin/customer-requests/33333333-3333-4333-8333-333333333333',
      { db },
    )
    assert.equal(res.status, 404)
  })

  it('returns 404 for malformed request id on detail', async () => {
    const db = createAdminMockDb({ requests: sampleRequests, items: [] })
    const res = await adminFetch('/api/admin/customer-requests/not-valid-id', { db })
    assert.equal(res.status, 404)
  })

  it('updates status successfully', async () => {
    const db = createAdminMockDb({ requests: structuredClone(sampleRequests), items: sampleItems })
    const id = sampleRequests[0].id
    const res = await adminFetch(`/api/admin/customer-requests/${id}/status`, {
      method: 'PATCH',
      body: { status: 'reviewing' },
      db,
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.request, { id, status: 'reviewing' })
    assert.equal(db.state.requests.get(id).status, 'reviewing')
  })

  it('rejects missing or invalid status on patch', async () => {
    const db = createAdminMockDb({ requests: structuredClone(sampleRequests), items: [] })
    const id = sampleRequests[0].id
    const r1 = await adminFetch(`/api/admin/customer-requests/${id}/status`, {
      method: 'PATCH',
      body: {},
      db,
    })
    assert.equal(r1.status, 400)
    const r2 = await adminFetch(`/api/admin/customer-requests/${id}/status`, {
      method: 'PATCH',
      body: { status: 'invalid' },
      db,
    })
    assert.equal(r2.status, 400)
  })

  it('returns 404 when updating unknown request', async () => {
    const db = createAdminMockDb({ requests: [], items: [] })
    const res = await adminFetch(
      '/api/admin/customer-requests/44444444-4444-4444-8444-444444444444/status',
      { method: 'PATCH', body: { status: 'reviewing' }, db },
    )
    assert.equal(res.status, 404)
  })

  it('rejects client price fields on status patch', () => {
    const r = validateCustomerRequestStatusPatchBody({ status: 'reviewing', price: 100, subtotal: 50 })
    assert.equal(r.ok, false)
  })

  it('blocks transition out of terminal closed status', async () => {
    const closed = {
      ...sampleRequests[0],
      id: '55555555-5555-4555-8555-555555555555',
      status: 'closed',
    }
    const db = createAdminMockDb({ requests: [closed], items: [] })
    const result = await updateAdminCustomerRequestStatus(db, closed.id, 'reviewing')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 400)

    const res = await adminFetch(`/api/admin/customer-requests/${closed.id}/status`, {
      method: 'PATCH',
      body: { status: 'reviewing' },
      db,
    })
    assert.equal(res.status, 400)
  })

  it('uses bound parameters in list queries (no string concatenation of user input)', async () => {
    const db = createAdminMockDb({ requests: sampleRequests, items: sampleItems })
    await listAdminCustomerRequests(db, { limit: 10, offset: 0, status: 'received' })
    const last = db.lastListBind
    assert.deepEqual(last, ['received', 10, 0])
  })
})

function assertNoRateFields(obj) {
  const forbiddenKeys = new Set([
    'unit_rate_paise',
    'unitRatePaise',
    'price',
    'x4',
    'subtotal',
    'subtotalPaise',
    'total_paise',
    'totalPaise',
    'lineTotal',
    'line_total',
  ])
  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(!forbiddenKeys.has(key), `forbidden key ${key}`)
      walk(nested)
    }
  }
  walk(obj)
  assert.ok(!JSON.stringify(obj).includes('private_rates'))
}

/**
 * @param {{ requests: object[], items?: object[] }} opts
 */
function createAdminMockDb(opts) {
  const state = {
    requests: new Map(opts.requests.map((r) => [r.id, { ...r }])),
    items: [...(opts.items ?? [])],
  }

  const db = {
    state,
    lastListBind: null,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      const makeStmt = (params) => ({
        _sql: normalized,
        _params: params,
        bind(...next) {
          return makeStmt(next.length ? next : params)
        },
        async first() {
              if (normalized.includes('FROM admin_users')) {
                const email = String(params[0]).toLowerCase()
                if (email === ALLOWED_EMAIL.toLowerCase()) return { ok: 1 }
                return null
              }
              if (normalized.includes('SELECT id, status FROM customer_requests')) {
                const row = state.requests.get(String(params[0]))
                return row ? { id: row.id, status: row.status } : null
              }
              if (normalized.includes('FROM customer_requests') && normalized.includes('WHERE id = ?')) {
                return state.requests.get(String(params[0])) ?? null
              }
              if (normalized.includes('COUNT(*) AS total FROM customer_requests')) {
                let rows = [...state.requests.values()]
                if (normalized.includes('WHERE r.status = ?')) {
                  rows = rows.filter((r) => r.status === params[0])
                }
                return { total: rows.length }
              }
              return null
            },
        async all() {
              if (normalized.includes('FROM customer_request_items') && normalized.includes('WHERE request_id = ?')) {
                const rid = String(params[0])
                const results = state.items
                  .filter((i) => i.request_id === rid)
                  .sort((a, b) => a.line_number - b.line_number)
                  .map((i) => ({
                    line_number: i.line_number,
                    product_id: i.product_id,
                    product_name: i.product_name,
                    quantity: i.quantity,
                  }))
                return { results }
              }
              if (normalized.includes('FROM customer_requests r')) {
                db.lastListBind = params
                let rows = [...state.requests.values()]
                if (normalized.includes('WHERE r.status = ?')) {
                  rows = rows.filter((r) => r.status === params[0])
                }
                rows.sort((a, b) => {
                  const c = String(b.created_at).localeCompare(String(a.created_at))
                  return c !== 0 ? c : String(b.id).localeCompare(String(a.id))
                })
                const limit = normalized.includes('WHERE r.status = ?') ? params[1] : params[0]
                const offset = normalized.includes('WHERE r.status = ?') ? params[2] : params[1]
                const slice = rows.slice(offset, offset + limit)
                const results = slice.map((r) => ({
                  id: r.id,
                  status: r.status,
                  source: r.source,
                  customer_name: r.customer_name,
                  customer_phone: r.customer_phone,
                  customer_area: r.customer_area,
                  created_at: r.created_at,
                  item_count: state.items.filter((i) => i.request_id === r.id).length,
                }))
                return { results }
              }
              return { results: [] }
            },
        async run() {
              if (normalized.startsWith('UPDATE customer_requests SET status')) {
                const [status, id] = params
                const row = state.requests.get(String(id))
                if (!row) return { meta: { changes: 0 } }
                row.status = status
                row.updated_at = '2026-10-16 12:00:00'
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 0 } }
            },
      })
      return makeStmt([])
    },
    async batch() {
      return []
    },
  }

  return db
}
