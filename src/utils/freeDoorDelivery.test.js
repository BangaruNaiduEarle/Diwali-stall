import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setEstimateCatalogueProducts } from './estimateHelpers.js'
import {
  computeQualifyingOrderTotalInr,
  FREE_DOOR_DELIVERY_MIN_INR,
  getFreeDoorDeliveryUiMessage,
  isFreeDoorDeliveryEligibleInr,
} from './freeDoorDelivery.js'

describe('free door delivery (public estimate)', () => {
  it('computes remaining amount below threshold', () => {
    setEstimateCatalogueProducts([{ id: 'P1', name: 'Demo', price: 800, stockStatus: 'available' }])
    const total800 = computeQualifyingOrderTotalInr([{ productId: 'P1', quantity: 1 }])
    assert.equal(total800, 800)
    const msg800 = getFreeDoorDeliveryUiMessage(total800)
    assert.equal(msg800.qualified, false)
    assert.equal(msg800.amountRemainingInr, FREE_DOOR_DELIVERY_MIN_INR - 800)

    const msg999 = getFreeDoorDeliveryUiMessage(999)
    assert.equal(msg999.amountRemainingInr, 1)
    assert.match(msg999.message, /Add ₹1 more/)
  })

  it('qualifies at and above ₹1,000', () => {
    assert.equal(isFreeDoorDeliveryEligibleInr(1000), true)
    assert.equal(isFreeDoorDeliveryEligibleInr(1352), true)
    const msg = getFreeDoorDeliveryUiMessage(1000)
    assert.equal(msg.qualified, true)
    assert.match(msg.message, /FREE door delivery/)
  })
})
