import { getFamilyPackById, isFamilyPackAvailableForEstimate } from './familyPackCatalogue.js'
import { paiseToInr } from './currencyPaise.js'

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

export function isFamilyPackEstimateItem(item) {
  return Boolean(item && typeof item.familyPackId === 'string' && item.familyPackId.trim())
}

export function normalizeEstimateItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const quantity = Number(raw.quantity)
  if (!Number.isFinite(quantity) || quantity < 1) return null
  const clamped = Math.min(ESTIMATE_MAX_QUANTITY, Math.floor(quantity))

  const familyPackId = String(raw.familyPackId ?? '').trim()
  if (familyPackId) {
    const snapshotName = String(raw.snapshotName ?? '').trim()
    const snapshotPricePaiseRaw = Number(raw.snapshotPricePaise)
    const snapshotPricePaise = Number.isInteger(snapshotPricePaiseRaw) ? snapshotPricePaiseRaw : undefined
    return {
      familyPackId,
      quantity: clamped,
      ...(snapshotName ? { snapshotName } : {}),
      ...(snapshotPricePaise !== undefined ? { snapshotPricePaise } : {}),
    }
  }

  if (typeof raw.productId !== 'string') return null
  return {
    productId: raw.productId.trim(),
    quantity: clamped,
  }
}

function estimateItemKey(item) {
  if (isFamilyPackEstimateItem(item)) return `fp:${item.familyPackId}`
  return `p:${item.productId}`
}

/** Remove legacy cart draft from localStorage (public estimate is session-only). */
export function clearEstimateLocalStorage() {
  try {
    localStorage.removeItem(ESTIMATE_STORAGE_KEY)
  } catch {
    /* private mode / SSR */
  }
}

/** @deprecated Public estimate cart is session-only; always returns []. */
export function loadEstimateFromStorage() {
  return []
}

export function saveEstimateToStorage(_items) {
  /* session-only — no localStorage persistence */
}

/**
 * Normalize draft lines (session state only; not persisted to localStorage).
 * @param {{ productId: string, quantity: number }[]} items
 * @returns {{ productId: string, quantity: number }[]}
 */
export function persistDraftEstimateItems(items) {
  const normalized = []
  const seen = new Set()
  for (const entry of items ?? []) {
    const item = normalizeEstimateItem(entry)
    if (!item) continue
    const key = estimateItemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(item)
  }
  return normalized
}

export function getProductById(productId) {
  return productById.get(String(productId ?? '').trim()) ?? null
}

/**
 * Storefront price comes from public API `sellingPricePaise` mapped to `price` (D1 products.selling_price_paise).
 * @param {Record<string, unknown> | null | undefined} product
 */
function unitPriceForEstimate(product) {
  const price = product?.price
  return typeof price === 'number' && Number.isFinite(price) ? price : 0
}

/** Product-only estimate rows. Do not show lineTotal in customer UI. */
export function getEstimateProducts(estimateItems) {
  return estimateItems
    .filter((item) => !isFamilyPackEstimateItem(item))
    .map(({ productId, quantity }) => {
      const product = getProductById(productId)
      if (!product || isProductSoldOut(product)) return null
      return {
        lineType: 'product',
        productId,
        product,
        quantity,
        lineTotal: unitPriceForEstimate(product) * quantity,
      }
    })
    .filter(Boolean)
}

/** Family pack lines with price snapshots (pack is one billable SKU). */
export function getFamilyPackEstimateRows(estimateItems) {
  return estimateItems
    .filter(isFamilyPackEstimateItem)
    .map((item) => {
      const pack = getFamilyPackById(item.familyPackId)
      const liveName = pack ? String(pack.name) : null
      const livePaise = pack ? Number(pack.sellingPricePaise) : null
      const name = item.snapshotName || liveName || 'Family pack'
      const unitPricePaise =
        Number.isInteger(item.snapshotPricePaise) && item.snapshotPricePaise > 0
          ? item.snapshotPricePaise
          : Number.isInteger(livePaise) && livePaise > 0
            ? livePaise
            : 0
      const available = isFamilyPackAvailableForEstimate(item.familyPackId)
      return {
        lineType: 'family_pack',
        familyPackId: item.familyPackId,
        pack,
        name,
        quantity: item.quantity,
        unitPricePaise,
        unitPriceInr: paiseToInr(unitPricePaise),
        lineTotalPaise: unitPricePaise * item.quantity,
        lineTotal: paiseToInr(unitPricePaise * item.quantity),
        unavailable: !available && !item.snapshotName,
        snapshotStale:
          pack &&
          Number.isInteger(item.snapshotPricePaise) &&
          Number.isInteger(livePaise) &&
          item.snapshotPricePaise !== livePaise,
      }
    })
    .filter((row) => row.name)
}

export function getEstimateDisplayRows(estimateItems) {
  return [...getEstimateProducts(estimateItems), ...getFamilyPackEstimateRows(estimateItems)]
}

export function computeEstimateSubtotal(estimateItems) {
  const productTotal = getEstimateProducts(estimateItems).reduce((sum, row) => sum + row.lineTotal, 0)
  const packTotal = getFamilyPackEstimateRows(estimateItems).reduce((sum, row) => sum + row.lineTotal, 0)
  return productTotal + packTotal
}

/**
 * @param {string} familyPackId
 * @returns {{ familyPackId: string, snapshotName: string, snapshotPricePaise: number } | null}
 */
export function buildFamilyPackEstimateSnapshot(familyPackId) {
  const pack = getFamilyPackById(familyPackId)
  if (!pack) return null
  const sellingPricePaise = Number(pack.sellingPricePaise)
  if (!Number.isInteger(sellingPricePaise) || sellingPricePaise <= 0) return null
  return {
    familyPackId,
    snapshotName: String(pack.name),
    snapshotPricePaise: sellingPricePaise,
  }
}

export function computeEstimateCount(estimateItems) {
  return estimateItems.reduce((sum, item) => sum + item.quantity, 0)
}
