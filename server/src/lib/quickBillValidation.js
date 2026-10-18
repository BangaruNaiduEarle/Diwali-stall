import { CUSTOMER_REQUEST_LIMITS, validateCustomerRequestBody } from './customerRequestValidation.js'

/**
 * Cart preview — items only (no customer fields).
 * @param {unknown} body
 */
export function validateQuickBillPreviewBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }
  const itemsRaw = /** @type {Record<string, unknown>} */ (body).items
  return validateCustomerRequestBody({
    customer: { name: 'Quick Bill', mobile: '9876543210' },
    items: itemsRaw,
  })
}

/**
 * Stall checkout — full customer + cart (reuses public request validation).
 * @param {unknown} body
 */
export function validateQuickBillCheckoutBody(body) {
  return validateCustomerRequestBody(body)
}

export { CUSTOMER_REQUEST_LIMITS }
