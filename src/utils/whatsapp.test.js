import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setEstimateCatalogueProducts } from './estimateHelpers.js'
import { buildWhatsAppEstimateMessage } from './whatsapp.js'

describe('buildWhatsAppEstimateMessage', () => {
  it('includes estimate reference when provided', () => {
    setEstimateCatalogueProducts([
      {
        id: 'P001',
        name: 'Demo',
        pack: 'Box',
        stockStatus: 'available',
      },
    ])
    const message = buildWhatsAppEstimateMessage(
      [{ productId: 'P001', quantity: 2 }],
      { name: 'A', mobile: '9876543210' },
      'DWL-ABCDEFGH',
    )
    assert.match(message, /Estimate Reference: DWL-ABCDEFGH/)
    assert.match(message, /Demo/)
  })

  it('omits reference line when not provided', () => {
    setEstimateCatalogueProducts([
      { id: 'P001', name: 'Demo', pack: '', stockStatus: 'available' },
    ])
    const message = buildWhatsAppEstimateMessage([{ productId: 'P001', quantity: 1 }], null, null)
    assert.ok(!message.includes('Estimate Reference:'))
  })

  it('omits unit segment when pack is missing and appends thank-you footer', () => {
    setEstimateCatalogueProducts([
      { id: 'P001', name: 'SILVER GIFT BOX', pack: '', stockStatus: 'available' },
      { id: 'P002', name: 'GC DELUXE', stockStatus: 'available' },
    ])
    const message = buildWhatsAppEstimateMessage(
      [
        { productId: 'P001', quantity: 5 },
        { productId: 'P002', quantity: 1 },
      ],
      { name: 'new3', mobile: '9985076746', area: 'neartomvp' },
      'DWL-6XDEJM4P',
    )
    assert.match(message, /1\. SILVER GIFT BOX — Qty: 5\n/)
    assert.ok(!message.includes('Unit: —'))
    assert.ok(!message.includes('Unit:'))
    assert.match(message, /🎁 A complimentary gift is included with every order/)
    assert.match(message, /Thank you for choosing Diwali Stall! 🙏✨/)
    assert.ok(message.endsWith('Thank you for choosing Diwali Stall! 🙏✨'))
  })

  it('includes unit segment when pack is present', () => {
    setEstimateCatalogueProducts([
      { id: 'P001', name: 'Demo', pack: 'Box of 10', stockStatus: 'available' },
    ])
    const message = buildWhatsAppEstimateMessage([{ productId: 'P001', quantity: 2 }], null, null)
    assert.match(message, /Demo — Qty: 2 — Unit: Box of 10/)
  })
})
