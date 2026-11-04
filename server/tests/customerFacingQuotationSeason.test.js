import assert from 'node:assert/strict'
import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'
import { describe, it } from 'node:test'
import {
  computeCustomerFacingQuotationTotalPaise,
  resolveQuotationPresentationSeasonId,
} from '../src/lib/customerFacingQuotationTotal.js'
import { buildQuoteLinesForRequestItems } from '../src/services/adminQuotations.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const OTHER_SEASON_ID = 'season-2099'
const PUBLIC_CATALOGUE_SEASON_ID = 'season-public-catalogue'
const REQUEST_ID = 'cr-quote-season-1'
const PACK_ID = 'FP001'

describe('buildQuoteLinesForRequestItems family pack season', () => {
  it('rejects family pack catalogue lookup when seasonId is missing', async () => {
    const db = createQuoteLinesSeasonDb()
    const result = await buildQuoteLinesForRequestItems(db, [
      {
        line_number: 1,
        product_id: null,
        family_pack_id: PACK_ID,
        product_name: 'Pack',
        quantity: 1,
        unit_price_paise: null,
      },
    ])
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.fields?.['items[1]'], 'Family pack is not available.')
  })

  it('rejects family pack lines outside the active season', async () => {
    const db = createQuoteLinesSeasonDb({ packSeasonId: OTHER_SEASON_ID })
    const result = await buildQuoteLinesForRequestItems(
      db,
      [
        {
          line_number: 1,
          product_id: null,
          family_pack_id: PACK_ID,
          product_name: 'Pack',
          quantity: 1,
          unit_price_paise: null,
        },
      ],
      DEFAULT_ADMIN_SEASON_ID,
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.fields?.['items[1]'], 'Family pack is not available.')
  })

  it('still builds product-only lines when seasonId is missing', async () => {
    const db = createQuoteLinesSeasonDb()
    const result = await buildQuoteLinesForRequestItems(db, [
      {
        line_number: 1,
        product_id: 'P001',
        family_pack_id: null,
        product_name: 'Product',
        quantity: 1,
        unit_price_paise: null,
      },
    ])
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.quoteLines.length, 1)
    assert.equal(result.quoteLines[0].product_id, 'P001')
  })
})

describe('computeCustomerFacingQuotationTotalPaise season', () => {
  it('resolves season from quotation or parent customer request', async () => {
    const db = createPresentationSeasonDb()
    const fromQuotation = await resolveQuotationPresentationSeasonId(
      db,
      { seasonId: DEFAULT_ADMIN_SEASON_ID },
      REQUEST_ID,
    )
    assert.equal(fromQuotation, DEFAULT_ADMIN_SEASON_ID)

    const fromRequest = await resolveQuotationPresentationSeasonId(db, {}, REQUEST_ID)
    assert.equal(fromRequest, DEFAULT_ADMIN_SEASON_ID)
  })

  it('prices family pack lines using quotation season when public catalogue differs', async () => {
    const db = createPresentationSeasonDb({
      publicCatalogueSeasonId: PUBLIC_CATALOGUE_SEASON_ID,
      packSeasonId: DEFAULT_ADMIN_SEASON_ID,
      quotationPackPricePaise: 12_000,
      publicCataloguePackPricePaise: 99_000,
    })
    const total = await computeCustomerFacingQuotationTotalPaise(
      db,
      {
        items: [{ lineNumber: 1, quantity: 2 }],
        adjustmentPaise: 0,
      },
      'web',
      REQUEST_ID,
    )
    assert.equal(total, 24_000)
  })
})

/** @param {{ packSeasonId?: string }} [opts] */
function createQuoteLinesSeasonDb(opts = {}) {
  return bindAdminServiceMode(unconfiguredQuoteLinesSeasonDb(opts), {})
}
function unconfiguredQuoteLinesSeasonDb(opts = {}) {
  const packSeasonId = opts.packSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const pack = {
    id: PACK_ID,
    active: 1,
    selling_price_paise: 10_000,
    season_id: packSeasonId,
  }
  const product = {
    id: 'P001',
    name: 'Product',
    active: 1,
    selling_price_paise: 5_000,
  }

  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM family_packs') && normalized.includes('season_id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id === pack.id && seasonId === packSeasonId) return pack
                return null
              }
              if (normalized.includes('FROM products WHERE id = ?') && !normalized.includes('season_id')) {
                return String(params[0]) === product.id ? product : null
              }
              return null
            },
            async all() {
              return { results: [] }
            },
          }
        },
      }
    },
  }
}

/** @param {{ publicCatalogueSeasonId?: string, packSeasonId?: string, quotationPackPricePaise?: number, publicCataloguePackPricePaise?: number }} [opts] */
function createPresentationSeasonDb(opts = {}) {
  return bindAdminServiceMode(unconfiguredPresentationSeasonDb(opts), {})
}
function unconfiguredPresentationSeasonDb(opts = {}) {
  const publicCatalogueSeasonId = opts.publicCatalogueSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const packSeasonId = opts.packSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const quotationPackPricePaise = opts.quotationPackPricePaise ?? 10_000
  const publicCataloguePackPricePaise = opts.publicCataloguePackPricePaise ?? 10_000

  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM platform_settings') && normalized.includes('public_catalogue_season_id')) {
                return { public_catalogue_season_id: publicCatalogueSeasonId }
              }
              if (normalized.includes('SELECT season_id FROM customer_requests WHERE id = ?')) {
                return String(params[0]) === REQUEST_ID
                  ? { season_id: DEFAULT_ADMIN_SEASON_ID }
                  : null
              }
              if (normalized.includes('SELECT selling_price_paise FROM family_packs WHERE id = ? AND season_id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id !== PACK_ID) return null
                if (seasonId === packSeasonId) {
                  return { selling_price_paise: quotationPackPricePaise }
                }
                if (seasonId === publicCatalogueSeasonId) {
                  return { selling_price_paise: publicCataloguePackPricePaise }
                }
                return null
              }
              return null
            },
            async all() {
              if (
                normalized.includes('FROM customer_request_items i') &&
                normalized.includes('r.season_id = ?')
              ) {
                const reqId = String(params[0])
                const seasonId = String(params[1])
                if (reqId !== REQUEST_ID || seasonId !== DEFAULT_ADMIN_SEASON_ID) {
                  return { results: [] }
                }
                return {
                  results: [
                    {
                      line_number: 1,
                      product_id: null,
                      family_pack_id: PACK_ID,
                      product_name: 'Pack',
                      quantity: 2,
                      unit_price_paise: null,
                    },
                  ],
                }
              }
              return { results: [] }
            },
          }
        },
      }
    },
  }
}
