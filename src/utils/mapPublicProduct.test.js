import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertNoPublicRateFields,
  mapAndSortPublicProducts,
  mapPublicProductFromApi,
} from './mapPublicProduct.js'

/** Documented public API allowlist (`server/src/services/publicProducts.js`). */
const PUBLIC_PRODUCT_FIELD_KEYS = [
  'id',
  'categorySlug',
  'categoryLabel',
  'name',
  'pack',
  'description',
  'featured',
  'stockStatus',
  'sortOrder',
  'images',
]

describe('mapPublicProductFromApi', () => {
  it('maps API fields to storefront catalogue shape', () => {
    const mapped = mapPublicProductFromApi({
      id: 'P005',
      categorySlug: 'others',
      categoryLabel: 'Others',
      name: 'GC BIG 10p LEO',
      pack: '10 pcs',
      description: 'At the stall.',
      featured: true,
      stockStatus: 'available',
      sortOrder: 42,
      images: ['/images/products/x.webp', 'https://res.cloudinary.com/c/image/upload/v1/x.webp'],
      sellingPricePaise: 99999,
      x4SellingPriceInr: 100,
    })

    assert.ok(mapped)
    assert.equal(mapped.id, 'P005')
    assert.equal(mapped.category, 'Others')
    assert.equal(mapped.categorySlug, 'others')
    assert.equal(mapped.stockStatus, 'available')
    assert.equal(mapped.sortOrder, 42)
    assert.equal(mapped.images.length, 2)
    assert.equal(mapped.active, true)
    assert.equal('price' in mapped, false)
    assert.equal('sellingPricePaise' in mapped, false)
    assert.ok(assertNoPublicRateFields(mapped))
  })

  it('sorts mapped products by sortOrder then id', () => {
    const sorted = mapAndSortPublicProducts([
      { id: 'P010', categoryLabel: 'A', sortOrder: 2, stockStatus: 'available' },
      { id: 'P002', categoryLabel: 'A', sortOrder: 1, stockStatus: 'available' },
      { id: 'P003', categoryLabel: 'A', sortOrder: 2, stockStatus: 'available' },
    ])
    assert.deepEqual(
      sorted.map((p) => p.id),
      ['P002', 'P003', 'P010'],
    )
  })

  it('public API field allowlist excludes price and rate keys', () => {
    const forbidden = ['price', 'sellingPricePaise', 'x4SellingPriceInr', 'purchaseRateInr', 'privateX4Inr']
    for (const key of forbidden) {
      assert.equal(PUBLIC_PRODUCT_FIELD_KEYS.includes(key), false)
    }
  })
})
