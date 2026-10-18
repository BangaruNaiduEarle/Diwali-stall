import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildCatalogueImportManifest, normalizeCatalogueSourceProduct } from '../src/lib/catalogueSource.js'

describe('catalogue source normalization', () => {
  it('maps category label to slug and preserves sort order index', () => {
    const { record, errors } = normalizeCatalogueSourceProduct(
      {
        id: 'P001',
        name: 'Test',
        category: 'Gift Boxes',
        pack: '',
        description: 'd',
        featured: true,
        stockStatus: 'available',
        active: true,
        images: ['/images/a.webp'],
        price: 999,
        x4: 888,
      },
      0,
    )
    assert.equal(errors.length, 0)
    assert.equal(record?.category_slug, 'gift-boxes')
    assert.equal(record?.sort_order, 0)
    assert.equal(record?.featured, 1)
    assert.ok(!('price' in /** @type {object} */ (record)))
  })

  it('reports unknown category instead of inventing slug', () => {
    const { record, errors } = normalizeCatalogueSourceProduct(
      { id: 'P999', name: 'X', category: 'Unknown Cat', stockStatus: 'available', active: true, images: [] },
      5,
    )
    assert.equal(record, null)
    assert.ok(errors.some((e) => e.includes('unknown category')))
  })

  it('detects duplicate ids in manifest', () => {
    const manifest = buildCatalogueImportManifest([
      { id: 'P001', name: 'A', category: 'Others', stockStatus: 'available', active: true, images: [] },
      { id: 'P001', name: 'B', category: 'Others', stockStatus: 'available', active: true, images: [] },
    ])
    assert.ok(manifest.errors.some((e) => e.includes('duplicate')))
  })
})
