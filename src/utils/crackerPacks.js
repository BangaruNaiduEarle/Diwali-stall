import { DIWALI_CRACKER_PACKS, getCrackerPackBySlug } from '../data/crackerPacks'
import { getFamilyPackImage } from '../data/familyPackImages'
import { getProductById, isProductSoldOut } from './estimateHelpers'

export { getCrackerPackBySlug }

export function getPackCatalogueLines(pack) {
  if (!pack?.items?.length) return []
  return pack.items
    .filter((row) => row.productId)
    .map((row) => ({
      productId: row.productId,
      quantity: Math.max(1, Math.floor(Number(row.quantity) || 1)),
      source: row,
    }))
}

export function enrichPackItem(row) {
  const product = row.productId ? getProductById(row.productId) : null
  return {
    ...row,
    product,
    soldOut: product ? isProductSoldOut(product) : true,
    missingCatalogue: !product,
  }
}

export function getPackSummaryDescription(pack) {
  const types = pack.distinctItemTypes ?? pack.items?.length ?? 0
  const units = pack.totalBillUnits ?? pack.items?.reduce((s, r) => s + (Number(r.quantity) || 0), 0) ?? 0
  return `${types} product types · ${units} bill units`
}

export function getResolvedCrackerPacks() {
  return DIWALI_CRACKER_PACKS.map((pack) => ({
    ...pack,
    slug: pack.id,
    name: pack.displayName,
    description: getPackSummaryDescription(pack),
    distinctTypes: pack.distinctItemTypes,
    billUnits: pack.totalBillUnits,
    itemCount: pack.distinctItemTypes,
    image: getFamilyPackImage(pack.id),
    active: pack.items.every((row) => row.productId && getProductById(row.productId)),
  })).filter((p) => p.active)
}

export function getResolvedCrackerPackBySlug(slug) {
  const pack = getCrackerPackBySlug(slug)
  if (!pack) return null

  const items = pack.items.map(enrichPackItem)
  const missing = items.filter((row) => row.missingCatalogue)
  if (missing.length) return null

  const catalogueLines = getPackCatalogueLines(pack)

  return {
    ...pack,
    slug: pack.id,
    name: pack.displayName,
    description: getPackSummaryDescription(pack),
    items,
    catalogueLines,
    distinctTypes: pack.distinctItemTypes,
    billUnits: pack.totalBillUnits,
  }
}

/**
 * Adds each catalogue line from the pack to the estimate (catalogue unit prices).
 * Does not add a separate bundle SKU line — pack.price is the advertised bundle price only.
 */
export function applyPackToEstimate(pack, { getQuantity, setQuantity }) {
  const lines = getPackCatalogueLines(pack)
  for (const { productId, quantity } of lines) {
    const product = getProductById(productId)
    if (!product || isProductSoldOut(product)) continue
    const current = getQuantity(productId) || 0
    setQuantity(productId, current + quantity)
  }
}

export function getPackAddBlockers(pack) {
  const lines = getPackCatalogueLines(pack)
  if (!lines.length) return ['This pack has no catalogue items mapped.']
  const soldOut = lines.filter(({ productId }) => {
    const p = getProductById(productId)
    return !p || isProductSoldOut(p)
  })
  if (soldOut.length) return ['One or more items in this pack are unavailable.']
  return []
}
