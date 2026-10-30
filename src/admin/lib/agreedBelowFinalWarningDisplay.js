import { formatListAuditPaise } from './adminCustomerRequestListAuditDisplay.js'

/** @param {unknown} shortfallPaise */
export function formatAgreedBelowFinalDetailMessage(shortfallPaise) {
  const shortfall = formatListAuditPaise(shortfallPaise)
  if (!shortfall) return null
  return `Customer agreed below Final subtotal (shortfall ${shortfall}).`
}

/**
 * @param {Record<string, unknown> | null | undefined} auditSummary
 */
export function formatAgreedBelowFinalListWarning(auditSummary) {
  const warn = auditSummary?.belowFinalWarning
  if (!warn || typeof warn !== 'object') return null
  const shortfall = formatListAuditPaise(
    /** @type {Record<string, unknown>} */ (warn).shortfallPaise,
  )
  if (!shortfall) return null
  const est =
    /** @type {Record<string, unknown>} */ (warn).finalSubtotalIsEstimate === true
      ? ' (Final est.)'
      : ''
  return `⚠ Customer agreed below Final subtotal${est} · Shortfall ${shortfall}`
}
