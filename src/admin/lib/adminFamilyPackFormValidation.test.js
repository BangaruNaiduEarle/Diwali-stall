import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isValidAdminProductId,
  normalizeAdminProductIdInput,
  validateFamilyPackFormValues,
  validateFamilyPackFormValuesForUploadDraft,
} from './adminFamilyPackFormValidation.js'

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

describe('isValidAdminProductId', () => {
  it('accepts P### ids', () => {
    assert.equal(isValidAdminProductId('P042'), true)
    assert.equal(isValidAdminProductId('P1001'), true)
  })

  it('rejects invalid ids', () => {
    assert.equal(isValidAdminProductId(''), false)
    assert.equal(isValidAdminProductId('042'), false)
    assert.equal(isValidAdminProductId('p042'), false)
  })

  it('normalizes lowercase p prefix', () => {
    assert.equal(normalizeAdminProductIdInput(' p042 '), 'P042')
  })
})

describe('validateFamilyPackFormValuesForUploadDraft', () => {
  it('requires name and price only', () => {
    const values = emptyFamilyPackFormValues()
    const fail = validateFamilyPackFormValuesForUploadDraft(values)
    assert.equal(fail.ok, false)
    values.name = 'Draft'
    values.sellingPriceInr = '99'
    const pass = validateFamilyPackFormValuesForUploadDraft(values)
    assert.equal(pass.ok, true)
  })
})

describe('validateFamilyPackFormValues', () => {
  it('requires name, price on create, and at least one product id', () => {
    const values = emptyFamilyPackFormValues()
    const result = validateFamilyPackFormValues(values, { isCreate: true })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.fields.name)
    assert.ok(result.fields.sellingPriceInr)
    assert.ok(result.fields.items)
  })

  it('validates product id text entry and quantity for filled rows', () => {
    const values = emptyFamilyPackFormValues()
    values.name = 'Test Pack'
    values.sellingPriceInr = '499'
    values.items = [{ productId: 'bad', quantity: '0', unitLabel: 'box', sortOrder: 0 }]
    const result = validateFamilyPackFormValues(values, { isCreate: true })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.fields['items[0].productId'], /Invalid product id/)
    assert.ok(result.fields['items[0].quantity'])
  })

  it('passes when product id and quantity are valid', () => {
    const values = emptyFamilyPackFormValues()
    values.name = 'Test Pack'
    values.slug = 'test-pack'
    values.sellingPriceInr = '499'
    values.items = [{ productId: 'P042', quantity: '2', unitLabel: 'box', sortOrder: 0 }]
    const result = validateFamilyPackFormValues(values, { isCreate: true })
    assert.equal(result.ok, true)
  })

  it('does not require product id on rows with only default quantity', () => {
    const values = emptyFamilyPackFormValues()
    values.name = 'Test Pack'
    values.sellingPriceInr = '100'
    values.items = [
      { productId: 'P001', quantity: '1', unitLabel: '', sortOrder: 0 },
      { productId: '', quantity: '1', unitLabel: '', sortOrder: 1 },
    ]
    const result = validateFamilyPackFormValues(values, { isCreate: true })
    assert.equal(result.ok, true)
  })

  it('ignores completely empty item rows when another row is valid', () => {
    const values = emptyFamilyPackFormValues()
    values.name = 'Test Pack'
    values.sellingPriceInr = '100'
    values.items = [
      { productId: 'P001', quantity: '1', unitLabel: '', sortOrder: 0 },
      { productId: '', quantity: '', unitLabel: '', sortOrder: 1 },
    ]
    const result = validateFamilyPackFormValues(values, { isCreate: true })
    assert.equal(result.ok, true)
  })
})
