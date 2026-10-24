import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapAdminProductRow } from '../src/services/adminProducts.js'

describe('admin product rate flags', () => {
  const baseRow = {
    id: 'P005',
    category_slug: 'others',
    category_label: 'Others',
    name: 'Sample',
    pack: '1',
    description: '',
    featured: 0,
    stock_status: 'available',
    active: 1,
    sort_order: 0,
    images_json: '[]',
    company: 'TST',
    selling_price_paise: 5000,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }

  it('sets hasX4SellingRate and hasPurchaseRate from D1 joins only', () => {
    const both = mapAdminProductRow({
      ...baseRow,
      x4_selling_paise: 12000,
      purchase_rate_paise: 3000,
    })
    assert.equal(both.hasX4SellingRate, true)
    assert.equal(both.hasPrivateX4Rate, true)
    assert.equal(both.hasPurchaseRate, true)
    assert.equal(both.x4SellingPriceInr, 120)
    assert.equal(both.purchaseRateInr, 30)
    assert.equal(both.sellingPriceInr, 50)
    assert.equal(both.hasSellingPrice, true)
    const missing = mapAdminProductRow({
      ...baseRow,
      selling_price_paise: null,
      x4_selling_paise: null,
      purchase_rate_paise: null,
    })
    assert.equal(missing.hasX4SellingRate, false)
    assert.equal(missing.hasPurchaseRate, false)
    assert.equal(missing.hasSellingPrice, false)
  })

  it('treats zero selling_price_paise as missing for admin display', () => {
    const zero = mapAdminProductRow({
      ...baseRow,
      selling_price_paise: 0,
      x4_selling_paise: null,
      purchase_rate_paise: null,
    })
    assert.equal(zero.hasSellingPrice, false)
    assert.equal(zero.sellingPriceInr, null)
  })
})
