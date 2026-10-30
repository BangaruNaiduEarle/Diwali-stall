/**
 * Pure helpers for admin products table (no React).
 */

/**
 * @param {unknown} company
 * @returns {string}
 */
export function formatAdminProductCompany(company) {
  if (company === null || company === undefined || company === '') return '—'
  const s = String(company).trim()
  return s || '—'
}

/**
 * @param {unknown} pack
 * @returns {string}
 */
export function formatAdminProductPack(pack) {
  if (pack === null || pack === undefined || pack === '') return '—'
  const s = String(pack).trim()
  return s || '—'
}

/** @param {unknown} piecesPerPack */
export function formatAdminProductPiecesPerPack(piecesPerPack) {
  if (piecesPerPack === null || piecesPerPack === undefined || piecesPerPack === '') return '—'
  const n = Number(piecesPerPack)
  if (!Number.isInteger(n) || n <= 0) return '—'
  return String(n)
}

/**
 * @param {unknown} images
 * @returns {string | null}
 */
/**
 * Normal catalogue selling price for the products list (D1 products.selling_price_paise → sellingPriceInr).
 * Same value for every admin role; never substitutes X4/private rates.
 * @param {Record<string, unknown>} product
 * @returns {{ kind: 'value' | 'missing', inr: number | null }}
 */
export function adminProductListSellingPriceView(product) {
  const inrRaw = product.sellingPriceInr
  const inr = inrRaw === null || inrRaw === undefined || inrRaw === '' ? null : Number(inrRaw)
  if (Number.isFinite(inr)) return { kind: 'value', inr }
  return { kind: 'missing', inr: null }
}

export function firstAdminProductImagePath(images) {
  if (!Array.isArray(images) || !images.length) return null
  const first = images[0]
  if (typeof first !== 'string' || !first.trim()) return null
  return first.trim()
}
