import assert from 'node:assert/strict'
import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'
import { describe, it } from 'node:test'
import { attachAdminSeasonContext } from '../src/middleware/requireAdmin.js'
import { handleAdminQuotationRoutes } from '../src/routes/adminQuotations.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import {
  createOrGetQuotationForRequest,
  getActiveQuotationForRequest,
  INSERT_QUOTATION_WITH_SEASON_SQL,
  patchActiveQuotationCustomerAgreedAmount,
} from '../src/services/adminQuotations.js'

const OTHER_SEASON_ID = 'season-2099'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'

describe('admin customer-request quotation routes season isolation', () => {
  it('returns 403 when active season is missing', async () => {
    const db = createQuotationRequestSeasonDb()
    const paths = [
      [`GET`, `/api/admin/customer-requests/${REQUEST_ID}/quotation`],
      [`POST`, `/api/admin/customer-requests/${REQUEST_ID}/quotation`],
      [`POST`, `/api/admin/customer-requests/${REQUEST_ID}/quotation/regenerate`],
      [`PATCH`, `/api/admin/customer-requests/${REQUEST_ID}/quotation/customer-agreed-amount`],
    ]
    for (const [method, path] of paths) {
      const init =
        method === 'GET'
          ? {}
          : {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ acceptedAmountInr: '1250.00' }),
            }
      const request = new Request(`https://example.com${path}`, init)
      const res = await handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), {
        email: 'owner@test.com',
        role: 'owner',
      })
      assert.equal(res.status, 403, `${method} ${path}`)
    }
  })

  it('returns not_found when request belongs to another season', async () => {
    const db = createQuotationRequestSeasonDb()
    const headers = { 'X-Admin-Season-Id': OTHER_SEASON_ID }
    for (const [method, path, body] of [
      ['GET', `/api/admin/customer-requests/${REQUEST_ID}/quotation`, null],
      ['POST', `/api/admin/customer-requests/${REQUEST_ID}/quotation`, '{}'],
      ['POST', `/api/admin/customer-requests/${REQUEST_ID}/quotation/regenerate`, '{}'],
      [
        'PATCH',
        `/api/admin/customer-requests/${REQUEST_ID}/quotation/customer-agreed-amount`,
        JSON.stringify({ acceptedAmountInr: '100.00' }),
      ],
    ]) {
      const request = new Request(`https://example.com${path}`, {
        method,
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ?? undefined,
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
      assert.equal(res.status, 404, `${method} ${path}`)
    }
  })

  it('GET returns not_found when quotation is scoped to another season', async () => {
    const db = createQuotationRequestSeasonDb({ quotationSeasonId: OTHER_SEASON_ID })
    const request = new Request(`https://example.com/api/admin/customer-requests/${REQUEST_ID}/quotation`, {
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

describe('admin quotation service season isolation', () => {
  it('returns forbidden when quotation create is called without season', async () => {
    const db = createQuotationRequestSeasonDb()
    const result = await createOrGetQuotationForRequest(db, REQUEST_ID, {
      createdByEmail: 'owner@test.com',
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
  })

  it('returns forbidden when agreed-amount patch is called without season', async () => {
    const db = createQuotationRequestSeasonDb({ seedActiveQuotation: true })
    const result = await patchActiveQuotationCustomerAgreedAmount(db, REQUEST_ID, 50_000, '')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
  })

  it('createOrGetQuotationForRequest stamps season_id on insert', async () => {
    const db = createQuotationRequestSeasonDb({ trackQuotationInsert: true })
    const result = await createOrGetQuotationForRequest(db, REQUEST_ID, {
      seasonId: DEFAULT_ADMIN_SEASON_ID,
      createdByEmail: 'owner@test.com',
    })
    assert.equal(result.ok, true)
    assert.equal(db.lastQuotationInsertSeasonId, DEFAULT_ADMIN_SEASON_ID)
  })

  it('regenerate createOrGetQuotationForRequest stamps season_id on insert', async () => {
    const db = createQuotationRequestSeasonDb({ trackQuotationInsert: true, seedActiveQuotation: true })
    const result = await createOrGetQuotationForRequest(db, REQUEST_ID, {
      regenerate: true,
      seasonId: DEFAULT_ADMIN_SEASON_ID,
      createdByEmail: 'owner@test.com',
    })
    assert.equal(result.ok, true)
    assert.equal(result.regenerated, true)
    assert.equal(db.lastQuotationInsertSeasonId, DEFAULT_ADMIN_SEASON_ID)
  })

  it('getActiveQuotationForRequest ignores quotations from other seasons', async () => {
    const db = createQuotationRequestSeasonDb({ quotationSeasonId: OTHER_SEASON_ID })
    const quotation = await getActiveQuotationForRequest(db, REQUEST_ID, DEFAULT_ADMIN_SEASON_ID)
    assert.equal(quotation, null)
  })

  it('patchActiveQuotationCustomerAgreedAmount does not update cross-season quotations', async () => {
    const db = createQuotationRequestSeasonDb({ quotationSeasonId: OTHER_SEASON_ID })
    const result = await patchActiveQuotationCustomerAgreedAmount(
      db,
      REQUEST_ID,
      50_000,
      DEFAULT_ADMIN_SEASON_ID,
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 404)
  })
})

/** @param {{ quotationSeasonId?: string, trackQuotationInsert?: boolean, seedActiveQuotation?: boolean }} [opts] */
function createQuotationRequestSeasonDb(opts = {}) {
  const quotationSeasonId = opts.quotationSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const trackQuotationInsert = opts.trackQuotationInsert === true
  const seedActiveQuotation = opts.seedActiveQuotation === true
  const insertSeasonSql = INSERT_QUOTATION_WITH_SEASON_SQL.replace(/\s+/g, ' ').trim()

  const requestRow = {
    id: REQUEST_ID,
    status: 'assigned',
    source: 'manual',
    customer_name: 'Guest',
    customer_phone: '9876543210',
    customer_area: null,
    pickup_preference: null,
    customer_note: null,
    season_id: DEFAULT_ADMIN_SEASON_ID,
  }
  const product = {
    id: 'P001',
    name: 'Test product',
    active: 1,
    selling_price_paise: 10_000,
    pieces_per_pack: null,
    allow_loose_sale: 0,
  }
  const quotationRow = {
    id: 'q-season-route-1',
    customer_request_id: REQUEST_ID,
    status: seedActiveQuotation ? 'draft' : 'draft',
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
  /** @type {Map<string, Record<string, unknown>>} */
  const quotationsById = new Map([[quotationRow.id, { ...quotationRow }]])

  const db = {
    lastQuotationInsertSeasonId: null,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          const stmt = {
            sql: normalized,
            params,
            async first() {
              if (normalized.includes('FROM season_members sm')) {
                return null
              }
              if (
                normalized.includes('FROM customer_requests') &&
                normalized.includes('WHERE id = ?') &&
                normalized.includes('season_id = ?')
              ) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id === REQUEST_ID && seasonId === requestRow.season_id) return requestRow
                return null
              }
              if (
                normalized.includes('FROM customer_requests') &&
                normalized.includes('WHERE id = ?') &&
                !normalized.includes('season_id')
              ) {
                return String(params[0]) === REQUEST_ID ? requestRow : null
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
                if (!seedActiveQuotation) return null
                return quotationRow.status !== 'void' ? quotationRow : null
              }
              if (normalized.includes('FROM quotations WHERE id = ?')) {
                const id = String(params[0])
                return quotationsById.get(id) ?? (id === quotationRow.id ? quotationRow : null)
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
                return { results: [] }
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
                      unit_price_paise: 10_000,
                    },
                  ],
                }
              }
              return { results: [] }
            },
            async run() {
              if (normalized.includes('UPDATE quotations SET accepted_amount_paise')) {
                return { meta: { changes: 0 } }
              }
              if (normalized.includes("UPDATE quotations SET status = 'void'")) {
                const id = String(params[0])
                const seasonId = String(params[1] ?? '')
                const row = quotationsById.get(id) ?? (id === quotationRow.id ? quotationRow : null)
                if (!row || String(row.season_id ?? '') !== seasonId) {
                  return { meta: { changes: 0 } }
                }
                row.status = 'void'
                return { meta: { changes: 1 } }
              }
              if (normalized.includes('UPDATE customer_requests SET status')) {
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 1 } }
            },
          }
          if (trackQuotationInsert && normalized === insertSeasonSql) {
            stmt.trackSeasonInsert = true
          }
          return stmt
        },
      }
    },
    async batch(statements) {
      for (const stmt of statements) {
        if (stmt.trackSeasonInsert) {
          db.lastQuotationInsertSeasonId = String(stmt.params[stmt.params.length - 1] ?? '')
          const newId = String(stmt.params[0])
          quotationsById.set(newId, {
            ...quotationRow,
            id: newId,
            season_id: db.lastQuotationInsertSeasonId,
            status: 'draft',
          })
        }
      }
    },
  }
  return bindAdminServiceMode(db, {})
}
