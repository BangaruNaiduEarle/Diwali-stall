import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  internalSummaryHasVisibleContent,
  resolveInternalSummaryDisplay,
} from './adminCustomerRequestInternalSummary.js'

describe('resolveInternalSummaryDisplay', () => {
  it('prefers saved bargain audit over catalogue view subtotals', () => {
    const summary = resolveInternalSummaryDisplay({
      quotation: {
        pricingMode: 'bargain',
        sellingSubtotalPaise: 100_000,
        finalSubtotalPaise: 80_000,
        bargainFloorPaise: 130_000,
      },
      internalPricingView: {
        sellingSubtotalPaise: 999_000,
        finalSubtotalPaise: 888_000,
        bargainFloorPaise: 938_000,
      },
      requestSource: 'manual',
    })
    assert.equal(summary.sellingSubtotalPaise, 100_000)
    assert.equal(summary.finalSubtotalPaise, 80_000)
    assert.equal(summary.bargainFloorPaise, 130_000)
    assert.equal(summary.isBargainMode, true)
    assert.equal(summary.showBargainFloor, true)
    assert.equal(summary.headlineLabel, 'Saved at checkout')
  })

  it('shows bargain floor without accepted amount', () => {
    const summary = resolveInternalSummaryDisplay({
      quotation: {
        pricingMode: 'bargain',
        sellingSubtotalPaise: 50_000,
        finalSubtotalPaise: 40_000,
        bargainFloorPaise: 90_000,
        acceptedAmountPaise: null,
      },
      requestSource: 'manual',
    })
    assert.equal(summary.showBargainFloor, true)
    assert.equal(summary.acceptedAmountPaise, null)
    assert.equal(internalSummaryHasVisibleContent(summary), true)
  })

  it('does not mark selling-mode quotation as bargain', () => {
    const summary = resolveInternalSummaryDisplay({
      quotation: { pricingMode: 'selling', sellingSubtotalPaise: 70_000 },
      internalPricingView: {
        sellingSubtotalPaise: 70_000,
        finalSubtotalPaise: 60_000,
        bargainFloorPaise: 110_000,
      },
      requestSource: 'manual',
    })
    assert.equal(summary.isBargainMode, false)
    assert.equal(summary.showBargainFloor, true)
    assert.equal(summary.sellingSubtotalIsSaved, true)
    assert.equal(summary.finalSubtotalIsSaved, false)
  })

  it('omits reference floor for web selling requests', () => {
    const summary = resolveInternalSummaryDisplay({
      quotation: { pricingMode: 'selling' },
      internalPricingView: {
        finalSubtotalPaise: 60_000,
        bargainFloorPaise: 110_000,
      },
      requestSource: 'web',
    })
    assert.equal(summary.showBargainFloor, false)
  })

  it('derives floor from saved final when floor column missing', () => {
    const summary = resolveInternalSummaryDisplay({
      quotation: {
        pricingMode: 'bargain',
        finalSubtotalPaise: 40_000,
      },
      requestSource: 'manual',
    })
    assert.equal(summary.bargainFloorPaise, 90_000)
    assert.equal(summary.bargainFloorIsEstimate, true)
  })
})
