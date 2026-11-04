import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCatalogueCategories } from './catalogueCategories.js'
import { getCategoryProductCounts, isValidCategorySlug } from './categoryCounts.js'
import { filterProducts, getCategoryLabelFromSlug } from './filterProducts.js'
import { mapAndSortPublicProducts } from './mapPublicProduct.js'

const products = mapAndSortPublicProducts([
  { id: 'P001', name: 'Match box', categorySlug: 'matches', categoryLabel: 'Matches', sellingPricePaise: 1000 },
  { id: 'P002', name: 'Pencil cracker', categorySlug: 'pencil', categoryLabel: 'pencil', sellingPricePaise: 2000 },
  { id: 'P003', name: 'Tim item', categorySlug: 'tim', categoryLabel: 'Tim Tim', sellingPricePaise: 3000 },
  { id: 'P004', name: 'Sparkler', categorySlug: 'sparklers', categoryLabel: 'Updated sparkler label', sellingPricePaise: 4000 },
])

test('API category metadata populates categories outside the old static list', () => {
  const categories = buildCatalogueCategories(products)
  assert.equal(categories[0].slug, 'all')
  for (const slug of ['matches', 'pencil', 'tim', 'sparklers']) assert.equal(isValidCategorySlug(slug, categories), true)
  assert.equal(getCategoryLabelFromSlug('tim', categories), 'Tim Tim')
  assert.equal(getCategoryLabelFromSlug('sparklers', categories), 'Updated sparkler label')
  assert.equal(isValidCategorySlug('unknown', categories), false)
})

test('category selection filters by API slug even when its label changes', () => {
  assert.deepEqual(filterProducts(products, { categorySlug: 'sparklers' }).map(p => p.id), ['P004'])
  assert.deepEqual(filterProducts(products, { categorySlug: 'matches' }).map(p => p.id), ['P001'])
  assert.deepEqual(filterProducts(products, { categorySlug: 'tim' }).map(p => p.id), ['P003'])
  assert.equal(filterProducts(products, { categorySlug: 'unknown' }).length, 0)
  assert.equal(filterProducts(products, { categorySlug: 'all' }).length, 4)
})

test('category counts use slug identity, deduplicate categories and exclude inactive rows', () => {
  const rows = [...products, { ...products[0], id: 'P005' }, { ...products[1], id: 'P006', active: false }]
  assert.equal(buildCatalogueCategories(rows).length, 5)
  assert.deepEqual(getCategoryProductCounts(rows), { matches: 2, pencil: 1, tim: 1, sparklers: 1 })
})

test('legacy label-only products retain their established category behavior', () => {
  const legacy = [{ id: 'P007', name: 'Old sparkler', category: 'Sparklers', active: true }]
  assert.equal(buildCatalogueCategories(legacy)[1].slug, 'sparklers')
  assert.equal(filterProducts(legacy, { categorySlug: 'sparklers' }).length, 1)
})

test('an empty or unavailable catalogue never presents fabricated categories', () => {
  assert.deepEqual(buildCatalogueCategories([]), [{ slug: 'all', label: 'All' }])
  assert.deepEqual(getCategoryProductCounts([]), {})
})
