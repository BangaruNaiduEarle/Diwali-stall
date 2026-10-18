import { paiseToInr } from '../services/money.js'

/**
 * @param {Record<string, unknown>} quotation
 * @param {Record<string, unknown>[]} items
 */
export function buildQuotationWhatsAppMessage(quotation, items) {
  const ref = String(quotation.id ?? '').trim()
  const customerName = quotation.customerName ?? quotation.customer_name ?? ''
  const customerPhone = quotation.customerPhone ?? quotation.customer_phone ?? ''
  const pickup = quotation.pickupPreference ?? quotation.pickup_preference ?? null

  const lines = ['DIWALI CRACKERS QUOTATION', ref ? `Ref: ${ref}` : '', '']

  if (customerName || customerPhone) {
    lines.push('Customer')
    if (customerName) lines.push(`Name: ${customerName}`)
    if (customerPhone) lines.push(`Mobile: ${customerPhone}`)
    if (pickup) lines.push(`Preferred pickup: ${pickup}`)
    lines.push('')
  }

  lines.push('Items')
  const sorted = [...items].sort((a, b) => Number(a.lineNumber ?? a.line_number) - Number(b.lineNumber ?? b.line_number))
  sorted.forEach((row, index) => {
    const name = row.productName ?? row.product_name
    const qty = row.quantity
    const unitInr = formatInrFromPaise(row.unitRatePaise ?? row.unit_rate_paise)
    lines.push(`${index + 1}. ${name} — Qty: ${qty} — Rate: ₹${unitInr}`)
  })

  const totalPaise = Number(quotation.totalPaise ?? quotation.total_paise ?? 0)
  lines.push('', `Grand total: ₹${formatInrFromPaise(totalPaise)}`, '', 'Please confirm to proceed with pickup.')

  return lines.filter((l) => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** @param {number} paise */
function formatInrFromPaise(paise) {
  const inr = paiseToInr(Number(paise))
  return inr.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/**
 * @param {string} message
 * @param {string | null | undefined} customerPhoneDigits
 */
export function buildWhatsAppSendUrl(message, customerPhoneDigits) {
  const digits = String(customerPhoneDigits ?? '').replace(/\D/g, '')
  const text = encodeURIComponent(message)
  if (digits.length >= 10) {
    return `https://wa.me/91${digits.slice(-10)}?text=${text}`
  }
  return `https://wa.me/?text=${text}`
}
