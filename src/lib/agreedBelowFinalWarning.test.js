import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAgreedBelowFinalWarning,
  buildAgreedBelowFinalWarningWithMeta,
} from './agreedBelowFinalWarning.js'
import { buildOwnerCustomerRequestListAuditSummary } from '../../server/src/lib/adminCustomerRequestListAudit.js'
import { formatAgreedBelowFinalDetailMessage } from '../admin/lib/agreedBelowFinalWarningDisplay.js'
import { formatAgreedBelowFinalListWarning } from '../admin/lib/agreedBelowFinalWarningDisplay.js'

describe('buildAgreedBelowFinalWarning', () => {
  it('warns when agreed is below final', () => {
    assert.deepEqual(buildAgreedBelowFinalWarning(30_000, 40_000), { shortfallPaise: 10_000 })
  })

  it('returns null when agreed is missing', () => {
    assert.equal(buildAgreedBelowFinalWarning(null, 40_000), null)
  })

  it('returns null when final is missing or zero', () => {
    assert.equal(buildAgreedBelowFinalWarning(30_000, null), null)
    assert.equal(buildAgreedBelowFinalWarning(30_000, 0), null)
  })

  it('returns null when agreed meets or exceeds final', () => {
    assert.equal(buildAgreedBelowFinalWarning(40_000, 40_000), null)
    assert.equal(buildAgreedBelowFinalWarning(50_000, 40_000), null)
  })

  it('tags estimate when final is not saved audit', () => {
    assert.deepEqual(buildAgreedBelowFinalWarningWithMeta(30_000, 40_000, { finalSubtotalIsSaved: false }), {
      shortfallPaise: 10_000,
      finalSubtotalIsEstimate: true,
    })
    assert.deepEqual(buildAgreedBelowFinalWarningWithMeta(30_000, 40_000, { finalSubtotalIsSaved: true }), {
      shortfallPaise: 10_000,
    })
  })
})

describe('list audit summary warning payload', () => {
  it('includes belowFinalWarning for owner list API', () => {
    const summary = buildOwnerCustomerRequestListAuditSummary({
      sellingSubtotalPaise: 100_000,
      acceptedAmountPaise: 36_000,
      finalSubtotalPaise: 40_000,
      finalSubtotalIsSaved: true,
    })
    assert.deepEqual(summary?.belowFinalWarning, { shortfallPaise: 4_000 })
    const listMsg = formatAgreedBelowFinalListWarning(summary)
    assert.match(String(listMsg), /Shortfall/)
    assert.match(String(listMsg), /below Final subtotal/)
  })
})

describe('warning display copy', () => {
  it('formats detail and list shortfall from paise', () => {
    assert.equal(
      formatAgreedBelowFinalDetailMessage(40_000),
      'Customer agreed below Final subtotal (shortfall ₹400).',
    )
    const summary = { belowFinalWarning: { shortfallPaise: 40_000 } }
    assert.equal(
      formatAgreedBelowFinalListWarning(summary),
      '⚠ Customer agreed below Final subtotal · Shortfall ₹400',
    )
  })
})
