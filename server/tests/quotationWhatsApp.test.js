import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildQuotationWhatsAppMessage,
  buildWhatsAppSendUrl,
  resolveQuotationWhatsAppFormat,
} from '../src/lib/quotationWhatsApp.js'

describe('quotationWhatsApp', () => {
  it('resolveQuotationWhatsAppFormat treats web as preorder only', () => {
    assert.equal(resolveQuotationWhatsAppFormat('web'), 'preorder')
    assert.equal(resolveQuotationWhatsAppFormat('manual'), 'walk_in')
    assert.equal(resolveQuotationWhatsAppFormat('whatsapp'), 'walk_in')
    assert.equal(resolveQuotationWhatsAppFormat(null), 'walk_in')
  })

  it('preorder message omits per-line rates and includes thank-you', () => {
    const message = buildQuotationWhatsAppMessage(
      { id: 'ref-1', customerName: 'A', customerPhone: '9000000000', totalPaise: 30000 },
      [{ lineNumber: 1, productName: 'ITEM', quantity: 2, unitRatePaise: 15000, lineTotalPaise: 30000 }],
      { requestSource: 'web' },
    )
    assert.match(message, /1\. ITEM — Qty: 2/)
    assert.doesNotMatch(message, /Rate:/)
    assert.match(message, /Grand total: ₹300/)
    assert.match(message, /Please confirm to proceed with pickup\./)
    assert.match(message, /Thank you for choosing Diwali Stall! 🙏✨/)
  })

  it('walk-in message includes only reference and grand total', () => {
    const message = buildQuotationWhatsAppMessage(
      { id: 'ref-walk', customerName: 'Hidden', customerPhone: '9000000000', totalPaise: 135200 },
      [{ lineNumber: 1, productName: 'SECRET ITEM', quantity: 9, unitRatePaise: 15000, lineTotalPaise: 135000 }],
      { requestSource: 'manual' },
    )
    assert.equal(
      message,
      ['DIWALI CRACKERS QUOTATION', 'Ref: ref-walk', '', 'Grand total: ₹1,352'].join('\n'),
    )
    assert.doesNotMatch(message, /Customer/)
    assert.doesNotMatch(message, /SECRET ITEM/)
    assert.doesNotMatch(message, /Please confirm/)
    assert.doesNotMatch(message, /Thank you/)
  })

  it('buildWhatsAppSendUrl encodes message for wa.me', () => {
    const url = buildWhatsAppSendUrl('Hello & test', '919876543210')
    assert.match(url, /^https:\/\/wa\.me\/91\d+\?text=/)
    assert.ok(url.includes(encodeURIComponent('Hello & test')))
  })
})
