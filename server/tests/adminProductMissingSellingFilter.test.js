import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listAdminProductsPage } from '../src/services/adminProducts.js'

function createDb(products) {
  return {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      return {
        bind(...binds) {
          return {
            async first() {
              if (normalized.startsWith('SELECT COUNT(*)')) {
                const missingOnly = normalized.includes('selling_price_paise IS NULL')
                const rows = products.filter((p) => {
                  if (!missingOnly) return true
                  const paise = p.selling_price_paise
                  return paise === null || paise === undefined || paise <= 0
                })
                return { total: rows.length }
              }
              return null
            },
            async all() {
              const missingOnly = normalized.includes('selling_price_paise IS NULL')
              let rows = products
              if (missingOnly) {
                rows = products.filter((p) => {
                  const paise = p.selling_price_paise
                  return paise === null || paise === undefined || paise <= 0
                })
              }
              return {
                results: rows.map((p) => ({
                  ...p,
                  category_label: 'Others',
                  images_json: '[]',
                  x4_selling_paise: null,
                  purchase_rate_paise: null,
                })),
              }
            },
          }
        },
      }
    },
  }
}

describe('listAdminProductsPage missingRateOnly', () => {
  const seed = [
    {
      id: 'P001',
      category_slug: 'others',
      name: 'Priced',
      pack: '',
      description: '',
      featured: 0,
      stock_status: 'available',
      active: 1,
      sort_order: 1,
      company: null,
      selling_price_paise: 5000,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'P002',
      category_slug: 'others',
      name: 'Null price',
      pack: '',
      description: '',
      featured: 0,
      stock_status: 'available',
      active: 1,
      sort_order: 2,
      company: null,
      selling_price_paise: null,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'P003',
      category_slug: 'others',
      name: 'Zero price',
      pack: '',
      description: '',
      featured: 0,
      stock_status: 'available',
      active: 1,
      sort_order: 3,
      company: null,
      selling_price_paise: 0,
      created_at: '',
      updated_at: '',
    },
  ]

  it('filters on products.selling_price_paise, not private_rates', async () => {
    const db = createDb(seed)
    const page = await listAdminProductsPage(db, { limit: 10, offset: 0, missingRateOnly: true })
    assert.equal(page.total, 2)
    const ids = page.products.map((p) => p.id).sort()
    assert.deepEqual(ids, ['P002', 'P003'])
  })
})
