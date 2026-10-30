import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { productMatchesQuickBillSearch } from './quickBillProductSearch.js'

describe('productMatchesQuickBillSearch', () => {
  const name = 'ASHOKA FP'
  const company = 'Star Brand'

  it('matches case and space variants on compact name', () => {
    for (const q of ['ashoka fp', 'ashokafp', 'ASHOKA FP', 'AshokaFp']) {
      assert.equal(productMatchesQuickBillSearch(q, name, null, 'P1'), true)
    }
  })

  it('matches multi-word queries in any order', () => {
    assert.equal(productMatchesQuickBillSearch('fp ashoka', name, null, 'P1'), true)
    assert.equal(productMatchesQuickBillSearch('ashoka   fp', name, null, 'P1'), true)
  })

  it('matches company field', () => {
    assert.equal(productMatchesQuickBillSearch('starbrand', name, company, 'P1'), true)
  })

  it('matches product id prefix', () => {
    assert.equal(productMatchesQuickBillSearch('p12', name, company, 'P123'), true)
  })
})
