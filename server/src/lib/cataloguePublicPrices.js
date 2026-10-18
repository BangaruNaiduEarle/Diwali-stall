/**
 * Admin-only catalogue list prices from static JSON (mirrors src/data/products.js prices, no x4).
 */
import pricesDoc from '../../data/catalogue-public-prices.json' with { type: 'json' }

/** @returns {Record<string, number>} */
export function getCataloguePublicPriceMap() {
  const prices = pricesDoc?.prices
  if (!prices || typeof prices !== 'object') return {}
  return /** @type {Record<string, number>} */ (prices)
}

/** @param {string} productId */
export function getCataloguePublicPriceInr(productId) {
  const map = getCataloguePublicPriceMap()
  const v = map[String(productId ?? '').trim()]
  return v === undefined ? null : v
}
