/** @param {unknown} value */
export function compactQuickBillSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
}

/**
 * Quick Bill product search — case/space insensitive; multi-word any order on name + company.
 *
 * @param {unknown} query
 * @param {unknown} name
 * @param {unknown} company
 * @param {unknown} productId
 */
export function productMatchesQuickBillSearch(query, name, company, productId) {
  const q = String(query ?? '').trim()
  if (!q) return true

  if (/^P\d+$/i.test(q)) {
    const id = String(productId ?? '').toUpperCase()
    return id.startsWith(q.toUpperCase())
  }

  const hayName = compactQuickBillSearchText(name)
  const hayCompany = compactQuickBillSearchText(company)
  const hayCombined = `${hayName}${hayCompany}`

  const compactQuery = compactQuickBillSearchText(q)
  if (compactQuery.length > 0 && hayCombined.includes(compactQuery)) {
    return true
  }

  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/\s+/g, ''))
    .filter(Boolean)

  if (tokens.length < 2) return false

  return tokens.every((token) => hayCombined.includes(token))
}

/**
 * @param {unknown[]} products
 * @param {unknown} query
 */
export function filterProductsForQuickBillSearch(products, query) {
  const q = String(query ?? '').trim()
  if (!q) return products
  const seen = new Set()
  /** @type {unknown[]} */
  const out = []
  for (const raw of products) {
    if (!raw || typeof raw !== 'object') continue
    const p = /** @type {Record<string, unknown>} */ (raw)
    const id = String(p.id ?? '')
    if (!id || seen.has(id)) continue
    if (!productMatchesQuickBillSearch(q, p.name, p.company, id)) continue
    seen.add(id)
    out.push(raw)
  }
  return out
}
