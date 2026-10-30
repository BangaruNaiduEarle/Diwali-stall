/**
 * Detect bargain audit on a quotation (Quick Bill / adjust bill / finalize).
 *
 * @param {{ pricingMode?: string | null, bargainFloorPaise?: number | null, finalSubtotalPaise?: number | null } | null | undefined} quotation
 */
export function quotationIsBargainMode(quotation) {
  if (!quotation || typeof quotation !== 'object') return false
  if (String(quotation.pricingMode ?? '').trim().toLowerCase() === 'bargain') return true
  const floor = quotation.bargainFloorPaise
  if (floor != null && Number.isInteger(Number(floor)) && Number(floor) >= 0) {
    return true
  }
  return false
}

/**
 * @param {{ pricingMode?: string | null, pricing_mode?: string | null, acceptedAmountPaise?: number | null, accepted_amount_paise?: number | null, bargainFloorPaise?: number | null, bargain_floor_paise?: number | null } | null | undefined} quotation
 */
export function activeQuotationAuditRowFromApi(quotation) {
  if (!quotation || typeof quotation !== 'object') return null
  const accepted =
    quotation.acceptedAmountPaise !== undefined
      ? quotation.acceptedAmountPaise
      : quotation.accepted_amount_paise
  return {
    pricing_mode: quotation.pricingMode ?? quotation.pricing_mode,
    accepted_amount_paise: accepted !== undefined ? accepted : null,
    bargain_floor_paise: quotation.bargainFloorPaise ?? quotation.bargain_floor_paise,
  }
}

/**
 * Authoritative check against D1 quotation row at finalize time.
 *
 * @param {{ pricing_mode?: string | null, accepted_amount_paise?: number | null, bargain_floor_paise?: number | null } | null | undefined} row
 */
/** @param {unknown} paise */
export function savedAcceptedAmountPaiseIsValid(paise) {
  if (paise === null || paise === undefined) return false
  const p = Number(paise)
  return Number.isInteger(p) && p > 0
}

export function bargainDbRowRequiresAgreedAmount(row) {
  if (!row || typeof row !== 'object') return false
  const mode = String(row.pricing_mode ?? '').trim().toLowerCase()
  const isBargain = mode === 'bargain' || row.bargain_floor_paise != null
  if (!isBargain) return false
  return !savedAcceptedAmountPaiseIsValid(row.accepted_amount_paise)
}

/**
 * UI gate — same rules as finalize SQL (bargain + saved positive agreed amount).
 *
 * @param {{ pricingMode?: string | null, acceptedAmountPaise?: number | null, bargainFloorPaise?: number | null } | null | undefined} quotation
 */
export function bargainFinalizeBlockedForActiveQuotation(quotation) {
  return bargainDbRowRequiresAgreedAmount(activeQuotationAuditRowFromApi(quotation))
}

/**
 * Finalize gate — all pricing modes require a saved positive customer-agreed amount.
 *
 * @param {{ acceptedAmountPaise?: number | null, accepted_amount_paise?: number | null } | null | undefined} quotation
 */
export function finalizeBlockedForMissingSavedAgreedAmount(quotation) {
  if (!quotation || typeof quotation !== 'object') return true
  const row = activeQuotationAuditRowFromApi(quotation)
  return dbRowBlocksFinalizeMissingAgreedAmount(row)
}

/**
 * @param {{ accepted_amount_paise?: number | null } | null | undefined} row
 */
export function dbRowBlocksFinalizeMissingAgreedAmount(row) {
  if (!row || typeof row !== 'object') return true
  return !savedAcceptedAmountPaiseIsValid(row.accepted_amount_paise)
}

/** @deprecated Use bargainFinalizeBlockedForActiveQuotation */
export function bargainFinalizeBlockedMissingAgreedAmount(quotation) {
  return bargainFinalizeBlockedForActiveQuotation(quotation)
}
