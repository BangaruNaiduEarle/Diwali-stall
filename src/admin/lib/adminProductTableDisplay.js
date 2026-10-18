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

/**
 * @param {unknown} images
 * @returns {string | null}
 */
export function firstAdminProductImagePath(images) {
  if (!Array.isArray(images) || !images.length) return null
  const first = images[0]
  if (typeof first !== 'string' || !first.trim()) return null
  return first.trim()
}
