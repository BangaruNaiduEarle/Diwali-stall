import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  adminProductListSellingPriceView,
  firstAdminProductImagePath,
  formatAdminProductCompany,
  formatAdminProductPack,
} from './adminProductTableDisplay.js'

describe('adminProductTableDisplay', () => {
  it('formats company and pack with em dash when empty', () => {
    assert.equal(formatAdminProductCompany(null), '—')
    assert.equal(formatAdminProductCompany('MAY'), 'MAY')
    assert.equal(formatAdminProductPack(''), '—')
    assert.equal(formatAdminProductPack('Box'), 'Box')
  })

  it('uses D1 sellingPriceInr for every role and never substitutes X4', () => {
    const product = {
      sellingPriceInr: 50,
      x4SellingPriceInr: 120,
      hasX4SellingRate: true,
    }
    assert.deepEqual(adminProductListSellingPriceView(product), { kind: 'value', inr: 50 })
    assert.deepEqual(
      adminProductListSellingPriceView({ sellingPriceInr: null, x4SellingPriceInr: 120, hasX4SellingRate: true }),
      { kind: 'missing', inr: null },
    )
  })

  it('returns first image path from images array', () => {
    assert.equal(firstAdminProductImagePath([]), null)
    assert.equal(firstAdminProductImagePath(['/a.webp', '/b.webp']), '/a.webp')
    assert.equal(firstAdminProductImagePath(['']), null)
  })
})
