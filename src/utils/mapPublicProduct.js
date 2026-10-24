/**
 * Map Worker public product JSON to the storefront catalogue shape.
 * Public API must not expose prices or rate fields — strip if ever present.
 */

/** @param {unknown} raw */
export function mapPublicProductFromApi(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)

  const id = String(o.id ?? '').trim()
  if (!id) return null

  const images = Array.isArray(o.images) ? o.images.map((img) => String(img).trim()).filter(Boolean) : []

  const categoryLabel = String(o.categoryLabel ?? o.category ?? '').trim()
  const categorySlug = String(o.categorySlug ?? o.category_slug ?? '').trim()

  let stockStatus = String(o.stockStatus ?? o.stock_status ?? 'available').trim()
  if (!stockStatus) stockStatus = 'available'

  const sellingPricePaiseRaw = o.sellingPricePaise ?? o.selling_price_paise
  let price
  if (sellingPricePaiseRaw !== null && sellingPricePaiseRaw !== undefined && sellingPricePaiseRaw !== '') {
    const paise = Number(sellingPricePaiseRaw)
    if (Number.isInteger(paise) && paise >= 0) {
      price = paise / 100
    }
  }

  return {
    id,
    name: String(o.name ?? '').trim(),
    category: categoryLabel,
    categorySlug,
    pack: String(o.pack ?? '').trim(),
    description: String(o.description ?? '').trim(),
    featured: Boolean(o.featured),
    stockStatus,
    active: true,
    sortOrder: Number(o.sortOrder ?? o.sort_order) || 0,
    images,
    ...(price !== undefined ? { price } : {}),
  }
}

/**
 * @param {unknown[]} apiProducts
 * @returns {ReturnType<typeof mapPublicProductFromApi>[]}
 */
export function mapAndSortPublicProducts(apiProducts) {
  const mapped = (apiProducts ?? [])
    .map(mapPublicProductFromApi)
    .filter((p) => p != null)
  mapped.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.id.localeCompare(b.id)
  })
  return mapped
}

/** Ensure mapped catalogue rows never carry private rate fields (D1 selling `price` INR is allowed). */
export function assertNoPublicRateFields(product) {
  if (!product || typeof product !== 'object') return true
  const forbidden = [
    'x4',
    'sellingPriceInr',
    'sellingPricePaise',
    'x4SellingPriceInr',
    'purchaseRateInr',
    'privateX4Inr',
    'unit_rate_paise',
  ]
  return forbidden.every((key) => !(key in /** @type {object} */ (product)))
}
