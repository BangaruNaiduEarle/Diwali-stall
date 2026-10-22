import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildOrderConfirmationWhatsAppMessage } from '../src/lib/orderConfirmationWhatsApp.js'

describe('orderConfirmationWhatsApp', () => {
  const quotation = { id: 'q-1', totalPaise: 135200 }

  it('includes free delivery and location for eligible web preorder', () => {
    const result = buildOrderConfirmationWhatsAppMessage(
      {
        source: 'web',
        publicReference: 'DWL-TEST1234',
        customerName: 'Priya',
        customerArea: 'MVP Colony',
        deliveryAddress: 'Flat 12, Example Towers',
        deliveryLandmark: 'Near park',
        deliveryMapsUrl: 'https://maps.google.com/example',
      },
      quotation,
    )
    assert.equal(result.ok, true)
    assert.match(result.message, /Order Reference: DWL-TEST1234/)
    assert.match(result.message, /Order Total: ₹1,352/)
    assert.match(result.message, /FREE DOOR DELIVERY/)
    assert.match(result.message, /subject to coverage/)
    assert.match(result.message, /verify delivery coverage/)
    assert.match(result.message, /Delivery Location: MVP Colony, Flat 12, Example Towers/)
    assert.match(result.message, /Landmark: Near park/)
    assert.match(result.message, /Google Maps Location: https:\/\/maps.google.com\/example/)
    assert.doesNotMatch(result.message, /dispatched/)
  })

  it('omits landmark and maps when empty', () => {
    const result = buildOrderConfirmationWhatsAppMessage(
      {
        source: 'web',
        publicReference: 'DWL-TEST1234',
        customerName: 'Priya',
        deliveryAddress: 'Flat 12',
      },
      quotation,
    )
    assert.equal(result.ok, true)
    assert.doesNotMatch(result.message, /Landmark:/)
    assert.doesNotMatch(result.message, /Google Maps Location:/)
  })

  it('requires location for eligible web orders', () => {
    const result = buildOrderConfirmationWhatsAppMessage(
      { source: 'web', customerName: 'Priya' },
      quotation,
    )
    assert.equal(result.ok, false)
  })

  it('walk-in manual confirmation is reference and total only', () => {
    const result = buildOrderConfirmationWhatsAppMessage(
      { source: 'manual', customerName: 'Walk-in', customerPhone: '9999999999' },
      { id: 'q-walk', totalPaise: 135200 },
    )
    assert.equal(result.ok, true)
    assert.match(result.message, /Order Total: ₹1,352/)
    assert.doesNotMatch(result.message, /FREE DOOR DELIVERY/)
    assert.doesNotMatch(result.message, /Hello/)
  })

  it('uses quotation total_paise for eligibility at exact threshold', () => {
    assert.equal(
      buildOrderConfirmationWhatsAppMessage(
        { source: 'web', customerName: 'A', deliveryAddress: 'Addr' },
        { totalPaise: 99900 },
      ).ok,
      true,
    )
    const at999 = buildOrderConfirmationWhatsAppMessage(
      { source: 'web', customerName: 'A', deliveryAddress: 'Addr' },
      { totalPaise: 99900 },
    )
    assert.equal(at999.ok, true)
    if (at999.ok) assert.doesNotMatch(at999.message, /FREE DOOR DELIVERY/)

    const at1000 = buildOrderConfirmationWhatsAppMessage(
      { source: 'web', customerName: 'A', deliveryAddress: 'Addr' },
      { total_paise: 100000 },
    )
    assert.equal(at1000.ok, true)
    if (at1000.ok) assert.match(at1000.message, /FREE DOOR DELIVERY/)
  })

  it('below-threshold web order uses pickup wording without free delivery', () => {
    const result = buildOrderConfirmationWhatsAppMessage(
      {
        source: 'web',
        customerName: 'A',
        deliveryAddress: 'Somewhere',
      },
      { id: 'q-2', totalPaise: 80000 },
    )
    assert.equal(result.ok, true)
    assert.doesNotMatch(result.message, /FREE DOOR DELIVERY/)
    assert.match(result.message, /pickup/)
  })
})
