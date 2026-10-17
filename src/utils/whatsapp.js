import { getWhatsAppWaMeDigits } from '../data/siteConfig'
import { normalizeCustomerDetails } from './customerDetailsHelpers'
import { getEstimateProducts } from './estimateHelpers'

export const WHATSAPP_ENQUIRY_MESSAGE =
  'Hi, I would like to know more about your Diwali crackers collection.'

const GIFT_PROMO_FOOTER = '🎁 A complimentary gift is included with every order.'

function formatEstimateUnit(product) {
  const pack = product?.pack?.trim()
  return pack || '—'
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

export function buildWhatsAppEstimateMessage(estimateItems, customerDetails = null) {
  const rows = getEstimateProducts(estimateItems)
  if (!rows.length) return ''

  const customer = customerDetails ? normalizeCustomerDetails(customerDetails) : null

  const itemLines = rows.map(({ product, quantity }, index) => {
    const unit = formatEstimateUnit(product)
    return `${index + 1}. ${product.name} — Qty: ${quantity} — Unit: ${unit}`
  })

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

  lines.push('Selected products', ...itemLines, '')
  lines.push('Please confirm availability and share your quotation.')
  lines.push(GIFT_PROMO_FOOTER)

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
