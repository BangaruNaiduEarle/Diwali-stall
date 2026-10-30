import { savedAcceptedAmountPaiseIsValid } from '../../lib/quotationBargainMode.js'

/** @param {unknown} inrStr */
export function parseCustomerAgreedInrToPaise(inrStr) {
  const trimmed = String(inrStr ?? '').trim()
  if (!trimmed) {
    return { ok: false, message: 'Enter the customer-agreed amount in rupees.' }
  }
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, message: 'Enter a positive rupee amount.' }
  }
  const paise = Math.round(n * 100)
  if (!Number.isInteger(paise) || paise <= 0) {
    return { ok: false, message: 'Amount could not be converted to paise.' }
  }
  return { ok: true, paise }
}

export const CUSTOMER_AGREED_AMOUNT_REQUIRED_BEFORE_FINALIZE =
  'Customer Agreed Amount is required before finalizing.'

/**
 * Finalize is allowed only when the input parses to a positive amount that matches
 * the active quotation's saved accepted_amount_paise.
 *
 * @param {{ acceptedAmountPaise?: number | null } | null | undefined} quotation
 * @param {unknown} agreedAmountInr
 */
export function customerAgreedAmountReadyToFinalize(quotation, agreedAmountInr) {
  const parsed = parseCustomerAgreedInrToPaise(agreedAmountInr)
  if (!parsed.ok) return false
  const saved = quotation?.acceptedAmountPaise
  if (!savedAcceptedAmountPaiseIsValid(saved)) return false
  return parsed.paise === Number(saved)
}
