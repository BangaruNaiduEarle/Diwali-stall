import { canViewSensitiveProductPricing } from './adminRoles.js'

/**
 * Strip purchase-rate and Excel mapping fields for restricted admin roles.
 * @param {Record<string, unknown>} product
 * @param {unknown} role
 * @param {boolean} canViewFinalRate Trusted current stall capability, never client input.
 */
export function filterAdminProductForRole(product, role, canViewFinalRate = false) {
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
  if (canViewFinalRate !== true) {
    delete next.finalPricePaise
    delete next.finalPriceInr
    delete next.hasFinalPrice
  }
  return next
}

/** @param {Record<string, unknown>[]} products @param {unknown} role @param {boolean} canViewFinalRate */
export function filterAdminProductsForRole(products, role, canViewFinalRate = false) {
  return products.map((p) => filterAdminProductForRole(p, role, canViewFinalRate))
}
