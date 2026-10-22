/**
 * Pure mapping for POST /api/public/customer-requests (shared by storefront + tests).
 */

/**
 * @param {{ name: string, mobile: string, area?: string, deliveryAddress?: string, deliveryLandmark?: string, deliveryMapsUrl?: string, pickupDate?: string, note?: string }} customer
 * @param {{ productId: string, quantity: number }[]} estimateItems
 */
export function buildCustomerRequestBodyFromParts(customer, estimateItems) {
  const items = [...estimateItems]
    .map((entry) => {
      const familyPackId = String(entry.familyPackId ?? entry.family_pack_id ?? '').trim()
      const productId = String(entry.productId ?? '').trim()
      if (familyPackId) {
        return { familyPackId, quantity: Math.floor(Number(entry.quantity)) }
      }
      return { productId, quantity: Math.floor(Number(entry.quantity)) }
    })
    .sort((a, b) => {
      const keyA = a.familyPackId ? `fp:${a.familyPackId}` : `p:${a.productId}`
      const keyB = b.familyPackId ? `fp:${b.familyPackId}` : `p:${b.productId}`
      return keyA.localeCompare(keyB)
    })

  return {
    customer: {
      name: String(customer.name ?? '').trim(),
      mobile: String(customer.mobile ?? '').replace(/\D/g, ''),
      area: String(customer.area ?? '').trim(),
      deliveryAddress: String(customer.deliveryAddress ?? '').trim(),
      deliveryLandmark: String(customer.deliveryLandmark ?? '').trim(),
      deliveryMapsUrl: String(customer.deliveryMapsUrl ?? '').trim(),
      pickupDate: String(customer.pickupDate ?? '').trim(),
      note: String(customer.note ?? '').trim(),
    },
    items,
  }
}

/**
 * @param {{ name: string, mobile: string, area?: string, deliveryAddress?: string, deliveryLandmark?: string, deliveryMapsUrl?: string, pickupDate?: string, note?: string }} customer
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
