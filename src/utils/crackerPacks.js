import {
  getFamilyPackBySlug as getCataloguePackBySlug,
  listFamilyPacksFromCatalogue,
  mapPublicPackForCard,
} from './familyPackCatalogue.js'
import {
  buildFamilyPackEstimateSnapshot,
  isFamilyPackEstimateItem,
} from './estimateHelpers.js'
import { isFamilyPackAvailableForEstimate } from './familyPackCatalogue.js'

export function getResolvedCrackerPacks() {
  return listFamilyPacksFromCatalogue().map(mapPublicPackForCard)
}

export function getResolvedCrackerPackBySlug(slug) {
  const pack = getCataloguePackBySlug(slug)
  if (!pack) return null
  return {
    id: String(pack.id),
    slug: String(pack.slug),
    displayName: String(pack.name),
    name: String(pack.name),
    description: String(pack.shortDescription ?? ''),
    price: Number(pack.sellingPriceInr ?? 0),
    sellingPriceInr: Number(pack.sellingPriceInr ?? 0),
    sellingPricePaise: Number(pack.sellingPricePaise ?? 0),
    packLabel: pack.packLabel ? String(pack.packLabel) : null,
    image: String(pack.coverImageUrl ?? ''),
    images: (pack.images ?? []).map((img) => String(img.url ?? img)),
    items: (pack.items ?? []).map((row) => ({
      productId: row.productId,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
    })),
  }
}

export function getCrackerPackBySlug(slug) {
  return getResolvedCrackerPackBySlug(slug)
}

export function applyPackToEstimate(pack, { addFamilyPackToEstimate }) {
  if (!pack?.id || !addFamilyPackToEstimate) return
  addFamilyPackToEstimate(String(pack.id))
}

export function getPackAddBlockers(pack) {
  if (!pack?.id) return ['This pack is unavailable.']
  if (!isFamilyPackAvailableForEstimate(String(pack.id))) {
    return ['This family pack is no longer available.']
  }
  const snapshot = buildFamilyPackEstimateSnapshot(String(pack.id))
  if (!snapshot) return ['This pack cannot be added to your estimate right now.']
  return []
}

export { isFamilyPackEstimateItem }
