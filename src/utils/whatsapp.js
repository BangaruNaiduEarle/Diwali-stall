import { getWhatsAppWaMeDigits } from '../data/siteConfig.js'
import { normalizeCustomerDetails } from './customerDetailsHelpers.js'
import { getEstimateDisplayRows } from './estimateHelpers.js'

export const WHATSAPP_ENQUIRY_MESSAGE =
  'Hi, I would like to know more about your Diwali crackers collection.'

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
      return joinEstimateLineSegments([`${index + 1}. ${row.name}`, `Qty: ${row.quantity}`])
    }
    return joinEstimateLineSegments([`${index + 1}. ${row.product.name}`, `Qty: ${row.quantity}`])
  })

  const lines = ['DIWALI CRACKERS ESTIMATE REQUEST', '']
  if (referenceLine) {
    lines.push(referenceLine, '')
  }

  if (customer?.name || customer?.mobile) {
    lines.push('Customer')
    if (customer.name) lines.push(`Name: ${customer.name}`)
    if (customer.mobile) lines.push(`Mobile: ${customer.mobile}`)
    lines.push('')
  }

  lines.push('Selected items', ...itemLines, '')
  lines.push('Please confirm availability and share your quotation.')

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
