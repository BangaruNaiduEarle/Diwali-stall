/**
 * Maps admin product form Selling Price to D1 `products.selling_price_paise` (via API `sellingPriceInr`).
 * @param {{ sellingPriceInr?: string | number | null }} values
 * @returns {number | null | undefined} `undefined` when the form has no selling field; `null` when cleared
 */
export function sellingPriceInrForProductWrite(values) {
  if (!('sellingPriceInr' in values)) return undefined
  const raw = values.sellingPriceInr
  if (raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}
