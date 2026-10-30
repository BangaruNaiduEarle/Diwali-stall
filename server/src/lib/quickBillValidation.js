import { CUSTOMER_REQUEST_LIMITS, validateCustomerRequestBody } from './customerRequestValidation.js'
import { parseQuickBillAcceptedAmountPaise, parseQuickBillPricingMode } from './quickBillBargain.js'

const QUICK_BILL_CHECKOUT_BODY_KEYS = new Set([
  'pricingMode',
  'pricing_mode',
  'acceptedAmountPaise',
  'accepted_amount_paise',
  'acceptedAmountInr',
  'accepted_amount_inr',
])

/** @param {Record<string, unknown>} record */
function customerBodyForQuickBillCheckout(record) {
  /** @type {Record<string, unknown>} */
  const next = {}
  for (const [key, value] of Object.entries(record)) {
    if (!QUICK_BILL_CHECKOUT_BODY_KEYS.has(key)) {
      next[key] = value
    }
  }
  return next
}

/**
 * Cart preview — items only (no customer fields).
 * @param {unknown} body
 * @param {unknown} adminRole
 */
export function validateQuickBillPreviewBody(body, adminRole) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }
  const record = /** @type {Record<string, unknown>} */ (body)
  const pricing = parseQuickBillPricingMode(record.pricingMode ?? record.pricing_mode, adminRole)
  if (!pricing.ok) {
    if (pricing.errors) {
      return { ok: false, errors: pricing.errors }
    }
    return {
      ok: false,
      status: pricing.status ?? 403,
      code: pricing.code,
      message: pricing.message,
    }
  }

  const itemsRaw = record.items
  const base = validateCustomerRequestBody(
    {
      customer: { name: 'Quick Bill', mobile: '9876543210' },
      items: itemsRaw,
    },
    { quickBillItems: true },
  )
  if (!base.ok) return base

  return {
    ok: true,
    data: {
      items: base.data.items,
      pricingMode: pricing.pricingMode,
    },
  }
}

/**
 * Stall checkout — full customer + cart (reuses public request validation).
 * @param {unknown} body
 * @param {unknown} adminRole
 */
export function validateQuickBillCheckoutBody(body, adminRole) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }
  const record = /** @type {Record<string, unknown>} */ (body)
  const pricing = parseQuickBillPricingMode(record.pricingMode ?? record.pricing_mode, adminRole)
  if (!pricing.ok) {
    if (pricing.errors) {
      return { ok: false, errors: pricing.errors }
    }
    return {
      ok: false,
      status: pricing.status ?? 403,
      code: pricing.code,
      message: pricing.message,
    }
  }

  const accepted = parseQuickBillAcceptedAmountPaise(body, pricing.pricingMode)
  if (!accepted.ok) {
    return { ok: false, errors: accepted.errors }
  }

  const base = validateCustomerRequestBody(customerBodyForQuickBillCheckout(record), {
    quickBillItems: true,
  })
  if (!base.ok) return base

  return {
    ok: true,
    data: {
      ...base.data,
      pricingMode: pricing.pricingMode,
      acceptedAmountPaise: accepted.acceptedAmountPaise,
    },
  }
}

export { CUSTOMER_REQUEST_LIMITS }
