import assert from 'node:assert/strict'
import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'
import { describe, it } from 'node:test'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import {
  adjustPendingCustomerRequestBill,
  DELETE_CUSTOMER_REQUEST_ITEMS_FOR_SEASON_SQL,
  isCustomerRequestEligibleForBillAdjust,
  previewPendingCustomerRequestBillAdjust,
  validateAdjustBillBody,
} from '../src/services/adminCustomerRequestBillAdjust.js'
import { INSERT_QUOTATION_WITH_SEASON_SQL } from '../src/services/adminQuotations.js'

const OTHER_SEASON_ID = 'season-2099'
const REQUEST_ID = 'cr-adjust-test-1'

describe('isCustomerRequestEligibleForBillAdjust', () => {
  it('allows pending non-terminal requests', () => {
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        source: 'manual',
        finalization_status: 'pending',
        status: 'assigned',
      }),
      true,
    )
  })

  it('allows pending public web requests to adjust products', () => {
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        source: 'web',
        finalization_status: 'pending',
        status: 'open',
      }),
      true,
    )
  })

  it('rejects finalized, closed, or void', () => {
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        finalization_status: 'finalized',
        status: 'closed',
      }),
      false,
    )
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        finalization_status: 'pending',
        status: 'closed',
      }),
      false,
    )
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        finalization_status: 'pending',
        status: 'void',
      }),
      false,
    )
  })
})

describe('validateAdjustBillBody', () => {
  it('requires quick-bill style items', () => {
    const ok = validateAdjustBillBody({
      items: [{ productId: 'P001', quantity: 2, unitType: 'box' }],
    })
    assert.equal(ok.ok, true)
    const bad = validateAdjustBillBody({ items: [] })
    assert.equal(bad.ok, false)
  })
})

describe('bill adjust season isolation', () => {
  it('returns 403 on adjust-bill routes when active season is missing', async () => {
    const db = createBillAdjustMockDb()
    const previewBody = { items: [{ productId: 'P001', quantity: 1, unitType: 'box' }] }
    for (const path of [
      `/api/admin/customer-requests/${REQUEST_ID}/adjust-bill/preview`,
      `/api/admin/customer-requests/${REQUEST_ID}/adjust-bill`,
    ]) {
      const request = new Request(`https://example.com${path}`, {
        method: path.endsWith('preview') ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewBody),
      })
      const res = await handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), {
        email: 'owner@test.com',
        role: 'owner',
      })
      assert.equal(res.status, 403, path)
      const body = await res.json()
      assert.equal(body.error, 'forbidden')
    }
  })

  it('returns not_found when request belongs to another season', async () => {
    const db = createBillAdjustMockDb()
    const result = await previewPendingCustomerRequestBillAdjust(
      db,
      REQUEST_ID,
      [{ productId: 'P001', quantity: 1, unitType: 'box' }],
      OTHER_SEASON_ID,
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 404)
    assert.equal(result.code, 'not_found')
  })

  it('returns no_quotation when active quotation belongs to another season', async () => {
    const db = createBillAdjustMockDb({ quotationSeasonId: OTHER_SEASON_ID })
    const result = await previewPendingCustomerRequestBillAdjust(
      db,
      REQUEST_ID,
      [{ productId: 'P001', quantity: 1, unitType: 'box' }],
      DEFAULT_ADMIN_SEASON_ID,
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 400)
    assert.equal(result.code, 'no_quotation')
  })

  it('stamps season_id when bill adjust inserts a replacement quotation', async () => {
    const db = createBillAdjustMockDb({ trackQuotationInsert: true })
    const result = await adjustPendingCustomerRequestBill(
      db,
      REQUEST_ID,
      [{ productId: 'P001', quantity: 1, unitType: 'box' }],
      { seasonId: DEFAULT_ADMIN_SEASON_ID, adjustedByEmail: 'owner@test.com' },
    )
    assert.equal(result.ok, true)
    assert.equal(db.lastQuotationInsertSeasonId, DEFAULT_ADMIN_SEASON_ID)
    assert.equal(db.lastQuotationVoidSeasonId, DEFAULT_ADMIN_SEASON_ID)
  })

  it('rejects products outside the active season on preview', async () => {
    const db = createBillAdjustMockDb({
      requestSeasonId: OTHER_SEASON_ID,
      productSeasonId: DEFAULT_ADMIN_SEASON_ID,
    })
    const result = await previewPendingCustomerRequestBillAdjust(
      db,
      REQUEST_ID,
      [{ productId: 'P001', quantity: 1, unitType: 'box' }],
      OTHER_SEASON_ID,
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.fields?.['items[0].productId'], 'Product not found.')
  })

  it('scopes family pack quote lines by season in adjust bill preview', async () => {
    const db = createBillAdjustMockDb({
      existingRequestItems: [
        {
          line_number: 1,
          product_id: null,
          family_pack_id: 'FP1',
          product_name: 'Family pack',
          quantity: 1,
          unit_price_paise: null,
        },
      ],
      familyPackSeasonId: OTHER_SEASON_ID,
    })
    const result = await previewPendingCustomerRequestBillAdjust(
      db,
      REQUEST_ID,
      [{ productId: 'P001', quantity: 1, unitType: 'box' }],
      DEFAULT_ADMIN_SEASON_ID,
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.fields?.['items[2]'], 'Family pack is not available.')
  })

  it('deletes request items using a season-scoped delete on adjust', async () => {
    const db = createBillAdjustMockDb({ trackQuotationInsert: true, trackItemDelete: true })
    const result = await adjustPendingCustomerRequestBill(
      db,
      REQUEST_ID,
      [{ productId: 'P001', quantity: 1, unitType: 'box' }],
      { seasonId: DEFAULT_ADMIN_SEASON_ID, adjustedByEmail: 'owner@test.com' },
    )
    assert.equal(result.ok, true)
    assert.equal(db.lastItemDeleteSeasonId, DEFAULT_ADMIN_SEASON_ID)
    assert.equal(db.lastItemDeleteRequestId, REQUEST_ID)
  })
})

/** @param {{ requestSeasonId?: string, productSeasonId?: string, quotationSeasonId?: string, trackQuotationInsert?: boolean, trackItemDelete?: boolean, existingRequestItems?: Record<string, unknown>[], familyPackSeasonId?: string }} [opts] */
function createBillAdjustMockDb(opts = {}) {
  const requestSeasonId = opts.requestSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const productSeasonId = opts.productSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const quotationSeasonId = opts.quotationSeasonId ?? requestSeasonId
  const trackQuotationInsert = opts.trackQuotationInsert === true
  const trackItemDelete = opts.trackItemDelete === true
  const existingRequestItems = opts.existingRequestItems ?? []
  const familyPackSeasonId = opts.familyPackSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const deleteItemSql = DELETE_CUSTOMER_REQUEST_ITEMS_FOR_SEASON_SQL.replace(/\s+/g, ' ').trim()
  const familyPack = {
    id: 'FP1',
    name: 'Family pack',
    active: 1,
    selling_price_paise: 5000,
  }
  const request = {
    id: REQUEST_ID,
    public_reference: 'ADJ1',
    status: 'quoted',
    source: 'manual',
    finalization_status: 'pending',
    season_id: requestSeasonId,
    customer_name: 'Guest',
    customer_phone: '9876543210',
    customer_note: null,
    customer_area: null,
    pickup_preference: null,
    delivery_address: null,
    delivery_landmark: null,
    delivery_maps_url: null,
    assigned_to_email: null,
    assigned_by_email: null,
    assigned_at: null,
    closed_by_email: null,
    closed_at: null,
    created_at: '2026-10-18 00:00:00',
    updated_at: '2026-10-18 00:00:00',
  }
  const quotation = {
    id: 'q-1',
    customer_request_id: REQUEST_ID,
    status: 'draft',
    pricing_mode: 'selling',
    accepted_amount_paise: null,
    bargain_floor_paise: null,
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

  const insertSeasonSql = INSERT_QUOTATION_WITH_SEASON_SQL.replace(/\s+/g, ' ').trim()

  const db = {
    lastQuotationInsertSeasonId: null,
    lastQuotationVoidSeasonId: null,
    lastItemDeleteSeasonId: null,
    lastItemDeleteRequestId: null,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          const stmt = {
            sql: normalized,
            params,
            async first() {
              if (
                normalized.includes('FROM customer_requests') &&
                normalized.includes('season_id = ?') &&
                normalized.includes('finalization_status')
              ) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id !== REQUEST_ID || seasonId !== requestSeasonId) return null
                return request
              }
              if (
                normalized.includes('FROM customer_requests') &&
                normalized.includes('season_id = ?') &&
                normalized.includes('public_reference')
              ) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id !== REQUEST_ID || seasonId !== requestSeasonId) return null
                return request
              }
              if (
                normalized.includes('FROM quotations') &&
                normalized.includes('customer_request_id = ?') &&
                normalized.includes('season_id = ?')
              ) {
                const reqId = String(params[0])
                const seasonId = String(params[1])
                if (reqId !== REQUEST_ID || seasonId !== quotationSeasonId) return null
                return quotation.status !== 'void' ? quotation : null
              }
              if (
                normalized.includes('FROM customer_requests') &&
                normalized.includes('customer_name') &&
                normalized.includes('season_id = ?')
              ) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id !== REQUEST_ID || seasonId !== requestSeasonId) return null
                return request
              }
              if (normalized.includes('FROM products') && normalized.includes('season_id = ?')) {
                const productId = String(params[0])
                const seasonId = String(params[1])
                if (productId !== product.id || seasonId !== productSeasonId) return null
                return product
              }
              if (normalized.includes('FROM products') && normalized.includes('WHERE id = ?')) {
                return String(params[0]) === product.id ? product : null
              }
              if (normalized.includes('FROM family_packs') && normalized.includes('season_id = ?')) {
                const packId = String(params[0])
                const seasonId = String(params[1])
                if (packId === familyPack.id && seasonId === familyPackSeasonId) return familyPack
                return null
              }
              if (normalized.includes('FROM private_rates')) {
                return null
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM customer_request_items')) {
                return { results: existingRequestItems }
              }
              return { results: [] }
            },
            async run() {
              return { meta: { changes: 1 } }
            },
          }
          if (trackQuotationInsert && normalized === insertSeasonSql) {
            stmt.trackSeasonInsert = true
          }
          if (
            trackQuotationInsert &&
            normalized.includes("UPDATE quotations SET status = 'void'") &&
            normalized.includes('season_id = ?')
          ) {
            stmt.trackSeasonVoid = true
          }
          if (trackItemDelete && normalized === deleteItemSql) {
            stmt.trackItemDelete = true
          }
          return stmt
        },
      }
    },
    async batch(statements) {
      for (const stmt of statements) {
        if (trackQuotationInsert && stmt.trackSeasonInsert) {
          db.lastQuotationInsertSeasonId = String(stmt.params[stmt.params.length - 1] ?? '')
        }
        if (trackQuotationInsert && stmt.trackSeasonVoid) {
          db.lastQuotationVoidSeasonId = String(stmt.params[stmt.params.length - 1] ?? '')
        }
        if (trackItemDelete && stmt.trackItemDelete) {
          db.lastItemDeleteRequestId = String(stmt.params[0] ?? '')
          db.lastItemDeleteSeasonId = String(stmt.params[2] ?? '')
        }
      }
    },
  }
  return bindAdminServiceMode(db, {})
}
