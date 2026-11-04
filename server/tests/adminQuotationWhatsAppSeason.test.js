import assert from 'node:assert/strict'
import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'
import { describe, it } from 'node:test'
import { attachAdminSeasonContext } from '../src/middleware/requireAdmin.js'
import { handleAdminQuotationRoutes } from '../src/routes/adminQuotations.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import {
  getOrderConfirmationWhatsAppPayload,
  getQuotationWhatsAppPayload,
} from '../src/services/adminQuotations.js'

const OTHER_SEASON_ID = 'season-2099'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const QUOTATION_ID = 'q-wa-season-1'

describe('admin quotation WhatsApp season isolation (routes)', () => {
  it('returns 403 when active season is missing on WhatsApp prepare routes', async () => {
    const db = createWhatsAppSeasonDb()
    const paths = [
      `/api/admin/customer-requests/${REQUEST_ID}/order-confirmation/whatsapp`,
      `/api/admin/quotations/${QUOTATION_ID}/whatsapp`,
    ]
    for (const path of paths) {
      const request = new Request(`https://example.com${path}`)
      const res = await handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), {
        email: 'owner@test.com',
        role: 'owner',
      })
      assert.equal(res.status, 403, path)
    }
  })

  it('returns not_found for order-confirmation when request is in another season', async () => {
    const db = createWhatsAppSeasonDb()
    const request = new Request(
      `https://example.com/api/admin/customer-requests/${REQUEST_ID}/order-confirmation/whatsapp`,
      { headers: { 'X-Admin-Season-Id': OTHER_SEASON_ID } },
    )
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), {
      email: 'owner@test.com',
      role: 'owner',
    })
    assert.equal(res.status, 404)
  })

  it('returns not_found for quotation WhatsApp when quotation is in another season', async () => {
    const db = createWhatsAppSeasonDb({ quotationSeasonId: OTHER_SEASON_ID })
    const request = new Request(`https://example.com/api/admin/quotations/${QUOTATION_ID}/whatsapp`, {
      headers: { 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), {
      email: 'owner@test.com',
      role: 'owner',
    })
    assert.equal(res.status, 404)
  })
})

describe('admin quotation WhatsApp season isolation (services)', () => {
  it('returns forbidden when seasonId is missing', async () => {
    const db = createWhatsAppSeasonDb()
    for (const fn of [
      () => getOrderConfirmationWhatsAppPayload(db, REQUEST_ID, ''),
      () => getQuotationWhatsAppPayload(db, QUOTATION_ID, ''),
    ]) {
      const result = await fn()
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.status, 403)
    }
  })

  it('returns not_found for cross-season order-confirmation payload', async () => {
    const db = createWhatsAppSeasonDb()
    const result = await getOrderConfirmationWhatsAppPayload(db, REQUEST_ID, OTHER_SEASON_ID)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 404)
  })

  it('returns not_found for cross-season quotation WhatsApp payload', async () => {
    const db = createWhatsAppSeasonDb({ quotationSeasonId: OTHER_SEASON_ID })
    const result = await getQuotationWhatsAppPayload(db, QUOTATION_ID, DEFAULT_ADMIN_SEASON_ID)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 404)
  })
})

/** @param {{ quotationSeasonId?: string }} [opts] */
function createWhatsAppSeasonDb(opts = {}) {
  return bindAdminServiceMode(unconfiguredWhatsAppSeasonDb(opts), {})
}
function unconfiguredWhatsAppSeasonDb(opts = {}) {
  const quotationSeasonId = opts.quotationSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const requestRow = {
    id: REQUEST_ID,
    public_reference: 'REF-WA',
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
    created_at: '2026-10-18 00:00:00',
    updated_at: '2026-10-18 00:00:00',
    season_id: DEFAULT_ADMIN_SEASON_ID,
  }
  const quotationRow = {
    id: QUOTATION_ID,
    customer_request_id: REQUEST_ID,
    status: 'draft',
    customer_name: requestRow.customer_name,
    customer_phone: requestRow.customer_phone,
    customer_note: null,
    currency: 'INR',
    subtotal_paise: 10_000,
    adjustment_paise: 0,
    total_paise: 10_000,
    wa_message_text: null,
    created_by_email: null,
    created_at: '2026-10-18 00:00:00',
    updated_at: '2026-10-18 00:00:00',
    pricing_mode: null,
    selling_subtotal_paise: null,
    final_subtotal_paise: null,
    bargain_floor_paise: null,
    accepted_amount_paise: null,
    season_id: quotationSeasonId,
  }
  const product = {
    id: 'P001',
    name: 'Test product',
    active: 1,
    selling_price_paise: 10_000,
    pieces_per_pack: null,
    allow_loose_sale: 0,
  }

  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM season_members sm')) {
                return null
              }
              if (normalized.includes('SELECT season_id FROM quotations WHERE id = ?')) {
                return String(params[0]) === QUOTATION_ID
                  ? { season_id: quotationRow.season_id }
                  : null
              }
              if (
                normalized.includes('FROM customer_requests') &&
                normalized.includes('season_id = ?') &&
                normalized.includes('delivery_address')
              ) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id !== REQUEST_ID || seasonId !== requestRow.season_id) return null
                return requestRow
              }
              if (
                normalized.includes('FROM customer_requests') &&
                normalized.includes('customer_phone') &&
                normalized.includes('season_id = ?')
              ) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id !== REQUEST_ID || seasonId !== requestRow.season_id) return null
                return {
                  customer_phone: requestRow.customer_phone,
                  pickup_preference: requestRow.pickup_preference,
                  source: requestRow.source,
                }
              }
              if (normalized.includes('FROM products') && normalized.includes('season_id = ?')) {
                const productId = String(params[0])
                const seasonId = String(params[1])
                if (productId === product.id && seasonId === DEFAULT_ADMIN_SEASON_ID) return product
                return null
              }
              if (
                normalized.includes('FROM quotations') &&
                normalized.includes('customer_request_id = ?') &&
                normalized.includes('season_id = ?')
              ) {
                const reqId = String(params[0])
                const seasonId = String(params[1])
                if (reqId !== REQUEST_ID || seasonId !== quotationSeasonId) return null
                return quotationRow.status !== 'void' ? quotationRow : null
              }
              if (normalized.includes('FROM quotations WHERE id = ?')) {
                return String(params[0]) === QUOTATION_ID ? quotationRow : null
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
                      season_id: OTHER_SEASON_ID,
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
              if (
                normalized.includes('FROM customer_request_items i') &&
                normalized.includes('customer_requests r')
              ) {
                const reqId = String(params[0])
                const seasonId = String(params[1])
                if (reqId !== REQUEST_ID || seasonId !== requestRow.season_id) {
                  return { results: [] }
                }
                return {
                  results: [
                    {
                      line_number: 1,
                      product_id: 'P001',
                      family_pack_id: null,
                      product_name: 'Test product',
                      quantity: 1,
                      unit_price_paise: 10_000,
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
                      unit_rate_paise: 10_000,
                      line_total_paise: 10_000,
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
}
