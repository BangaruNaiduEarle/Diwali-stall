import assert from 'node:assert/strict'
import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import {
  ADMIN_GET_CUSTOMER_REQUEST_SQL,
  ADMIN_LIST_CUSTOMER_REQUESTS_SQL,
  ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL,
  buildAdminCustomerRequestListFilter,
  enrichAdminCustomerRequestListForRole,
  listAdminCustomerRequests,
  normalizeCustomerRequestPhoneSearch,
  updateAdminCustomerRequestStatus,
} from '../src/services/adminCustomerRequests.js'
import {
  ADMIN_CUSTOMER_REQUEST_LIST_LIMITS,
  parseAdminCustomerRequestListQuery,
  validateCustomerRequestStatusPatchBody,
} from '../src/lib/adminCustomerRequestValidation.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import { attachPaymentSummaries } from '../src/services/adminPayments.js'
import { fixture as scopeFixture, attach as attachScope, season as scopedSeason } from './helpers/mockAdminTransactionDb.js'

describe('customer request pagination', () => {
  it('defaults to 10, validates page/limit, and caps limit at 100', () => {
    assert.equal(parseAdminCustomerRequestListQuery(new URLSearchParams()).data.limit, 10)
    assert.equal(parseAdminCustomerRequestListQuery(new URLSearchParams('page=3&limit=100')).data.offset, 200)
    for (const query of ['page=0','page=-1','page=1.5','page=10001','limit=0','limit=-1','limit=1.5','limit=101','limit=NaN']) {
      assert.equal(parseAdminCustomerRequestListQuery(new URLSearchParams(query)).ok, false, query)
    }
  })

  it('returns bounded pages and filtered totals in the original stable order', async () => {
    const requests=Array.from({length:45},(_,i)=>({id:'cr-'+i.toString(16).padStart(32,'0'),season_id:DEFAULT_ADMIN_SEASON_ID,
      status:i%2?'quoted':'received',source:'web',customer_name:i%3?'Other':'Matching',created_at:'2026-11-05 10:00:00'}))
    const db=createAdminMockDb({requests,items:[]})
    const first=await (await adminFetch('/api/admin/customer-requests',{db})).json()
    assert.equal(first.requests.length,10)
    assert.deepEqual(first.pagination,{page:1,limit:10,total:45,totalPages:5})
    const second=await (await adminFetch('/api/admin/customer-requests?page=2',{db})).json()
    assert.equal(second.requests.length,10)
    assert.equal(new Set([...first.requests,...second.requests].map(row=>row.id)).size,20)
    assert.ok(first.requests[9].id>second.requests[0].id)
    const filtered=await (await adminFetch('/api/admin/customer-requests?page=2&limit=3&status=received&q=Matching',{db})).json()
    assert.deepEqual(filtered.pagination,{page:2,limit:3,total:8,totalPages:3})
    assert.equal(filtered.requests.length,3)
    assert.ok(filtered.requests.every(row=>row.status==='received'&&row.customerName==='Matching'))
    assert.deepEqual(db.lastListBind.slice(-2),[3,3])
    const empty=await (await adminFetch('/api/admin/customer-requests?q=no-such-customer',{db})).json()
    assert.deepEqual(empty.pagination,{page:1,limit:10,total:0,totalPages:0})
    const beyond=await (await adminFetch('/api/admin/customer-requests?page=6',{db})).json()
    assert.equal(beyond.requests.length,0)
    assert.equal(beyond.pagination.total,45)
  })

  it('loads saved list totals in bounded queries without item or history hydration', async () => {
    const queries=[]
    const db=bindAdminServiceMode({prepare(sql){queries.push(sql);return {bind(){return {async all(){
      if(sql.includes('FROM quotations'))return {results:[{customer_request_id:'request-1',selling_subtotal_paise:10000,final_subtotal_paise:null,accepted_amount_paise:8000,total_paise:10000}]}
      if(sql.includes('FROM request_payment_summaries'))return {results:[{request_id:'request-1',amount_due_paise:8000,received_paise:3000,outstanding_paise:5000,payment_status:'PARTIAL'}]}
      throw Error('Unexpected list query: '+sql)
    }}}}}}, {})
    const rows=await enrichAdminCustomerRequestListForRole(db,[{id:'request-1',seasonId:DEFAULT_ADMIN_SEASON_ID}],'owner',DEFAULT_ADMIN_SEASON_ID)
    assert.equal(rows[0].auditSummary.sellingSubtotalPaise,10000)
    assert.equal(rows[0].auditSummary.acceptedAmountPaise,8000)
    assert.equal(rows[0].auditSummary.belowFinalWarning,undefined)
    assert.equal(queries.length,1)
    assert.match(queries[0],/season_id = \?/)
    assert.doesNotMatch(queries.join(' '),/SELECT\s+\*|quotation_items|request_workflow_events|request_payment_ledger|FROM customer_request_items/i)
    await enrichAdminCustomerRequestListForRole(db,[{id:'request-1',seasonId:DEFAULT_ADMIN_SEASON_ID}],'admin',DEFAULT_ADMIN_SEASON_ID)
    assert.equal(queries.length,1)
  })

  it('keeps stall/season boundaries on quotation and payment summary queries', async () => {
    const fixture=scopeFixture(),{context}=await attachScope(fixture)
    const seen=[]
    const db=bindAdminServiceMode({prepare(sql){return {bind(...params){seen.push({sql,params});return {async all(){return {results:sql.includes('request_payment_summaries')?[{request_id:'request-1',amount_due_paise:8000,received_paise:3000,outstanding_paise:5000,payment_status:'PARTIAL'}]:[]}}}}}}},{ADMIN_LOCATION_MODE:'true'})
    await enrichAdminCustomerRequestListForRole(db,[{id:'request-1',seasonId:scopedSeason}],'owner',scopedSeason,context)
    const summaries=await attachPaymentSummaries(db,[{id:'request-1'}],{seasonId:scopedSeason,context,listView:true})
    assert.deepEqual(summaries[0].paymentSummary,{amountDuePaise:8000,receivedPaise:3000,outstandingPaise:5000,paymentStatus:'PARTIAL'})
    assert.equal(seen.length,2)
    assert.ok(seen[0].sql.includes('quotations.location_id = ?'))
    assert.ok(seen[0].params.includes('loc-a'))
    assert.ok(seen[0].params.includes(scopedSeason))
    assert.match(seen[1].sql,/business_id = \? AND location_id = \? AND season_id = \?/)
    assert.equal(seen[1].params[1],'loc-a')
    assert.equal(seen[1].params[2],scopedSeason)
    assert.doesNotMatch(seen.map(row=>row.sql).join(' '),/SELECT\s+\*|quotation_items|request_workflow_events|request_payment_ledger/i)
  })
})

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const ALLOWED_EMAIL = 'owner@example.com'

function localEnv(db) {
  return {
    DB: db,
    ADMIN_CUSTOMER_REQUEST_VISIBLE_FROM: '2000-01-01T00:00:00.000Z',
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL,
  }
}

async function adminFetch(path, { method = 'GET', body, db, seasonId = DEFAULT_ADMIN_SEASON_ID } = {}) {
  const token = await signLocalDevAdminJwt(
    { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL },
    { email: ALLOWED_EMAIL },
  )
  const init = {
    method,
    headers: {
      'Cf-Access-Jwt-Assertion': token,
      ...(seasonId ? { 'X-Admin-Season-Id': seasonId } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }
  return worker.fetch(new Request(`http://127.0.0.1${path}`, init), localEnv(db), {})
}

describe('admin customer request SQL separation', () => {
  it('list and detail SQL do not reference private_rates or quotation totals', () => {
    for (const sql of [ADMIN_LIST_CUSTOMER_REQUESTS_SQL, ADMIN_GET_CUSTOMER_REQUEST_SQL]) {
      const lower = sql.toLowerCase()
      assert.ok(!lower.includes('private_rates'))
      assert.ok(!lower.includes('unit_rate'))
      assert.ok(!lower.includes('subtotal'))
      assert.ok(!lower.includes('total_paise'))
    }
    // Only the list excludes all monetary columns; detail includes payment preferences.
    assert.ok(!ADMIN_LIST_CUSTOMER_REQUESTS_SQL.toLowerCase().includes('paise'))
    const itemsSql = ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL.toLowerCase()
    assert.ok(!itemsSql.includes('private_rates'))
    assert.ok(itemsSql.includes('unit_price_paise'))
    assert.ok(!itemsSql.includes('from private_rates'))
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

  it('trims search text and keeps it alongside the status filter', () => {
    const parsed = parseAdminCustomerRequestListQuery(new URLSearchParams('q=%20Ravi%20&status=received'))
    assert.equal(parsed.ok, true)
    if (parsed.ok) {
      assert.equal(parsed.data.q, 'Ravi')
      assert.equal(parsed.data.status, 'received')
    }
    const blank = parseAdminCustomerRequestListQuery(new URLSearchParams('q=%20%20'))
    assert.equal(blank.ok, true)
    if (blank.ok) assert.equal(blank.data.q, '')
  })

  it('caps search length', () => {
    const parsed = parseAdminCustomerRequestListQuery(
      new URLSearchParams(`q=${'a'.repeat(ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.maxSearchLength + 10)}`),
    )
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.data.q.length, ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.maxSearchLength)
  })
})

describe('admin customer request authorization', () => {
  it('rejects unauthenticated access to list, detail, and status endpoints', async () => {
    const db = createAdminMockDb({ requests: [] })
    const env = localEnv(db)
    const paths = [
      ['GET', '/api/admin/customer-requests'],
      ['GET', '/api/admin/customer-requests?q=ravi'],
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
      season_id: DEFAULT_ADMIN_SEASON_ID,
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
      season_id: DEFAULT_ADMIN_SEASON_ID,
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
    assert.equal(body.request.id, id)
    assert.equal(body.request.status, 'reviewing')
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

  it('returns not_found when status patch targets another season', async () => {
    const otherSeasonRequest = {
      ...structuredClone(sampleRequests[0]),
      id: '33333333-3333-4333-8333-333333333333',
      season_id: 'season-2099',
    }
    const db = createAdminMockDb({ requests: [otherSeasonRequest], items: [] })
    const res = await adminFetch(`/api/admin/customer-requests/${otherSeasonRequest.id}/status`, {
      method: 'PATCH',
      body: { status: 'reviewing' },
      db,
    })
    assert.equal(res.status, 404)
  })

  it('blocks transition out of terminal closed status', async () => {
    const closed = {
      ...sampleRequests[0],
      id: '55555555-5555-4555-8555-555555555555',
      status: 'closed',
      season_id: DEFAULT_ADMIN_SEASON_ID,
    }
    const db = createAdminMockDb({ requests: [closed], items: [] })
    const result = await updateAdminCustomerRequestStatus(db, closed.id, 'reviewing', {
      seasonId: DEFAULT_ADMIN_SEASON_ID,
    })
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
    await listAdminCustomerRequests(db, { visibilityCutoff: '2000-01-01T00:00:00.000Z', limit: 10, offset: 0, status: 'received' })
    const last = db.lastListBind
    assert.deepEqual(last, ['received', '2000-01-01T00:00:00.000Z', 10, 0])
  })

  it('binds search text instead of interpolating it into SQL', async () => {
    const db = createAdminMockDb({ requests: sampleRequests, items: [] })
    await listAdminCustomerRequests(db, { visibilityCutoff: '2000-01-01T00:00:00.000Z', limit: 10, offset: 0, q: "O'Hara%" })
    assert.equal(String(db.lastListSql).includes("O'Hara"), false)
    assert.match(String(db.lastListSql), /LIKE \?/)
    assert.deepEqual(db.lastListBind, ["%O'Hara\\%%", "%O'Hara\\%%", "%O'Hara\\%%", '2000-01-01T00:00:00.000Z', 10, 0])
  })
})

describe('admin customer request search', () => {
  const searchRequests = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      public_reference: 'DWL-TKTSWMFM',
      status: 'received',
      source: 'web',
      customer_name: 'Ravi Kumar',
      customer_phone: '+91 (958) 123-4567',
      customer_area: 'Chennai',
      created_at: '2026-10-16 09:00:00',
      updated_at: '2026-10-16 09:00:00',
      season_id: DEFAULT_ADMIN_SEASON_ID,
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'reviewing',
      source: 'web',
      customer_name: 'Meera',
      customer_phone: '9876543210',
      customer_area: 'Madurai',
      created_at: '2026-10-16 12:00:00',
      updated_at: '2026-10-16 12:00:00',
      season_id: DEFAULT_ADMIN_SEASON_ID,
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      status: 'quoted',
      source: 'web',
      customer_name: 'Anita Rao',
      customer_phone: '9581098765',
      customer_area: 'Chennai',
      created_at: '2026-10-16 13:00:00',
      updated_at: '2026-10-16 13:00:00',
      season_id: DEFAULT_ADMIN_SEASON_ID,
    },
  ]

  it('normalizes phone search text', () => {
    assert.equal(normalizeCustomerRequestPhoneSearch(' +91 (958)-123 '), '91958123')
    assert.equal(normalizeCustomerRequestPhoneSearch('9581'), '9581')
  })

  it('searches the stored Reference ID exactly and partially, ignoring case', async () => {
    for (const q of ['DWL-TKTSWMFM', 'tkts', 'SWMFM']) {
      const db = createAdminMockDb({ requests: searchRequests, items: [] })
      const response = await adminFetch(`/api/admin/customer-requests?q=${encodeURIComponent(q)}`, { db })
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.pagination.total, 1)
      assert.deepEqual(body.requests.map(row => row.id), [searchRequests[0].id])
    }
  })

  it('does not search by the internal Request ID', async () => {
    const db = createAdminMockDb({ requests: searchRequests, items: [] })
    const response = await adminFetch(`/api/admin/customer-requests?q=${searchRequests[0].id}`, { db })
    assert.equal((await response.json()).pagination.total, 0)
    assert.doesNotMatch(buildAdminCustomerRequestListFilter({ q: 'aaaa' }).whereSql, /r\.id LIKE/)
  })

  it('searches by full and partial customer name, ignoring case', async () => {
    const db = createAdminMockDb({ requests: searchRequests, items: [] })
    const full = await adminFetch('/api/admin/customer-requests?q=Ravi%20Kumar', { db })
    assert.equal(full.status, 200)
    const fullBody = await full.json()
    assert.equal(fullBody.pagination.total, 1)
    assert.equal(fullBody.requests[0].customerName, 'Ravi Kumar')

    const partial = await adminFetch('/api/admin/customer-requests?q=ravi', { db })
    const partialBody = await partial.json()
    assert.equal(partialBody.pagination.total, 1)
    assert.equal(partialBody.requests[0].id, searchRequests[0].id)
  })

  it('searches by full and partial phone numbers, ignoring formatting', async () => {
    const db = createAdminMockDb({ requests: searchRequests, items: [] })
    const full = await adminFetch('/api/admin/customer-requests?q=9876543210', { db })
    const fullBody = await full.json()
    assert.equal(fullBody.pagination.total, 1)
    assert.equal(fullBody.requests[0].customerName, 'Meera')

    const partial = await adminFetch('/api/admin/customer-requests?q=9581', { db })
    const partialBody = await partial.json()
    assert.equal(partialBody.pagination.total, 2)
    const names = partialBody.requests.map((row) => row.customerName).sort()
    assert.deepEqual(names, ['Anita Rao', 'Ravi Kumar'])

    const formatted = await adminFetch(
      `/api/admin/customer-requests?q=${encodeURIComponent('+91 (958)-123')}`,
      { db },
    )
    const formattedBody = await formatted.json()
    assert.equal(formattedBody.pagination.total, 1)
    assert.equal(formattedBody.requests[0].customerName, 'Ravi Kumar')
  })

  it('returns an empty page when nothing matches', async () => {
    const db = createAdminMockDb({ requests: searchRequests, items: [] })
    const res = await adminFetch('/api/admin/customer-requests?q=zzzz', { db })
    const body = await res.json()
    assert.equal(body.requests.length, 0)
    assert.equal(body.pagination.total, 0)
    assert.equal(body.pagination.totalPages, 0)
  })

  it('returns the full list when search is blank', async () => {
    const db = createAdminMockDb({ requests: searchRequests, items: [] })
    const res = await adminFetch('/api/admin/customer-requests?q=%20%20', { db })
    const body = await res.json()
    assert.equal(body.pagination.total, 3)
    assert.equal(body.requests.length, 3)
  })

  it('composes search with the status filter and searches beyond the first page', async () => {
    const db = createAdminMockDb({ requests: searchRequests, items: [] })
    const filtered = await adminFetch('/api/admin/customer-requests?q=ravi&status=received', { db })
    const filteredBody = await filtered.json()
    assert.equal(filteredBody.pagination.total, 1)
    assert.equal(filteredBody.requests[0].status, 'received')

    const none = await adminFetch('/api/admin/customer-requests?q=ravi&status=quoted', { db })
    const noneBody = await none.json()
    assert.equal(noneBody.pagination.total, 0)

    const unfilteredPage = await adminFetch('/api/admin/customer-requests?limit=1&page=1', { db })
    const unfilteredBody = await unfilteredPage.json()
    assert.equal(unfilteredBody.requests[0].customerName, 'Anita Rao')

    const olderMatch = await adminFetch('/api/admin/customer-requests?q=Ravi&limit=1&page=1', { db })
    const olderBody = await olderMatch.json()
    assert.equal(olderBody.requests[0].customerName, 'Ravi Kumar')
    assert.equal(olderBody.pagination.total, 1)
  })

  it('does not treat LIKE wildcards in the query as match-all', () => {
    const filter = buildAdminCustomerRequestListFilter({ q: '%' })
    assert.deepEqual(filter.binds, ['%\\%%', '%\\%%', '%\\%%'])
    assert.match(filter.whereSql, /ESCAPE '\\'/)
  })
})

function sqlLikeMatch(value, pattern) {
  let regex = ''
  const source = String(pattern ?? '')
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\') {
      const next = source[i + 1]
      if (next === undefined) {
        regex += '\\\\'
        break
      }
      regex += next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      i += 1
      continue
    }
    if (ch === '%') {
      regex += '[\\s\\S]*'
      continue
    }
    if (ch === '_') {
      regex += '[\\s\\S]'
      continue
    }
    regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${regex}$`, 'i').test(String(value ?? ''))
}

/**
 * @param {object[]} rows
 * @param {string} normalized
 * @param {unknown[]} params
 */
function filterCustomerRequestRows(rows, normalized, params) {
  let index = 0
  let filtered = rows
  if (normalized.includes('r.season_id = ?')) {
    const seasonId = String(params[index++])
    filtered = filtered.filter((row) => String(row.season_id ?? '') === seasonId)
  }
  if (normalized.includes('r.status = ?')) {
    const status = params[index++]
    filtered = filtered.filter((row) => row.status === status)
  }
  const likeCount = normalized.split('LIKE ?').length - 1
  if (likeCount > 0) {
    const referencePattern = normalized.includes('r.public_reference LIKE ?') ? String(params[index++] ?? '') : null
    const namePattern = String(params[index++] ?? '')
    const phonePattern = likeCount > (referencePattern ? 2 : 1) ? String(params[index++] ?? '') : null
    filtered = filtered.filter((row) => {
      if (referencePattern && sqlLikeMatch(row.public_reference, referencePattern)) return true
      if (sqlLikeMatch(row.customer_name, namePattern)) return true
      if (!phonePattern) return false
      return sqlLikeMatch(normalizeCustomerRequestPhoneSearch(row.customer_phone), phonePattern)
    })
  }
  if (normalized.includes('julianday(r.created_at)')) {
    const cutoff = Date.parse(String(params[index++]))
    filtered = filtered.filter(row => ['cr-737b1d5a26c757f6588763e787854700', '77ece069-78e3-4fab-8a4d-ad118845dd47'].includes(row.id) || Date.parse(row.created_at) >= cutoff)
  }
  return { filtered, nextIndex: index }
}

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
                if (email === ALLOWED_EMAIL.toLowerCase()) {
                  return { id: 'admin-u-1', email, role: 'owner', active: 1 }
                }
                return null
              }
              if (normalized.includes('SELECT id, status FROM customer_requests')) {
                const id = String(params[0])
                const seasonId = String(params[1] ?? '')
                const row = state.requests.get(id)
                if (!row || String(row.season_id ?? '') !== seasonId) return null
                return { id: row.id, status: row.status }
              }
              if (
                normalized.includes('FROM customer_requests') &&
                normalized.includes('WHERE id = ?') &&
                normalized.includes('season_id = ?')
              ) {
                const id = String(params[0])
                const seasonId = String(params[1])
                const row = state.requests.get(id)
                if (!row || String(row.season_id ?? '') !== seasonId) return null
                return row
              }
              if (normalized.includes('FROM customer_requests') && normalized.includes('WHERE id = ?')) {
                return state.requests.get(String(params[0])) ?? null
              }
              if (normalized.includes('COUNT(*) AS total FROM customer_requests')) {
                const { filtered } = filterCustomerRequestRows(
                  [...state.requests.values()],
                  normalized,
                  params,
                )
                return { total: filtered.length }
              }
              return null
            },
        async all() {
              if (normalized.includes('FROM season_members sm')) {
                return {
                  results: [
                    {
                      season_id: DEFAULT_ADMIN_SEASON_ID,
                      role: 'owner',
                      disabled_at: null,
                      created_at: '',
                      code: '2026',
                      label: 'Diwali 2026',
                      status: 'active',
                    },
                    {
                      season_id: 'season-2099',
                      role: 'owner',
                      disabled_at: null,
                      created_at: '',
                      code: '2099',
                      label: 'Other',
                      status: 'active',
                    },
                  ],
                }
              }
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
                db.lastListSql = normalized
                const { filtered, nextIndex } = filterCustomerRequestRows(
                  [...state.requests.values()],
                  normalized,
                  params,
                )
                const rows = filtered.sort((a, b) => {
                  const c = String(b.created_at).localeCompare(String(a.created_at))
                  return c !== 0 ? c : String(b.id).localeCompare(String(a.id))
                })
                const limit = params[nextIndex]
                const offset = params[nextIndex + 1]
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
                const hasClosure = normalized.includes('closed_by_email')
                const status = String(params[0])
                const id = String(hasClosure ? params[2] : params[1])
                const seasonId = String(hasClosure ? params[3] : params[2])
                const row = state.requests.get(id)
                if (!row || String(row.season_id ?? '') !== seasonId) {
                  return { meta: { changes: 0 } }
                }
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

  return bindAdminServiceMode(db, {})
}
