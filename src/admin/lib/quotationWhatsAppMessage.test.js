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

  it('formats item lines with qty and rate but no Line totals', () => {
    const message = buildQuotationWhatsAppMessage(quotation, items)
    assert.match(message, /1\. CLASSIC WHEEL — Qty: 1 — Rate: ₹200/)
    assert.match(message, /2\. BLOSSOM — Qty: 1 — Rate: ₹500/)
    assert.match(message, /3\. PINKIE PIE — Qty: 1 — Rate: ₹500/)
    assert.doesNotMatch(message, /Line:/)
    const itemLines = message.split('\n').filter((line) => /^\d+\./.test(line))
    assert.equal(itemLines.length, 3)
  })

  it('includes reference, customer block, and single grand total', () => {
    const message = buildQuotationWhatsAppMessage(quotation, items)
    assert.match(message, /DIWALI CRACKERS QUOTATION/)
    assert.match(message, /Ref: q-abc-123/)
    assert.match(message, /Name: Priya N/)
    assert.match(message, /Mobile: 9876543210/)
    const grandMatches = message.match(/Grand total: ₹1,200/g) ?? []
    assert.equal(grandMatches.length, 1)
    assert.match(message, /Please confirm to proceed with pickup\./)
  })

  it('preserves item order by line number', () => {
    const shuffled = [items[2], items[0], items[1]]
    const message = buildQuotationWhatsAppMessage(quotation, shuffled)
    const idxClassic = message.indexOf('CLASSIC WHEEL')
    const idxBlossom = message.indexOf('BLOSSOM')
    const idxPinkie = message.indexOf('PINKIE PIE')
    assert.ok(idxClassic < idxBlossom && idxBlossom < idxPinkie)
  })
})
