import {
  auditPaiseOrNull,
  buildAgreedBelowFinalWarningWithMeta,
} from '../../../src/lib/agreedBelowFinalWarning.js'

/** @deprecated Use buildAgreedBelowFinalWarning from src/lib/agreedBelowFinalWarning.js */
export { buildAgreedBelowFinalWarning as buildAgreedBelowFinalListWarning } from '../../../src/lib/agreedBelowFinalWarning.js'

/**
 * Owner list audit — saved quotation audit first, then catalogue internal pricing view (Request Detail parity).
 *
 * @param {Record<string, unknown>} quotation
 * @param {{
 *   sellingSubtotalPaise?: number | null,
 *   finalSubtotalPaise?: number | null,
 * } | null | undefined} internalPricingView
 */
export function resolveOwnerListRequestAuditAmounts(quotation, internalPricingView) {
  let sellingSubtotalPaise = auditPaiseOrNull(quotation.sellingSubtotalPaise)
  let finalSubtotalPaise = auditPaiseOrNull(quotation.finalSubtotalPaise)
  let finalSubtotalIsSaved = finalSubtotalPaise != null
  const acceptedAmountPaise = auditPaiseOrNull(quotation.acceptedAmountPaise)

  const view = internalPricingView
  if (view) {
    if (sellingSubtotalPaise === null) {
      sellingSubtotalPaise = auditPaiseOrNull(view.sellingSubtotalPaise)
    }
    if (finalSubtotalPaise === null) {
      const fromView = auditPaiseOrNull(view.finalSubtotalPaise)
      if (fromView != null) {
        finalSubtotalPaise = fromView
        finalSubtotalIsSaved = false
      }
    }
  }

  if (sellingSubtotalPaise === null) {
    sellingSubtotalPaise = auditPaiseOrNull(quotation.totalPaise)
  }

  return {
    sellingSubtotalPaise,
    finalSubtotalPaise,
    finalSubtotalIsSaved,
    acceptedAmountPaise,
  }
}

/**
 * @param {{
 *   sellingSubtotalPaise?: number | null,
 *   acceptedAmountPaise?: number | null,
 *   finalSubtotalPaise?: number | null,
 *   finalSubtotalIsSaved?: boolean,
 * }} input
 */
export function buildOwnerCustomerRequestListAuditSummary(input) {
  const sellingSubtotalPaise = auditPaiseOrNull(input.sellingSubtotalPaise)
  const acceptedAmountPaise = auditPaiseOrNull(input.acceptedAmountPaise)
  const finalSubtotalPaise = auditPaiseOrNull(input.finalSubtotalPaise)

  if (sellingSubtotalPaise === null && acceptedAmountPaise === null) {
    return null
  }

  const belowFinalWarning = buildAgreedBelowFinalWarningWithMeta(
    acceptedAmountPaise,
    finalSubtotalPaise,
    { finalSubtotalIsSaved: Boolean(input.finalSubtotalIsSaved) },
  )

  return {
    sellingSubtotalPaise,
    acceptedAmountPaise,
    ...(belowFinalWarning ? { belowFinalWarning } : {}),
  }
}
