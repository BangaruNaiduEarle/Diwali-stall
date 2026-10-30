import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isCustomerRequestEligibleForBillAdjust,
  validateAdjustBillBody,
} from '../src/services/adminCustomerRequestBillAdjust.js'

describe('isCustomerRequestEligibleForBillAdjust', () => {
  it('allows pending non-terminal requests', () => {
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        source: 'manual',
        finalization_status: 'pending',
        status: 'assigned',
      }),
      true,
    )
  })

  it('rejects public web requests', () => {
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        source: 'web',
        finalization_status: 'pending',
        status: 'open',
      }),
      false,
    )
  })

  it('rejects finalized, closed, or void', () => {
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        finalization_status: 'finalized',
        status: 'closed',
      }),
      false,
    )
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        finalization_status: 'pending',
        status: 'closed',
      }),
      false,
    )
    assert.equal(
      isCustomerRequestEligibleForBillAdjust({
        finalization_status: 'pending',
        status: 'void',
      }),
      false,
    )
  })
})

describe('validateAdjustBillBody', () => {
  it('requires quick-bill style items', () => {
    const ok = validateAdjustBillBody({
      items: [{ productId: 'P001', quantity: 2, unitType: 'box' }],
    })
    assert.equal(ok.ok, true)
    const bad = validateAdjustBillBody({ items: [] })
    assert.equal(bad.ok, false)
  })
})
