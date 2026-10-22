import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildQuotationWhatsAppMessage } from '../../../server/src/lib/quotationWhatsApp.js'

describe('buildQuotationWhatsAppMessage', () => {
  const quotation = {
    id: 'q-abc-123',
    customerName: 'Priya N',
    customerPhone: '9876543210',
    totalPaise: 120000,
  }

  const items = [
    { lineNumber: 1, productName: 'CLASSIC WHEEL', quantity: 1, unitRatePaise: 20000, lineTotalPaise: 20000 },
    { lineNumber: 2, productName: 'BLOSSOM', quantity: 1, unitRatePaise: 50000, lineTotalPaise: 50000 },
    { lineNumber: 3, productName: 'PINKIE PIE', quantity: 1, unitRatePaise: 50000, lineTotalPaise: 50000 },
  ]

  it('preorder format lists qty without rates', () => {
    const message = buildQuotationWhatsAppMessage(quotation, items, { requestSource: 'web' })
    assert.match(message, /1\. CLASSIC WHEEL — Qty: 1/)
    assert.match(message, /2\. BLOSSOM — Qty: 1/)
    assert.match(message, /3\. PINKIE PIE — Qty: 1/)
    assert.doesNotMatch(message, /Rate:/)
    const itemLines = message.split('\n').filter((line) => /^\d+\./.test(line))
    assert.equal(itemLines.length, 3)
  })

  it('preorder includes reference, customer block, grand total, pickup, and thank-you', () => {
    const message = buildQuotationWhatsAppMessage(quotation, items, { requestSource: 'web' })
    assert.match(message, /DIWALI CRACKERS QUOTATION/)
    assert.match(message, /Ref: q-abc-123/)
    assert.match(message, /Name: Priya N/)
    assert.match(message, /Mobile: 9876543210/)
    const grandMatches = message.match(/Grand total: ₹1,200/g) ?? []
    assert.equal(grandMatches.length, 1)
    assert.match(message, /Please confirm to proceed with pickup\./)
    assert.ok(message.endsWith('Thank you for choosing Diwali Stall! 🙏✨'))
  })

  it('preorder omits customer block when name and mobile are empty', () => {
    const message = buildQuotationWhatsAppMessage(
      { id: 'q-empty', customerName: '', customerPhone: '', totalPaise: 10000 },
      [{ lineNumber: 1, productName: 'X', quantity: 1 }],
      { requestSource: 'web' },
    )
    assert.doesNotMatch(message, /^Customer$/m)
    assert.match(message, /1\. X — Qty: 1/)
  })

  it('preserves item order by line number', () => {
    const shuffled = [items[2], items[0], items[1]]
    const message = buildQuotationWhatsAppMessage(quotation, shuffled, { requestSource: 'web' })
    const idxClassic = message.indexOf('CLASSIC WHEEL')
    const idxBlossom = message.indexOf('BLOSSOM')
    const idxPinkie = message.indexOf('PINKIE PIE')
    assert.ok(idxClassic < idxBlossom && idxBlossom < idxPinkie)
  })

  it('walk-in format is reference and total only', () => {
    const message = buildQuotationWhatsAppMessage(quotation, items, { requestSource: 'manual' })
    assert.equal(
      message,
      ['DIWALI CRACKERS QUOTATION', 'Ref: q-abc-123', '', 'Grand total: ₹1,200'].join('\n'),
    )
  })
})
