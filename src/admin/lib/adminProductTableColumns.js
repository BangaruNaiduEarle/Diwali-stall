import { canViewSensitiveProductPricing, normalizeAdminRole } from './adminRoles.js'

/** Purchase and X4 config columns (owner / super_admin only). */
/** @param {unknown} role */
export function showAdminProductSensitiveColumns(role) {
  return canViewSensitiveProductPricing(role)
}

/** Catalogue Reference column in the products table (owner only). */
/** @param {unknown} role */
export function showAdminProductCatalogueReferenceColumn(role) {
  return normalizeAdminRole(role) === 'owner'
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

/** Catalogue selling price column (all admin roles; value source differs by role). */
export function showAdminProductSellingPriceColumn() {
  return true
}
