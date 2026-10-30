import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  listQuickBillCustomerValidationIssues,
  quickBillCustomerCanCheckout,
} from './quickBillCustomerValidation.js'

describe('quickBillCustomerValidation', () => {
  it('accepts valid stall customer', () => {
    assert.equal(quickBillCustomerCanCheckout('Walk-in', '9876543210'), true)
  })

  it('lists missing mobile and short name', () => {
    const issues = listQuickBillCustomerValidationIssues('A', '')
    assert.ok(issues.some((i) => i.field === 'name'))
    assert.ok(issues.some((i) => i.field === 'mobile'))
  })
})
