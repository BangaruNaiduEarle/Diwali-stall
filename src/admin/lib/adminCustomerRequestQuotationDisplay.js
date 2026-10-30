/** @param {unknown} name */
export function productNameIsLoosePiece(name) {
  return /\(\s*loose\s*pc\s*\)/i.test(String(name ?? ''))
}

/** @param {unknown} name */
export function quotationLineDisplayProductName(name) {
  return String(name ?? '')
    .replace(/\s*\(\s*loose\s*pc\s*\)\s*$/i, '')
    .trim()
}

/** @param {unknown} unitType @param {unknown} productName @returns {'box' | 'piece'} */
export function resolveQuotationLineUnitType(unitType, productName) {
  if (unitType === 'piece') return 'piece'
  if (unitType === 'box') return 'box'
  return productNameIsLoosePiece(productName) ? 'piece' : 'box'
}

/** @param {unknown} unitType @param {unknown} quantity @param {unknown} [productName] */
export function quotationLineQuantityLabel(unitType, quantity, productName) {
  if (unitType === 'piece') {
    return `${String(quantity)} loose pc`
  }
  if (unitType === 'box') {
    const q = Number(quantity)
    return `${String(quantity)} box${q === 1 ? '' : 'es'}`
  }
  const name = String(productName ?? '')
  if (productNameIsLoosePiece(name)) {
    return `${String(quantity)} loose pc`
  }
  const q = Number(quantity)
  return `${String(quantity)} box${q === 1 ? '' : 'es'}`
}

/**
 * @param {unknown[]} quoteLines
 * @param {unknown[]} internalItems
 */
export function mergeQuotationLinesWithInternal(quoteLines, internalItems) {
  /** @type {Map<number, Record<string, unknown>>} */
  const byLine = new Map()
  for (const raw of internalItems) {
    if (!raw || typeof raw !== 'object') continue
    const row = /** @type {Record<string, unknown>} */ (raw)
    const ln = Number(row.lineNumber)
    if (Number.isInteger(ln)) byLine.set(ln, row)
  }

  if (quoteLines.length) {
    return quoteLines.map((raw) => {
      const quote = /** @type {Record<string, unknown>} */ (raw)
      const ln = Number(quote.lineNumber)
      const internal = Number.isInteger(ln) ? byLine.get(ln) ?? null : null
      return { quote, internal }
    })
  }

  return internalItems.map((raw) => ({
    quote: null,
    internal: /** @type {Record<string, unknown>} */ (raw),
  }))
}

/** @param {unknown[]} internalItems */
export function sumInternalLinePaise(internalItems, key) {
  let sum = 0
  let any = false
  for (const raw of internalItems) {
    if (!raw || typeof raw !== 'object') continue
    const p = Number(/** @type {Record<string, unknown>} */ (raw)[key])
    if (Number.isInteger(p) && p >= 0) {
      sum += p
      any = true
    }
  }
  return any ? sum : null
}
