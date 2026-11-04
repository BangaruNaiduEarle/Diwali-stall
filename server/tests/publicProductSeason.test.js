import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import { getPublicProductById, listPublicProducts } from '../src/services/publicProducts.js'

const OTHER_SEASON_ID = 'season-2099'
const PUBLIC_SEASON_ID = DEFAULT_ADMIN_SEASON_ID
const PRODUCT_ID = 'P901'

describe('public product season isolation', () => {
  it('lists only products in the public catalogue season with matching category join', async () => {
    const db = createPublicProductSeasonDb()
    const products = await listPublicProducts(db, { limit: 50, offset: 0 })
    assert.equal(products.length, 1)
    assert.equal(products[0].id, PRODUCT_ID)
    assert.equal(products[0].categorySlug, 'others')
    assert.equal(products[0].categoryLabel, 'Others 2026')
  })

  it('returns empty list when public catalogue season is unset', async () => {
    const db = createPublicProductSeasonDb({ publicSeasonId: null })
    const products = await listPublicProducts(db)
    assert.deepEqual(products, [])
  })

  it('returns empty list and null detail when public catalogue season is archived', async () => {
    const db = createPublicProductSeasonDb({ publicSeasonStatus: 'archived' })
    const products = await listPublicProducts(db)
    assert.deepEqual(products, [])
    assert.equal(await getPublicProductById(db, PRODUCT_ID), null)
  })

  it('hides product detail when product belongs to another season', async () => {
    const db = createPublicProductSeasonDb({ productSeasonId: OTHER_SEASON_ID })
    const product = await getPublicProductById(db, PRODUCT_ID)
    assert.equal(product, null)
  })

  it('excludes products when category label is from another season (join mismatch)', async () => {
    const db = createPublicProductSeasonDb({ categorySeasonId: OTHER_SEASON_ID })
    const products = await listPublicProducts(db)
    assert.deepEqual(products, [])
    assert.equal(await getPublicProductById(db, PRODUCT_ID), null)
  })

  it('returns product detail only for public season', async () => {
    const db = createPublicProductSeasonDb()
    const product = await getPublicProductById(db, PRODUCT_ID)
    assert.ok(product)
    assert.equal(product.sellingPricePaise, 5000)
  })
})

/** @param {{ publicSeasonId?: string | null, publicSeasonStatus?: string, productSeasonId?: string, categorySeasonId?: string }} [opts] */
function createPublicProductSeasonDb(opts = {}) {
  const publicSeasonId = opts.publicSeasonId === undefined ? PUBLIC_SEASON_ID : opts.publicSeasonId
  const publicSeasonStatus = opts.publicSeasonStatus ?? 'active'
  const productSeasonId = opts.productSeasonId ?? PUBLIC_SEASON_ID
  const categorySeasonId = opts.categorySeasonId ?? productSeasonId

  const product = {
    id: PRODUCT_ID,
    category_slug: 'others',
    category_label: categorySeasonId === PUBLIC_SEASON_ID ? 'Others 2026' : 'Others Other',
    name: 'Season Product',
    pack: '',
    description: '',
    featured: 0,
    stock_status: 'available',
    sort_order: 0,
    images_json: '[]',
    selling_price_paise: 5000,
    active: 1,
    season_id: productSeasonId,
  }

  const category = {
    slug: 'others',
    label: categorySeasonId === PUBLIC_SEASON_ID ? 'Others 2026' : 'Others Other',
    season_id: categorySeasonId,
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
              if (normalized.includes('FROM products p') && normalized.includes('p.id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id !== product.id || seasonId !== publicSeasonId) return null
                if (product.season_id !== seasonId || product.active !== 1 || product.selling_price_paise <= 0) {
                  return null
                }
                if (category.slug !== product.category_slug || category.season_id !== product.season_id) {
                  return null
                }
                return {
                  ...product,
                  category_label: category.label,
                }
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM products p') && normalized.includes('p.season_id = ?')) {
                const seasonId = String(params[0])
                if (!publicSeasonId || seasonId !== publicSeasonId) {
                  return { results: [] }
                }
                if (
                  product.season_id !== seasonId ||
                  product.active !== 1 ||
                  product.selling_price_paise <= 0 ||
                  category.slug !== product.category_slug ||
                  category.season_id !== product.season_id
                ) {
                  return { results: [] }
                }
                return {
                  results: [
                    {
                      ...product,
                      category_label: category.label,
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
