import {
  auditPaiseOrNull,
  buildAgreedBelowFinalWarningWithMeta,
} from '../../lib/agreedBelowFinalWarning.js'

/** ₹500 — must match server QUICK_BILL_BARGAIN_FLOOR_MARGIN_PAISE */
const BARGAIN_FLOOR_MARGIN_PAISE = 50_000

/** @param {unknown} value @returns {number | null} */
export function quotationAuditPaiseOrNull(value) {
  return auditPaiseOrNull(value)
}

/**
 * Owner/Super Admin internal summary — saved bargain audit wins over catalogue estimates.
 *
 * @param {{
 *   quotation?: Record<string, unknown> | null,
 *   internalPricingView?: {
 *     sellingSubtotalPaise?: number | null,
 *     finalSubtotalPaise?: number | null,
 *     bargainFloorPaise?: number | null,
 *   } | null,
 *   internalPricingPreview?: {
 *     sellingSubtotalPaise?: number | null,
 *     finalSubtotalPaise?: number | null,
 *     bargainFloorPaise?: number | null,
 *   } | null,
 *   requestSource?: string,
 * }} input
 */
export function resolveInternalSummaryDisplay(input) {
  const quotation = input.quotation
  const view = input.internalPricingView ?? input.internalPricingPreview
  const requestSource = String(input.requestSource ?? '')

  const pricingModeRaw = String(quotation?.pricingMode ?? '')
  const isBargainMode = pricingModeRaw === 'bargain'

  const savedSelling = quotationAuditPaiseOrNull(quotation?.sellingSubtotalPaise)
  const savedFinal = quotationAuditPaiseOrNull(quotation?.finalSubtotalPaise)
  const savedFloor = quotationAuditPaiseOrNull(quotation?.bargainFloorPaise)
  const savedAgreed = quotationAuditPaiseOrNull(quotation?.acceptedAmountPaise)

  const estimateSelling = quotationAuditPaiseOrNull(view?.sellingSubtotalPaise)
  const estimateFinal = quotationAuditPaiseOrNull(view?.finalSubtotalPaise)
  const estimateFloor = quotationAuditPaiseOrNull(view?.bargainFloorPaise)

  if (isBargainMode) {
    const finalSubtotalPaise = savedFinal ?? estimateFinal
    let bargainFloorPaise = savedFloor
    if (bargainFloorPaise == null && finalSubtotalPaise != null) {
      bargainFloorPaise = finalSubtotalPaise + BARGAIN_FLOOR_MARGIN_PAISE
    }

    const hasSavedCheckoutAudit =
      savedSelling != null || savedFinal != null || savedFloor != null

    return {
      isBargainMode: true,
      headlineLabel: hasSavedCheckoutAudit ? 'Saved at checkout' : 'Catalogue estimate',
      sellingSubtotalPaise: savedSelling ?? estimateSelling,
      sellingSubtotalIsSaved: savedSelling != null,
      finalSubtotalPaise,
      finalSubtotalIsSaved: savedFinal != null,
      bargainFloorPaise,
      showBargainFloor: bargainFloorPaise != null,
      bargainFloorIsEstimate: savedFloor == null && bargainFloorPaise != null,
      acceptedAmountPaise: savedAgreed,
      belowFinalWarning: buildAgreedBelowFinalWarningWithMeta(savedAgreed, finalSubtotalPaise, {
        finalSubtotalIsSaved: savedFinal != null,
      }),
    }
  }

  const isManualStall = requestSource === 'manual'
  const showReferenceFloor = isManualStall && estimateFloor != null
  const sellingFromCheckout = pricingModeRaw === 'selling' && savedSelling != null
  const finalSubtotalPaise = estimateFinal ?? savedFinal

  return {
    isBargainMode: false,
    headlineLabel: 'Catalogue estimate',
    sellingSubtotalPaise: sellingFromCheckout ? savedSelling : (estimateSelling ?? savedSelling),
    sellingSubtotalIsSaved: sellingFromCheckout,
    finalSubtotalPaise,
    finalSubtotalIsSaved: false,
    bargainFloorPaise: showReferenceFloor ? estimateFloor : null,
    showBargainFloor: showReferenceFloor,
    bargainFloorIsEstimate: true,
    acceptedAmountPaise: savedAgreed,
    belowFinalWarning: buildAgreedBelowFinalWarningWithMeta(savedAgreed, finalSubtotalPaise, {
      finalSubtotalIsSaved: false,
    }),
  }
}

/** @param {ReturnType<typeof resolveInternalSummaryDisplay> | null} summary */
export function internalSummaryHasVisibleContent(summary) {
  if (!summary) return false
  return (
    summary.sellingSubtotalPaise != null ||
    summary.finalSubtotalPaise != null ||
    summary.showBargainFloor ||
    summary.acceptedAmountPaise != null ||
    summary.isBargainMode
  )
}
