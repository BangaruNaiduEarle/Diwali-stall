import { getWhatsAppWaMeDigits } from '../data/siteConfig'
import { formatINR } from './currency'
import { normalizeCustomerDetails } from './customerDetailsHelpers'
import { getEstimateProducts } from './estimateHelpers'

export const WHATSAPP_ENQUIRY_MESSAGE =
  'Hi, I would like to know more about your Diwali crackers collection.'

export function getWhatsAppUrl(message) {
  const digits = getWhatsAppWaMeDigits()
  if (!digits) return null
  const text = encodeURIComponent(message ?? WHATSAPP_ENQUIRY_MESSAGE)
  return `https://wa.me/${digits}?text=${text}`
}

export function getWhatsAppEnquiryUrl() {
  return getWhatsAppUrl(WHATSAPP_ENQUIRY_MESSAGE)
}

export function buildWhatsAppEstimateMessage(estimateItems, customerDetails = null) {
  const rows = getEstimateProducts(estimateItems)
  if (!rows.length) return ''

  const customer = customerDetails ? normalizeCustomerDetails(customerDetails) : null
  const subtotal = rows.reduce((sum, r) => sum + r.lineTotal, 0)

  const itemLines = rows.map(
    ({ product, quantity, lineTotal }, index) =>
      `${index + 1}. ${quantity} × ${product.name} — ${formatINR(lineTotal)}`,
  )

  const lines = ['DIWALI CRACKERS ESTIMATE REQUEST', '']

  if (customer?.name || customer?.mobile) {
    lines.push('Customer')
    if (customer.name) lines.push(`Name: ${customer.name}`)
    if (customer.mobile) lines.push(`Mobile: ${customer.mobile}`)
    if (customer.area) lines.push(`Area: ${customer.area}`)
    if (customer.pickupDate) lines.push(`Preferred pickup: ${customer.pickupDate}`)
    if (customer.note) lines.push(`Note: ${customer.note}`)
    lines.push('')
  }

  lines.push('Selected Products', ...itemLines, '', `Estimated Total: ${formatINR(subtotal)}`, '')
  lines.push('Please confirm availability and final price.')

  return lines.join('\n')
}

export function getWhatsAppEstimateUrl(estimateItems, customerDetails = null) {
  const message = buildWhatsAppEstimateMessage(estimateItems, customerDetails)
  if (!message) return null
  return getWhatsAppUrl(message)
}

/** @deprecated use getWhatsAppEstimateUrl */
export function buildWhatsAppOrderMessage(estimateItems, customerDetails) {
  return buildWhatsAppEstimateMessage(estimateItems, customerDetails)
}
