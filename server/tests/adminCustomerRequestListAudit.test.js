import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildOwnerCustomerRequestListAuditSummary,
  resolveOwnerListRequestAuditAmounts,
} from '../src/lib/adminCustomerRequestListAudit.js'
import { formatAgreedBelowFinalListWarning } from '../../src/admin/lib/agreedBelowFinalWarningDisplay.js'

/** @param {Record<string, unknown>} quotation @param {Record<string, unknown> | null} view */
function listAuditForRequest(quotation, view) {
  const amounts = resolveOwnerListRequestAuditAmounts(quotation, view)
  const auditSummary = buildOwnerCustomerRequestListAuditSummary({
    sellingSubtotalPaise: amounts.sellingSubtotalPaise,
    acceptedAmountPaise: amounts.acceptedAmountPaise,
    finalSubtotalPaise: amounts.finalSubtotalPaise,
    finalSubtotalIsSaved: amounts.finalSubtotalIsSaved,
  })
  const warning = formatAgreedBelowFinalListWarning(auditSummary)
  return { amounts, auditSummary, warning }
}

describe('owner list audit — per-request Final vs agreed', () => {
  it('request A: selling checkout, catalogue Final, agreed below → warning with shortfall', () => {
    const { amounts, warning } = listAuditForRequest(
      {
        pricingMode: 'selling',
        sellingSubtotalPaise: 500_000,
        finalSubtotalPaise: null,
        acceptedAmountPaise: 360_000,
      },
      { sellingSubtotalPaise: 500_000, finalSubtotalPaise: 400_000 },
    )
    assert.equal(amounts.sellingSubtotalPaise, 500_000)
    assert.equal(amounts.finalSubtotalPaise, 400_000)
    assert.equal(amounts.finalSubtotalIsSaved, false)
    assert.equal(amounts.acceptedAmountPaise, 360_000)
    assert.match(String(warning), /below Final subtotal/)
    assert.match(String(warning), /Shortfall/)
  })

  it('request B: saved bargain Final, agreed equal → no warning', () => {
    const { amounts, warning } = listAuditForRequest(
      {
        pricingMode: 'bargain',
        sellingSubtotalPaise: 500_000,
        finalSubtotalPaise: 400_000,
        acceptedAmountPaise: 400_000,
      },
      null,
    )
    assert.equal(amounts.finalSubtotalPaise, 400_000)
    assert.equal(amounts.finalSubtotalIsSaved, true)
    assert.equal(warning, null)
  })

  it('request C: agreed saved, no Final audit and no catalogue view → no warning', () => {
    const { amounts, warning } = listAuditForRequest(
      {
        sellingSubtotalPaise: 200_000,
        finalSubtotalPaise: null,
        acceptedAmountPaise: 150_000,
      },
      null,
    )
    assert.equal(amounts.finalSubtotalPaise, null)
    assert.equal(amounts.acceptedAmountPaise, 150_000)
    assert.equal(warning, null)
  })
})
