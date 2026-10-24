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
    assert.match(message, /1\. Demo — Qty: 2/)
    assert.match(message, /Please confirm availability and share your quotation\.$/)
  })

  it('omits reference line when not provided', () => {
    setEstimateCatalogueProducts([
      { id: 'P001', name: 'Demo', pack: '', stockStatus: 'available' },
    ])
    const message = buildWhatsAppEstimateMessage([{ productId: 'P001', quantity: 1 }], null, null)
    assert.ok(!message.includes('Estimate Reference:'))
  })

  it('lists items without unit segments and omits gift or thank-you footers', () => {
    setEstimateCatalogueProducts([
      { id: 'P001', name: 'SILVER GIFT BOX', pack: 'Box', stockStatus: 'available' },
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
    assert.match(message, /2\. GC DELUXE — Qty: 1/)
    assert.ok(!message.includes('Unit:'))
    assert.ok(!message.includes('Area:'))
    assert.ok(!message.includes('complimentary gift'))
    assert.ok(!message.includes('Thank you for choosing Diwali Stall'))
    assert.match(message, /Name: new3/)
    assert.match(message, /Mobile: 9985076746/)
    assert.ok(!message.includes('Estimated pack total'))
    assert.ok(!message.includes('₹'))
  })

  it('omits pack unit text even when product.pack is set', () => {
    setEstimateCatalogueProducts([
      { id: 'P001', name: 'Demo', pack: 'Box of 10', stockStatus: 'available' },
    ])
    const message = buildWhatsAppEstimateMessage([{ productId: 'P001', quantity: 2 }], null, null)
    assert.match(message, /1\. Demo — Qty: 2/)
    assert.ok(!message.includes('Unit:'))
  })
})
