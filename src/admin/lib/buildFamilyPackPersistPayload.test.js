import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildFamilyPackPersistPayload } from './adminFamilyPackPayload.js'

function emptyFamilyPackFormValues() {
  return {
    name: '',
    slug: '',
    shortDescription: '',
    sellingPriceInr: '',
    packLabel: '',
    sortOrder: '0',
    active: false,
    images: [],
    items: [{ productId: '', quantity: '1', unitLabel: '', sortOrder: 0 }],
  }
}

describe('buildFamilyPackPersistPayload', () => {
  it('omits items key when no product ids are filled', () => {
    const values = emptyFamilyPackFormValues()
    values.name = 'Draft'
    values.sellingPriceInr = '100'
    const payload = buildFamilyPackPersistPayload(values)
    assert.equal('items' in payload, false)
  })

  it('includes items when at least one product id is set', () => {
    const values = emptyFamilyPackFormValues()
    values.name = 'Pack'
    values.sellingPriceInr = '100'
    values.items = [{ productId: 'P001', quantity: '1', unitLabel: '', sortOrder: 0 }]
    const payload = buildFamilyPackPersistPayload(values)
    assert.equal(payload.items?.length, 1)
    assert.equal(payload.items[0].productId, 'P001')
  })
})
