import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeQualifyingOrderTotalPaise } from '../src/lib/qualifyingOrderTotal.js'
import { resolveRequestLines } from '../src/services/publicCustomerRequests.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import {
  assertFamilyPackAvailableForRequest,
  getPublicCatalogueSeasonId,
  getPublicFamilyPackBySlug,
  listPublicFamilyPacks,
} from '../src/services/publicFamilyPacks.js'

const OTHER_SEASON_ID = 'season-2099'
const PUBLIC_SEASON_ID = DEFAULT_ADMIN_SEASON_ID
const PACK_ID = 'FP001'

describe('public family pack season isolation', () => {
  it('reads public catalogue season from platform_settings', async () => {
    const db = createPublicFamilyPackSeasonDb()
    const seasonId = await getPublicCatalogueSeasonId(db)
    assert.equal(seasonId, PUBLIC_SEASON_ID)
  })

  it('lists only active packs in the public catalogue season', async () => {
    const db = createPublicFamilyPackSeasonDb()
    const packs = await listPublicFamilyPacks(db)
    assert.equal(packs.length, 1)
    assert.equal(packs[0].id, PACK_ID)
  })

  it('returns empty list when platform season is unset', async () => {
    const db = createPublicFamilyPackSeasonDb({ publicSeasonId: null })
    const packs = await listPublicFamilyPacks(db)
    assert.deepEqual(packs, [])
  })

  it('returns empty list and null detail when public catalogue season is archived', async () => {
    const db = createPublicFamilyPackSeasonDb({ publicSeasonStatus: 'archived' })
    const packs = await listPublicFamilyPacks(db)
    assert.deepEqual(packs, [])
    assert.equal(await getPublicFamilyPackBySlug(db, 'public-pack'), null)
  })

  it('hides packs that belong to another season on public detail', async () => {
    const db = createPublicFamilyPackSeasonDb({ packSeasonId: OTHER_SEASON_ID })
    const detail = await getPublicFamilyPackBySlug(db, 'public-pack')
    assert.equal(detail, null)
  })

  it('rejects cross-season packs in assertFamilyPackAvailableForRequest', async () => {
    const db = createPublicFamilyPackSeasonDb({ packSeasonId: OTHER_SEASON_ID })
    const result = await assertFamilyPackAvailableForRequest(db, PACK_ID, PUBLIC_SEASON_ID)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.message, /not found/i)
  })

  it('rejects cross-season family pack lines in resolveRequestLines', async () => {
    const db = createPublicFamilyPackSeasonDb({ packSeasonId: OTHER_SEASON_ID })
    const result = await resolveRequestLines(db, [{ familyPackId: PACK_ID, quantity: 1 }])
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.fields?.['items[0].familyPackId'] ?? '', /not found/i)
  })

  it('includes public-season family pack price in qualifying order total', async () => {
    const db = createPublicFamilyPackSeasonDb()
    const total = await computeQualifyingOrderTotalPaise(db, [{ familyPackId: PACK_ID, quantity: 2 }])
    assert.equal(total, 20000)
  })

  it('ignores cross-season family pack price in qualifying order total', async () => {
    const db = createPublicFamilyPackSeasonDb({ packSeasonId: OTHER_SEASON_ID })
    const total = await computeQualifyingOrderTotalPaise(db, [{ familyPackId: PACK_ID, quantity: 2 }])
    assert.equal(total, 0)
  })
})

/** @param {{ publicSeasonId?: string | null, publicSeasonStatus?: string, packSeasonId?: string }} [opts] */
function createPublicFamilyPackSeasonDb(opts = {}) {
  const publicSeasonId =
    opts.publicSeasonId === undefined ? PUBLIC_SEASON_ID : opts.publicSeasonId
  const publicSeasonStatus = opts.publicSeasonStatus ?? 'active'
  const packSeasonId = opts.packSeasonId ?? PUBLIC_SEASON_ID
  const pack = {
    id: PACK_ID,
    slug: 'public-pack',
    name: 'Public Pack',
    short_description: '',
    selling_price_paise: 10000,
    pack_label: null,
    sort_order: 0,
    active: 1,
    archived: 0,
    season_id: packSeasonId,
  }

  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM platform_settings') && normalized.includes('public_catalogue_season_id')) {
                if (!publicSeasonId) return null
                return { public_catalogue_season_id: publicSeasonId }
              }
              if (normalized.includes('FROM business_seasons') && normalized.includes('status')) {
                const id = String(params[0])
                if (!publicSeasonId || id !== publicSeasonId) return null
                return { status: publicSeasonStatus }
              }
              if (
                normalized.includes('FROM family_packs fp WHERE fp.slug = ? AND fp.active = 1 AND fp.season_id = ?')
              ) {
                const slug = String(params[0])
                const seasonId = String(params[1])
                if (slug === pack.slug && seasonId === publicSeasonId && pack.season_id === seasonId && pack.active === 1) {
                  return pack
                }
                return null
              }
              if (normalized.includes('FROM family_packs') && normalized.includes('season_id = ?') && normalized.includes('WHERE id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id === pack.id && seasonId === publicSeasonId && pack.season_id === seasonId) {
                  return pack
                }
                return null
              }
              if (normalized.includes('SELECT selling_price_paise FROM family_packs WHERE id = ? AND season_id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id === pack.id && seasonId === publicSeasonId && pack.season_id === seasonId) {
                  return { selling_price_paise: pack.selling_price_paise }
                }
                return null
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM family_packs fp') && normalized.includes('fp.active = 1 AND fp.season_id = ?')) {
                const seasonId = String(params[0])
                if (!publicSeasonId || seasonId !== publicSeasonId) return { results: [] }
                if (pack.active !== 1 || pack.season_id !== seasonId) return { results: [] }
                return { results: [{ ...pack }] }
              }
              if (normalized.includes('FROM family_pack_images')) {
                return { results: [] }
              }
              if (normalized.includes('FROM family_pack_items fpi')) {
                return { results: [] }
              }
              return { results: [] }
            },
            async run() {
              return { meta: { changes: 0 } }
            },
          }
        },
      }
    },
  }
}
