/** @param {unknown} company @returns {string | null} */
export function normalizedProductCompany(company) {
  if (company === null || company === undefined) return null
  const s = String(company).trim()
  return s.length ? s : null
}
