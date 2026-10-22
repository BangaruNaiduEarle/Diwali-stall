import { isFreeDoorDeliveryEligiblePaise } from './freeDoorDelivery.js'
import { paiseToInr } from '../services/money.js'

const THANK_YOU = 'Thank you for choosing Diwali Stall! 🙏✨'

/** @param {number} paise */
function formatInrFromPaise(paise) {
  const inr = paiseToInr(Number(paise))
  return inr.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/**
 * @param {Record<string, unknown>} request
 * @param {Record<string, unknown>} quotation
 */
export function buildOrderConfirmationWhatsAppMessage(request, quotation) {
  const name = String(request.customerName ?? request.customer_name ?? '').trim() || 'Customer'
  const orderRef = String(
    request.publicReference ?? request.public_reference ?? quotation.id ?? '',
  ).trim()
  const totalPaise = Number(quotation.totalPaise ?? quotation.total_paise ?? 0)
  const totalLine = `Order Total: ₹${formatInrFromPaise(totalPaise)}`
  const source = String(request.source ?? '').trim()
  const freeDelivery = isFreeDoorDeliveryEligiblePaise(totalPaise)

  const lines = ['DIWALI STALL — ORDER CONFIRMATION 🎆', '', `Hello ${name}!`, '', 'Thank you for your order.', '']

  if (orderRef) {
    lines.push(`Order Reference: ${orderRef}`, '')
  }

  lines.push(totalLine, '')

  if (freeDelivery && source === 'web') {
    const address = String(request.deliveryAddress ?? request.delivery_address ?? '').trim()
    const area = String(request.customerArea ?? request.customer_area ?? '').trim()
    const landmark = String(request.deliveryLandmark ?? request.delivery_landmark ?? '').trim()
    const mapsUrl = String(request.deliveryMapsUrl ?? request.delivery_maps_url ?? '').trim()

    if (!address && !area) {
      return {
        ok: false,
        code: 'delivery_location_required',
        message: 'Delivery address or area is required before confirming free door delivery.',
      }
    }

    lines.push('Delivery: FREE DOOR DELIVERY 🎉 (subject to coverage in your area)', '')
    const locationParts = [area, address].filter(Boolean).join(', ')
    if (locationParts) {
      lines.push(`Delivery Location: ${locationParts}`, '')
    }
    if (landmark) {
      lines.push(`Landmark: ${landmark}`, '')
    }
    if (mapsUrl) {
      lines.push(`Google Maps Location: ${mapsUrl}`, '')
    }
    lines.push(
      'We have confirmed your order. Our team will verify delivery coverage and coordinate delivery details with you.',
      '',
      THANK_YOU,
    )
    return { ok: true, message: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
  }

  if (source === 'manual') {
    return {
      ok: true,
      message: ['DIWALI STALL — ORDER CONFIRMATION 🎆', '', totalLine].join('\n').trim(),
    }
  }

  lines.push(
    'We have confirmed your order. Please confirm pickup arrangements with our team.',
    '',
    'Please confirm to proceed with pickup.',
    '',
    THANK_YOU,
  )
  return { ok: true, message: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}
