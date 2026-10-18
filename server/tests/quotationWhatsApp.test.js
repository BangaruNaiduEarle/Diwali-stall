import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildQuotationWhatsAppMessage, buildWhatsAppSendUrl } from '../src/lib/quotationWhatsApp.js'

describe('quotationWhatsApp', () => {
  it('buildQuotationWhatsAppMessage omits per-line totals from item text', () => {
    const message = buildQuotationWhatsAppMessage(
      { id: 'ref-1', customerName: 'A', customerPhone: '9000000000', totalPaise: 30000 },
      [{ lineNumber: 1, productName: 'ITEM', quantity: 2, unitRatePaise: 15000, lineTotalPaise: 30000 }],
    )
    assert.match(message, /1\. ITEM — Qty: 2 — Rate: ₹150/)
    assert.doesNotMatch(message, /Line:/)
    assert.match(message, /Grand total: ₹300/)
  })

  it('buildWhatsAppSendUrl encodes message for wa.me', () => {
    const url = buildWhatsAppSendUrl('Hello & test', '919876543210')
    assert.match(url, /^https:\/\/wa\.me\/91\d+\?text=/)
    assert.ok(url.includes(encodeURIComponent('Hello & test')))
  })
})
