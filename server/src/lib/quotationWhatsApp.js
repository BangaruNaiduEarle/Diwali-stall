import { paiseToInr } from '../services/money.js'

const THANK_YOU_FOOTER = 'Thank you for choosing Diwali Stall! 🙏✨'

/**
 * @param {unknown} requestSource
 * @returns {'preorder' | 'walk_in'}
 */
export function resolveQuotationWhatsAppFormat(requestSource) {
  return String(requestSource ?? '').trim() === 'web' ? 'preorder' : 'walk_in'
}

/**
 * @param {Record<string, unknown>} quotation
 * @param {Record<string, unknown>[]} items
 * @param {{ requestSource?: string | null }} [options]
 */
export function buildQuotationWhatsAppMessage(quotation, items, options = {}) {
  const format = resolveQuotationWhatsAppFormat(options.requestSource)
  const ref = String(quotation.id ?? '').trim()
  const totalPaise = Number(quotation.totalPaise ?? quotation.total_paise ?? 0)
  const grandTotalLine = `Grand total: ₹${formatInrFromPaise(totalPaise)}`

  const lines = ['DIWALI CRACKERS QUOTATION']
  if (ref) lines.push(`Ref: ${ref}`)

  if (format === 'walk_in') {
    lines.push('', grandTotalLine)
    return lines.join('\n').trim()
  }

  const customerName = quotation.customerName ?? quotation.customer_name ?? ''
  const customerPhone = quotation.customerPhone ?? quotation.customer_phone ?? ''

  lines.push('')

  if (customerName || customerPhone) {
    lines.push('Customer')
    if (customerName) lines.push(`Name: ${customerName}`)
    if (customerPhone) lines.push(`Mobile: ${customerPhone}`)
    lines.push('')
  }

  lines.push('Items')
  const sorted = [...items].sort((a, b) => Number(a.lineNumber ?? a.line_number) - Number(b.lineNumber ?? b.line_number))
  sorted.forEach((row, index) => {
    const name = row.productName ?? row.product_name
    const qty = row.quantity
    lines.push(`${index + 1}. ${name} — Qty: ${qty}`)
  })

  lines.push('', grandTotalLine, '', 'Please confirm to proceed with pickup.', THANK_YOU_FOOTER)

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
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
