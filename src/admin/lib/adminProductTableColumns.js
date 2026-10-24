import { canViewSensitiveProductPricing, normalizeAdminRole } from './adminRoles.js'

/** Purchase rate and selling price form fields (owner / super_admin only). */
/** @param {unknown} role */
export function showAdminProductSensitiveColumns(role) {
  return canViewSensitiveProductPricing(role)
}

/** Unit / pack column (owner / super_admin only). */
/** @param {unknown} role */
export function showAdminProductUnitColumn(role) {
  return canViewSensitiveProductPricing(role)
}

/** Excel pricing mapping column (owner / super_admin only). */
/** @param {unknown} role */
export function showAdminProductMappingColumn(role) {
  return canViewSensitiveProductPricing(role)
}

/** D1 selling price column (all admin roles; always `products.selling_price_paise`). */
export function showAdminProductSellingPriceColumn() {
  return true
}
