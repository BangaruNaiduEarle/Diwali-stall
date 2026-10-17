/**
 * Pure mapping for POST /api/public/customer-requests (storefront).
 * Kept in sync with server/src/lib/storefrontCustomerRequestPayload.js behavior.
 */

/**
 * @param {{ name: string, mobile: string, area?: string, pickupDate?: string, note?: string }} customer
 * @param {{ productId: string, quantity: number }[]} estimateItems
 */
export function buildCustomerRequestBodyFromParts(customer, estimateItems) {
  const items = [...estimateItems]
    .map((entry) => ({
      productId: String(entry.productId ?? '').trim(),
      quantity: Math.floor(Number(entry.quantity)),
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId))

  return {
    customer: {
      name: String(customer.name ?? '').trim(),
      mobile: String(customer.mobile ?? '').replace(/\D/g, ''),
      area: String(customer.area ?? '').trim(),
      pickupDate: String(customer.pickupDate ?? '').trim(),
      note: String(customer.note ?? '').trim(),
    },
    items,
  }
}

/**
 * @param {{ name: string, mobile: string, area?: string, pickupDate?: string, note?: string }} customer
 * @param {{ productId: string, quantity: number }[]} estimateItems
 */
export function buildSubmissionFingerprintFromParts(customer, estimateItems) {
  return JSON.stringify(buildCustomerRequestBodyFromParts(customer, estimateItems))
}

/**
 * @param {string} fingerprint
 */
export async function idempotencyKeyFromFingerprint(fingerprint) {
  const data = new TextEncoder().encode(String(fingerprint ?? ''))
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `est_${hex.slice(0, 48)}`
}

export function createSubmitGuard() {
  let inFlight = false
  return {
    tryBegin() {
      if (inFlight) return false
      inFlight = true
      return true
    },
    end() {
      inFlight = false
    },
    get isInFlight() {
      return inFlight
    },
  }
}
