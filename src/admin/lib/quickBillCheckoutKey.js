/** Keys belong to one mounted checkout workflow; never persist customer/cart data. */
export function newQuickBillCheckoutKey() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID()
  return [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('')
}

export function createQuickBillRetryKeys(generate = newQuickBillCheckoutKey) {
  let fingerprint = null, key = null
  return {
    forCheckout(payload, contextKey) {
      const next = JSON.stringify([contextKey, payload])
      if (next !== fingerprint) { fingerprint = next; key = generate() }
      return key
    },
    complete() { fingerprint = null; key = null },
  }
}
