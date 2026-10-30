/** @param {unknown} value @returns {number | null} */
export function auditPaiseOrNull(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * Owner/Super Admin — warn when saved agreed amount is below resolved Final subtotal.
 *
 * @param {number | null | undefined} acceptedAmountPaise
 * @param {number | null | undefined} finalSubtotalPaise
 */
export function buildAgreedBelowFinalWarning(acceptedAmountPaise, finalSubtotalPaise) {
  const accepted = auditPaiseOrNull(acceptedAmountPaise)
  const finalSub = auditPaiseOrNull(finalSubtotalPaise)
  if (accepted === null) return null
  if (finalSub === null || finalSub <= 0) return null
  if (accepted >= finalSub) return null
  return { shortfallPaise: finalSub - accepted }
}

/**
 * @param {number | null | undefined} acceptedAmountPaise
 * @param {number | null | undefined} finalSubtotalPaise
 * @param {{ finalSubtotalIsSaved?: boolean }} [meta]
 */
export function buildAgreedBelowFinalWarningWithMeta(
  acceptedAmountPaise,
  finalSubtotalPaise,
  meta = {},
) {
  const warning = buildAgreedBelowFinalWarning(acceptedAmountPaise, finalSubtotalPaise)
  if (!warning) return null
  if (meta.finalSubtotalIsSaved) return warning
  return { ...warning, finalSubtotalIsEstimate: true }
}
