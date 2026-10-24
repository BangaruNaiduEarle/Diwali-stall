/**
 * Customer-facing unit label from catalogue product records (UI display only).
 * Reads existing fields only — no defaults or invented labels.
 *
 * @param {Record<string, unknown> | null | undefined} product
 */
export function getProductUnitLabel(product) {
  if (!product || typeof product !== 'object') return ''
  const raw = product.unit_label ?? product.unitLabel ?? product.pack ?? ''
  return String(raw).trim()
}

/**
 * History rows may store a unit snapshot; otherwise resolve from the live product.
 *
 * @param {string | null | undefined} storedUnit
 * @param {Record<string, unknown> | null | undefined} product
 */
export function resolveEstimateLineUnitLabel(storedUnit, product) {
  const stored = String(storedUnit ?? '').trim()
  if (stored) return stored
  return getProductUnitLabel(product)
}
