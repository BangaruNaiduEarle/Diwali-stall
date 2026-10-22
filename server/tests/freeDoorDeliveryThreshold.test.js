import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FREE_DOOR_DELIVERY_MIN_PAISE, isFreeDoorDeliveryEligiblePaise } from '../src/lib/freeDoorDelivery.js'

describe('freeDoorDelivery threshold (server)', () => {
  it('uses ₹1,000 in paise', () => {
    assert.equal(FREE_DOOR_DELIVERY_MIN_PAISE, 100000)
    assert.equal(isFreeDoorDeliveryEligiblePaise(99999), false)
    assert.equal(isFreeDoorDeliveryEligiblePaise(100000), true)
    assert.equal(isFreeDoorDeliveryEligiblePaise(135200), true)
  })
})
