import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PUBLIC_PRODUCT_BY_ID_SQL,
  PUBLIC_PRODUCT_LIST_SQL,
  listPublicProducts,
  mapPublicProductRow,
} from '../src/services/publicProducts.js'

describe('public product SQL separation', () => {
  it('list SQL exposes D1 selling price only (no private_rates)', () => {
    const sql = PUBLIC_PRODUCT_LIST_SQL.toLowerCase()
    assert.ok(!sql.includes('private_rates'))
    assert.ok(!sql.includes('unit_rate'))
    assert.ok(sql.includes('selling_price_paise'))
    assert.ok(sql.includes('selling_price_paise > 0'))
  })

  it('by-id SQL does not reference private_rates', () => {
    const sql = PUBLIC_PRODUCT_BY_ID_SQL.toLowerCase()
    assert.ok(!sql.includes('private_rates'))
    assert.ok(!sql.includes('unit_rate'))
    assert.ok(sql.includes('selling_price_paise > 0'))
  })

  it('mapPublicProductRow omits private rate fields but includes D1 selling price', () => {
    const mapped = mapPublicProductRow({
      id: 'T1',
      category_slug: 'others',
      category_label: 'Others',
      name: 'Test',
      pack: '',
      description: '',
      featured: 0,
      stock_status: 'available',
      sort_order: 0,
      images_json: '[]',
      selling_price_paise: 12500,
      unit_rate_paise: 9999,
      active: 1,
      company: 'Secret Co',
    })
    assert.equal(mapped.id, 'T1')
    assert.equal('unit_rate_paise' in mapped, false)
    assert.equal(mapped.sellingPricePaise, 12500)
    assert.equal('active' in mapped, false)
    assert.equal('company' in mapped, false)
    assert.deepEqual(mapped.images, [])
    assert.equal(mapped.coverImageUrl, null)
  })

  it('mapPublicProductRow treats zero selling_price_paise as missing', () => {
    const mapped = mapPublicProductRow({
      id: 'T0',
      category_slug: 'others',
      category_label: 'Others',
      name: 'Zero',
      pack: '',
      description: '',
      featured: 0,
      stock_status: 'available',
      sort_order: 0,
      images_json: '[]',
      selling_price_paise: 0,
    })
    assert.equal(mapped.sellingPricePaise, null)
  })

  it('mapPublicProductRow exposes ordered images and cover URL', () => {
    const mapped = mapPublicProductRow({
      id: 'T2',
      category_slug: 'others',
      category_label: 'Others',
      name: 'Gallery',
      pack: '',
      description: '',
      featured: 0,
      stock_status: 'available',
      sort_order: 0,
      images_json: '["https://cdn/a.webp","https://cdn/b.webp"]',
    })
    assert.deepEqual(mapped.images, ['https://cdn/a.webp', 'https://cdn/b.webp'])
    assert.equal(mapped.coverImageUrl, 'https://cdn/a.webp')
  })

  it('clamps public list pagination: default 50, max 100', async () => {
    const binds = []
    const db = createBindCaptureDb(binds)

    await listPublicProducts(db, {})
    assert.deepEqual(binds.at(-1), [50, 0])

    await listPublicProducts(db, { limit: 200, offset: 100 })
    assert.deepEqual(binds.at(-1), [100, 100])

    await listPublicProducts(db, { limit: 0, offset: -5 })
    assert.deepEqual(binds.at(-1), [50, 0])

    await listPublicProducts(db, { limit: 1, offset: 160 })
    assert.deepEqual(binds.at(-1), [1, 160])
  })
})

function createBindCaptureDb(binds) {
  return {
    prepare() {
      return {
        bind(...params) {
          binds.push(params)
          return {
            async all() {
              return { results: [] }
            },
          }
        },
      }
    },
  }
}
