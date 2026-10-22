import { getWhatsAppWaMeDigits } from '../data/siteConfig.js'
import { normalizeCustomerDetails } from './customerDetailsHelpers.js'
import { formatINR } from './currency.js'
import { getEstimateDisplayRows } from './estimateHelpers.js'

export const WHATSAPP_ENQUIRY_MESSAGE =
  'Hi, I would like to know more about your Diwali crackers collection.'

const GIFT_PROMO_FOOTER = '🎁 A complimentary gift is included with every order'
const THANK_YOU_FOOTER = 'Thank you for choosing Diwali Stall! 🙏✨'

function joinEstimateLineSegments(segments) {
  return segments.filter(Boolean).join(' — ')
}

export function getWhatsAppUrl(message) {
  const digits = getWhatsAppWaMeDigits()
  if (!digits) return null
  const text = encodeURIComponent(message ?? WHATSAPP_ENQUIRY_MESSAGE)
  return `https://wa.me/${digits}?text=${text}`
}

export function getWhatsAppEnquiryUrl() {
  return getWhatsAppUrl(WHATSAPP_ENQUIRY_MESSAGE)
}

export function buildWhatsAppEstimateMessage(estimateItems, customerDetails = null, publicReference = null) {
  const rows = getEstimateDisplayRows(estimateItems)
  if (!rows.length) return ''

  const customer = customerDetails ? normalizeCustomerDetails(customerDetails) : null
  const referenceLine =
    typeof publicReference === 'string' && publicReference.trim()
      ? `Estimate Reference: ${publicReference.trim()}`
      : null

  const itemLines = rows.map((row, index) => {
    if (row.lineType === 'family_pack') {
      const segments = [`${index + 1}. ${row.name} (Family pack)`, `Qty: ${row.quantity}`]
      if (row.unitPriceInr > 0) segments.push(`Unit: ${formatINR(row.unitPriceInr)}`)
      if (row.lineTotal > 0) segments.push(`Line: ${formatINR(row.lineTotal)}`)
      return joinEstimateLineSegments(segments)
    }
    const segments = [`${index + 1}. ${row.product.name}`, `Qty: ${row.quantity}`]
    const pack = row.product?.pack?.trim()
    if (pack) segments.push(`Unit: ${pack}`)
    return joinEstimateLineSegments(segments)
  })

  const grandTotal = rows.reduce((sum, row) => {
    if (row.lineType === 'family_pack') return sum + (row.lineTotal || 0)
    return sum + (row.lineTotal || 0)
  }, 0)

  const lines = ['DIWALI CRACKERS ESTIMATE REQUEST', '']
  if (referenceLine) {
    lines.push(referenceLine, '')
  }

  if (customer?.name || customer?.mobile) {
    lines.push('Customer')
    if (customer.name) lines.push(`Name: ${customer.name}`)
    if (customer.mobile) lines.push(`Mobile: ${customer.mobile}`)
    if (customer.area) lines.push(`Area: ${customer.area}`)
    if (customer.pickupDate) lines.push(`Preferred pickup: ${customer.pickupDate}`)
    if (customer.note) lines.push(`Note: ${customer.note}`)
    lines.push('')
  }

  lines.push('Selected items', ...itemLines, '')
  if (grandTotal > 0) {
    lines.push(`Estimated pack total (pack lines only where priced): ${formatINR(grandTotal)}`, '')
  }
  lines.push('Please confirm availability and share your quotation.')
  lines.push(GIFT_PROMO_FOOTER)
  lines.push(THANK_YOU_FOOTER)

  return lines.join('\n')
}

export function getWhatsAppEstimateUrl(estimateItems, customerDetails = null, publicReference = null) {
  const message = buildWhatsAppEstimateMessage(estimateItems, customerDetails, publicReference)
  if (!message) return null
  return getWhatsAppUrl(message)
}

/** @deprecated use getWhatsAppEstimateUrl */
export function buildWhatsAppOrderMessage(estimateItems, customerDetails) {
  return buildWhatsAppEstimateMessage(estimateItems, customerDetails)
}
