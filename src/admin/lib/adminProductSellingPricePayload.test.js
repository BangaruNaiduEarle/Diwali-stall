import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sellingPriceInrForProductWrite } from './adminProductSellingPricePayload.js'
import { adminProductListSellingPriceView } from './adminProductTableDisplay.js'
import { buildProductPayload } from './adminProductBuildPayload.js'

describe('sellingPriceInrForProductWrite', () => {
  it('maps form sellingPriceInr to D1 write value', () => {
    const inr = sellingPriceInrForProductWrite({ sellingPriceInr: '250' })
    assert.equal(inr, 250)
    assert.deepEqual(adminProductListSellingPriceView({ sellingPriceInr: inr }), {
      kind: 'value',
      inr: 250,
    })
  })

  it('returns null when the form field is cleared', () => {
    assert.equal(sellingPriceInrForProductWrite({ sellingPriceInr: '' }), null)
    assert.equal(sellingPriceInrForProductWrite({ sellingPriceInr: null }), null)
  })

  it('returns undefined when selling field is omitted', () => {
    assert.equal(sellingPriceInrForProductWrite({}), undefined)
  })
})

describe('buildProductPayload selling price', () => {
  const base = {
    id: 'P200',
    categorySlug: 'others',
    name: 'Test',
    pack: '',
    description: '',
    featured: false,
    stockStatus: 'available',
    active: true,
    sortOrder: 0,
    images: [],
    sellingPriceInr: '99',
  }

  it('includes sellingPriceInr when includeSellingPrice is true', () => {
    const payload = buildProductPayload(base, { includeSellingPrice: true })
    assert.equal(payload.sellingPriceInr, 99)
  })

  it('omits sellingPriceInr for restricted admin saves', () => {
    const payload = buildProductPayload(base, { includeSellingPrice: false })
    assert.equal('sellingPriceInr' in payload, false)
  })

  it('sends null when selling price is cleared', () => {
    const payload = buildProductPayload({ ...base, sellingPriceInr: '' }, { includeSellingPrice: true })
    assert.equal(payload.sellingPriceInr, null)
  })
})
