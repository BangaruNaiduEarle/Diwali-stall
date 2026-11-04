import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attachAdminSeasonContext } from '../src/middleware/requireAdmin.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { handleAdminQuotationRoutes } from '../src/routes/adminQuotations.js'
import { filterCustomerRequestDetailForRole } from '../src/lib/adminQuotationResponse.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import {
  enrichAdminCustomerRequestListForRole,
  getAdminCustomerRequestById,
  markCustomerRequestPendingFinalization,
  recordPublicCustomerAgreementPendingFinalization,
  updateAdminCustomerRequestStatus,
} from '../src/services/adminCustomerRequests.js'

const OTHER_SEASON_ID = 'season-2099'
const ARCHIVED_SEASON_ID = 'season-archived'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const QUOTATION_ID = 'q-season-iso-1'

describe('admin customer request season authorization routes', () => {
  it('returns 403 when season membership is missing', async () => {
    const db = createSeasonIsolationDb({ memberships: [] })
    const request = new Request('https://example.com/api/admin/customer-requests', {
      headers: { 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'u-none',
      email: 'none@test.com',
      role: 'owner',
    })
    const res = await handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), {
      email: 'none@test.com',
      role: 'owner',
    })
    assert.equal(res.status, 403)
  })

  it('season admin cannot finalize even with global owner identity', async () => {
    const db = createSeasonIsolationDb({
      memberships: [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active')],
    })
    const request = new Request(
      `https://example.com/api/admin/customer-requests/${REQUEST_ID}/finalize`,
      {
        method: 'PATCH',
        headers: { 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
      },
    )
    await attachAdminSeasonContext(request, db, {
      userId: 'u-admin',
      email: 'admin@test.com',
      role: 'owner',
    })
    const res = await handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), {
      email: 'admin@test.com',
      role: 'owner',
    })
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.match(body.message, /Owner or Super Admin/i)
  })

  it('season admin can patch status on writable season', async () => {
    const db = createSeasonIsolationDb({
      memberships: [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active')],
    })
    const request = new Request(
      `https://example.com/api/admin/customer-requests/${REQUEST_ID}/status`,
      {
        method: 'PATCH',
        headers: {
          'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'reviewing' }),
      },
    )
    await attachAdminSeasonContext(request, db, {
      userId: 'u-admin',
      email: 'admin@test.com',
      role: 'owner',
    })
    const res = await handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), {
      email: 'admin@test.com',
      role: 'owner',
    })
    assert.equal(res.status, 200)
  })

  it('allows archived season reads and blocks finalize writes', async () => {
    const db = createSeasonIsolationDb({
      requestSeasonId: ARCHIVED_SEASON_ID,
      memberships: [membershipRow(ARCHIVED_SEASON_ID, 'owner', 'archived')],
    })
    const getReq = new Request(`https://example.com/api/admin/customer-requests/${REQUEST_ID}`, {
      headers: { 'X-Admin-Season-Id': ARCHIVED_SEASON_ID },
    })
    await attachAdminSeasonContext(getReq, db, {
      userId: 'u-archived',
      email: 'archived@test.com',
      role: 'owner',
    })
    const getRes = await handleAdminCustomerRequestRoutes(getReq, { DB: db }, new URL(getReq.url), {
      email: 'archived@test.com',
      role: 'owner',
    })
    assert.equal(getRes.status, 200)

    const patchReq = new Request(
      `https://example.com/api/admin/customer-requests/${REQUEST_ID}/finalize`,
      {
        method: 'PATCH',
        headers: { 'X-Admin-Season-Id': ARCHIVED_SEASON_ID },
      },
    )
    await attachAdminSeasonContext(patchReq, db, {
      userId: 'u-archived',
      email: 'archived@test.com',
      role: 'owner',
    })
    const patchRes = await handleAdminCustomerRequestRoutes(
      patchReq,
      { DB: db },
      new URL(patchReq.url),
      { email: 'archived@test.com', role: 'owner' },
    )
    assert.equal(patchRes.status, 403)
    assert.match((await patchRes.json()).message, /archived/i)
  })
})

describe('admin customer request season isolation', () => {
  it('returns 403 on list and detail when active season is missing', async () => {
    const db = createSeasonIsolationDb()
    for (const path of ['/api/admin/customer-requests', `/api/admin/customer-requests/${REQUEST_ID}`]) {
      const request = new Request(`https://example.com${path}`)
      const res = await handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), {
        email: 'owner@test.com',
        role: 'owner',
      })
      assert.equal(res.status, 403, path)
      const body = await res.json()
      assert.equal(body.error, 'forbidden')
    }
  })

  it('returns not_found for detail when request is in another season', async () => {
    const db = createSeasonIsolationDb()
    const request = new Request(`https://example.com/api/admin/customer-requests/${REQUEST_ID}`, {
      headers: { 'X-Admin-Season-Id': OTHER_SEASON_ID },
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), {
      email: 'owner@test.com',
      role: 'owner',
    })
    assert.equal(res.status, 404)
  })

  it('scopes list enrichment to the active season', async () => {
    const db = createSeasonIsolationDb()
    const inSeason = await enrichAdminCustomerRequestListForRole(
      db,
      [
        { id: REQUEST_ID, seasonId: DEFAULT_ADMIN_SEASON_ID },
        { id: 'cr-other', seasonId: OTHER_SEASON_ID },
      ],
      'owner',
      DEFAULT_ADMIN_SEASON_ID,
    )
    assert.equal(inSeason[0]?.auditSummary?.sellingSubtotalPaise, 10000)
    assert.equal(inSeason[1]?.auditSummary, undefined)
  })

  it('returns forbidden when pending finalization is marked without season', async () => {
    const db = createSeasonIsolationDb()
    const result = await markCustomerRequestPendingFinalization(db, REQUEST_ID, '')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
  })

  it('returns not_found when status update targets another season', async () => {
    const db = createSeasonIsolationDb()
    const result = await updateAdminCustomerRequestStatus(db, REQUEST_ID, 'quoted', {
      seasonId: OTHER_SEASON_ID,
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 404)
  })

  it('returns forbidden when recording public customer agreement without season', async () => {
    const db = createSeasonIsolationDb()
    const result = await recordPublicCustomerAgreementPendingFinalization(db, REQUEST_ID, '')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
  })

  it('returns not_found when public customer agreement targets another season', async () => {
    const db = createSeasonIsolationDb()
    const result = await recordPublicCustomerAgreementPendingFinalization(
      db,
      REQUEST_ID,
      OTHER_SEASON_ID,
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 404)
  })

  it('omits internal pricing view for cross-season products on detail filter', async () => {
    const db = createSeasonIsolationDb({ productSeasonId: OTHER_SEASON_ID })
    const detail = await getAdminCustomerRequestById(db, REQUEST_ID, DEFAULT_ADMIN_SEASON_ID)
    assert.ok(detail)
    const filtered = await filterCustomerRequestDetailForRole(db, detail, 'owner', DEFAULT_ADMIN_SEASON_ID)
    assert.equal(filtered.internalPricingView, undefined)
  })
})

describe('admin quotation season authorization routes', () => {
  it('blocks customer-agreed amount for season admin with global super_admin identity', async () => {
    const db = createSeasonIsolationDb({
      memberships: [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active')],
    })
    const request = new Request(
      `https://example.com/api/admin/customer-requests/${REQUEST_ID}/quotation/customer-agreed-amount`,
      {
        method: 'PATCH',
        headers: {
          'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ acceptedAmountInr: '100.00' }),
      },
    )
    await attachAdminSeasonContext(request, db, {
      userId: 'u-admin',
      email: 'admin@test.com',
      role: 'super_admin',
    })
    const res = await handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), {
      email: 'admin@test.com',
      role: 'super_admin',
    })
    assert.equal(res.status, 403)
  })

  it('blocks quotation regenerate POST on archived season', async () => {
    const db = createSeasonIsolationDb({
      requestSeasonId: ARCHIVED_SEASON_ID,
      memberships: [membershipRow(ARCHIVED_SEASON_ID, 'owner', 'archived')],
    })
    const request = new Request(
      `https://example.com/api/admin/customer-requests/${REQUEST_ID}/quotation/regenerate`,
      {
        method: 'POST',
        headers: { 'X-Admin-Season-Id': ARCHIVED_SEASON_ID },
      },
    )
    await attachAdminSeasonContext(request, db, {
      userId: 'u-archived',
      email: 'archived@test.com',
      role: 'owner',
    })
    const res = await handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), {
      email: 'archived@test.com',
      role: 'owner',
    })
    assert.equal(res.status, 403)
    assert.match((await res.json()).message, /archived/i)
  })
})

describe('admin quotation detail season isolation', () => {
  it('returns 403 when active season is missing', async () => {
    const db = createSeasonIsolationDb()
    const request = new Request(`https://example.com/api/admin/quotations/${QUOTATION_ID}`)
    const res = await handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), {
      email: 'owner@test.com',
    })
    assert.equal(res.status, 403)
  })

  it('returns not_found when quotation belongs to another season', async () => {
    const db = createSeasonIsolationDb()
    const request = new Request(`https://example.com/api/admin/quotations/${QUOTATION_ID}`, {
      headers: { 'X-Admin-Season-Id': OTHER_SEASON_ID },
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), {
      email: 'owner@test.com',
    })
    assert.equal(res.status, 404)
  })
})

function membershipRow(seasonId, role, status) {
  return {
    season_id: seasonId,
    role,
    disabled_at: null,
    created_at: '',
    code: seasonId.replace('season-', ''),
    label: seasonId,
    status,
  }
}

/** @param {{ productSeasonId?: string, requestSeasonId?: string, memberships?: Record<string, unknown>[] }} [opts] */
function createSeasonIsolationDb(opts = {}) {
  const productSeasonId = opts.productSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const requestSeasonId = opts.requestSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const membershipRows =
    opts.memberships ??
    [
      membershipRow(DEFAULT_ADMIN_SEASON_ID, 'owner', 'active'),
      membershipRow(OTHER_SEASON_ID, 'owner', 'active'),
    ]
  const requestRow = {
    id: REQUEST_ID,
    public_reference: 'REF1',
    status: 'quoted',
    source: 'manual',
    customer_name: 'Guest',
    customer_phone: '9876543210',
    customer_area: null,
    pickup_preference: null,
    customer_note: null,
    delivery_address: null,
    delivery_landmark: null,
    delivery_maps_url: null,
    finalization_status: 'pending',
    assigned_to_email: 'staff@test.com',
    assigned_by_email: null,
    assigned_at: null,
    closed_by_email: null,
    closed_at: null,
    created_at: '2026-10-18 00:00:00',
    updated_at: '2026-10-18 00:00:00',
    season_id: requestSeasonId,
  }
  const product = {
    id: 'P001',
    season_id: productSeasonId,
    name: 'Test product',
    company: null,
    active: 1,
    stock_status: 'available',
    selling_price_paise: 10000,
    final_price_paise: null,
    pieces_per_pack: null,
    allow_loose_sale: 0,
  }
  const quotationRow = {
    id: QUOTATION_ID,
    customer_request_id: REQUEST_ID,
    status: 'draft',
    customer_name: requestRow.customer_name,
    customer_phone: requestRow.customer_phone,
    customer_note: null,
    currency: 'INR',
    subtotal_paise: 10000,
    adjustment_paise: 0,
    total_paise: 10000,
    wa_message_text: null,
    created_by_email: null,
    created_at: '2026-10-18 00:00:00',
    updated_at: '2026-10-18 00:00:00',
    pricing_mode: null,
    selling_subtotal_paise: null,
    final_subtotal_paise: null,
    bargain_floor_paise: null,
    accepted_amount_paise: null,
    season_id: DEFAULT_ADMIN_SEASON_ID,
  }

  const db = {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM platform_admins')) {
                return null
              }
              if (normalized.includes('FROM season_members sm')) {
                return null
              }
              if (normalized.includes('FROM customer_requests') && normalized.includes('season_id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id === REQUEST_ID && seasonId === requestRow.season_id) return requestRow
                return null
              }
              if (normalized.includes('FROM customer_requests') && normalized.includes('WHERE id = ?')) {
                return String(params[0]) === REQUEST_ID ? requestRow : null
              }
              if (normalized.includes('FROM products') && normalized.includes('season_id = ?')) {
                const productId = String(params[0])
                const seasonId = String(params[1])
                if (productId === product.id && seasonId === productSeasonId) return product
                return null
              }
              if (normalized.includes('SELECT season_id FROM quotations WHERE id = ?')) {
                return String(params[0]) === QUOTATION_ID
                  ? { season_id: quotationRow.season_id }
                  : null
              }
              if (normalized.includes('FROM quotations') && normalized.includes('customer_request_id = ?')) {
                return String(params[0]) === REQUEST_ID ? quotationRow : null
              }
              if (normalized.includes('FROM quotations WHERE id = ?')) {
                return String(params[0]) === QUOTATION_ID ? quotationRow : null
              }
              if (normalized.includes('COUNT(*) AS total FROM customer_requests')) {
                return { total: 1 }
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM season_members sm')) {
                return { results: membershipRows }
              }
              if (normalized.includes('FROM customer_request_items')) {
                return {
                  results: [
                    {
                      line_number: 1,
                      product_id: 'P001',
                      family_pack_id: null,
                      product_name: 'Test product',
                      quantity: 1,
                      unit_price_paise: 10000,
                    },
                  ],
                }
              }
              if (normalized.includes('FROM quotation_items')) {
                return {
                  results: [
                    {
                      line_number: 1,
                      product_id: 'P001',
                      product_name: 'Test product',
                      quantity: 1,
                      unit_rate_paise: 10000,
                      line_total_paise: 10000,
                    },
                  ],
                }
              }
              if (normalized.includes('FROM customer_requests r')) {
                return {
                  results: [
                    {
                      id: REQUEST_ID,
                      public_reference: 'REF1',
                      status: 'quoted',
                      source: 'manual',
                      customer_name: 'Guest',
                      customer_phone: '9876543210',
                      customer_area: null,
                      finalization_status: 'pending',
                      assigned_to_email: null,
                      assigned_by_email: null,
                      assigned_at: null,
                      closed_by_email: null,
                      closed_at: null,
                      created_at: '2026-10-18 00:00:00',
                      season_id: DEFAULT_ADMIN_SEASON_ID,
                      item_count: 1,
                    },
                  ],
                }
              }
              return { results: [] }
            },
            async run() {
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
    async batch() {},
  }
  return bindAdminServiceMode(db, { ADMIN_LOCATION_MODE: '0' })
}
