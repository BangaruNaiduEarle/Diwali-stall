import { rupeesToPaise, paiseInputValue } from './billAdjustment.js'
import { createQuickBillRetryKeys, newQuickBillCheckoutKey } from './quickBillCheckoutKey.js'

export const PAYMENT_METHOD_OPTIONS = ['CASH', 'UPI', 'CARD', 'BANK', 'OTHER']
export const PAYMENT_MODE_OPTIONS = ['ONLINE', 'OFFLINE']
let browserDeviceId = null

/** Identifies this browser instance for audit; no persistent/offline storage. */
export function paymentBrowserDeviceId() {
  if (!browserDeviceId) browserDeviceId = `browser-${newQuickBillCheckoutKey()}`
  return browserDeviceId
}

export function formatPaymentPaise(paise) {
  const value = paiseInputValue(paise)
  if (!value) return '—'
  const [whole, fraction] = value.split('.')
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(whole))}.${fraction}`
}

export function paymentSummaryDisplay(summary) {
  if (!summary) return null
  const status = ['UNPAID', 'PARTIAL', 'PAID', 'HOLD'].includes(summary.paymentStatus) ? summary.paymentStatus : 'UNPAID'
  return { status, label: { UNPAID: 'Unpaid', PARTIAL: 'Partial', PAID: 'Paid', HOLD: 'Payment hold' }[status],
    due: formatPaymentPaise(summary.amountDuePaise), received: formatPaymentPaise(summary.receivedPaise), outstanding: formatPaymentPaise(summary.outstandingPaise) }
}

export function paymentPayload({ entryType = 'PAYMENT', amountInr = '', recordingMode = 'ONLINE', paymentMethod = 'CASH', reference = '', details = '', occurredAt = '' }) {
  if (!['PAYMENT', 'HOLD', 'RELEASE_HOLD'].includes(entryType) || !PAYMENT_MODE_OPTIONS.includes(recordingMode)) return { ok: false, message: 'Choose a valid ledger action and recording mode.' }
  const amountPaise = entryType === 'PAYMENT' ? rupeesToPaise(amountInr, true) : 0
  if (amountPaise == null) return { ok: false, message: 'Enter a positive amount with at most two decimal places.' }
  if (entryType === 'PAYMENT' && !PAYMENT_METHOD_OPTIONS.includes(paymentMethod)) return { ok: false, message: 'Choose a payment method.' }
  if (entryType === 'PAYMENT' && ['UPI', 'CARD', 'BANK'].includes(paymentMethod) && !reference.trim()) return { ok: false, message: 'Enter the transaction reference.' }
  if (recordingMode === 'OFFLINE' && !occurredAt) return { ok: false, message: 'Enter the original occurrence time for an offline record.' }
  const body = { entryType, amountPaise, recordingMode }
  if (entryType === 'PAYMENT') {
    body.paymentMethod = paymentMethod
    if (reference.trim()) body.reference = reference.trim()
  }
  if (details.trim()) body.details = details.trim()
  if (occurredAt) {
    const date = new Date(occurredAt)
    if (!Number.isFinite(date.getTime())) return { ok: false, message: 'Enter a valid occurrence time.' }
    body.occurredAt = date.toISOString()
  }
  return { ok: true, body }
}

/** Memory-only retries for the current online form; no offline storage/sync. */
export function createPaymentOperationKeys(generate = newQuickBillCheckoutKey) {
  const keys = createQuickBillRetryKeys(generate)
  return { forEntry: (payload, contextKey) => keys.forCheckout(payload, contextKey), complete: () => keys.complete() }
}
