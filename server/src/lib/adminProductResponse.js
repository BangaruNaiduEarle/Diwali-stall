import { canViewSensitiveProductPricing } from './adminRoles.js'

/**
 * Strip purchase-rate and Excel mapping fields for restricted admin roles.
 * @param {Record<string, unknown>} product
 * @param {unknown} role
 */
export function filterAdminProductForRole(product, role) {
  if (canViewSensitiveProductPricing(role)) return product
  const next = { ...product }
  delete next.purchaseRatePaise
  delete next.purchaseRateInr
  delete next.hasPurchaseRate
  delete next.x4SellingPricePaise
  delete next.x4SellingPriceInr
  delete next.hasX4SellingRate
  delete next.privateX4Paise
  delete next.privateX4Inr
  delete next.hasPrivateX4Rate
  delete next.pricingMapping
  delete next.finalPricePaise
  delete next.finalPriceInr
  delete next.hasFinalPrice
  return next
}

/** @param {Record<string, unknown>[]} products @param {unknown} role */
export function filterAdminProductsForRole(products, role) {
  return products.map((p) => filterAdminProductForRole(p, role))
}
