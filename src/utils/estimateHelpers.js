export const ESTIMATE_STORAGE_KEY = 'crackers_estimate'
export const ESTIMATE_MAX_QUANTITY = 99

/** @type {Map<string, Record<string, unknown>>} */
let productById = new Map()

/**
 * Sync runtime catalogue from D1 fetch (called by CatalogueProductsProvider).
 * @param {Array<{ id: string }>} products
 */
export function setEstimateCatalogueProducts(products) {
  productById = new Map((products ?? []).map((p) => [p.id, p]))
}

export function isProductSoldOut(product) {
  if (!product) return true
  const status = product.stockStatus
  return status === 'soldout' || status === 'sold-out'
}

export function normalizeEstimateItem(raw) {
  if (!raw || typeof raw.productId !== 'string') return null
  const quantity = Number(raw.quantity)
  if (!Number.isFinite(quantity) || quantity < 1) return null
  return {
    productId: raw.productId,
    quantity: Math.min(ESTIMATE_MAX_QUANTITY, Math.floor(quantity)),
  }
}

export function loadEstimateFromStorage() {
  try {
    const raw = localStorage.getItem(ESTIMATE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const items = []
    const seen = new Set()
    for (const entry of parsed) {
      const item = normalizeEstimateItem(entry)
      if (!item || seen.has(item.productId)) continue
      seen.add(item.productId)
      items.push(item)
    }
    return items
  } catch {
    return []
  }
}

export function saveEstimateToStorage(items) {
  try {
    localStorage.setItem(ESTIMATE_STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* quota / private mode */
  }
}

export function getProductById(productId) {
  return productById.get(String(productId ?? '').trim()) ?? null
}

/**
 * Public catalogue has no runtime price field. Subtotal stays 0 unless `price` is explicitly set later.
 * @param {Record<string, unknown> | null | undefined} product
 */
function unitPriceForEstimate(product) {
  const price = product?.price
  return typeof price === 'number' && Number.isFinite(price) ? price : 0
}

/** Estimate rows for messaging and internal helpers. Do not show lineTotal in customer UI. */
export function getEstimateProducts(estimateItems) {
  return estimateItems
    .map(({ productId, quantity }) => {
      const product = getProductById(productId)
      if (!product || isProductSoldOut(product)) return null
      return {
        productId,
        product,
        quantity,
        lineTotal: unitPriceForEstimate(product) * quantity,
      }
    })
    .filter(Boolean)
}

export function computeEstimateSubtotal(estimateItems) {
  return getEstimateProducts(estimateItems).reduce((sum, row) => sum + row.lineTotal, 0)
}

export function computeEstimateCount(estimateItems) {
  return estimateItems.reduce((sum, item) => sum + item.quantity, 0)
}
