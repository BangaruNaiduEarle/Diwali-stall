/** @type {Map<string, Record<string, unknown>>} */
let packById = new Map()
/** @type {Map<string, Record<string, unknown>>} */
let packBySlug = new Map()

/**
 * @param {Array<Record<string, unknown>>} packs
 */
export function setFamilyPackCatalogue(packs) {
  packById = new Map()
  packBySlug = new Map()
  for (const pack of packs ?? []) {
    const id = String(pack.id ?? '').trim()
    const slug = String(pack.slug ?? '').trim()
    if (id) packById.set(id, pack)
    if (slug) packBySlug.set(slug, pack)
  }
}

/** @param {string} id */
export function getFamilyPackById(id) {
  return packById.get(String(id ?? '').trim()) ?? null
}

/** @param {string} slug */
export function getFamilyPackBySlug(slug) {
  return packBySlug.get(String(slug ?? '').trim()) ?? null
}

export function listFamilyPacksFromCatalogue() {
  return [...packById.values()].sort(
    (a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.id).localeCompare(String(b.id)),
  )
}

/**
 * @param {Record<string, unknown>} pack
 */
export function mapPublicPackForCard(pack) {
  return {
    id: String(pack.id),
    slug: String(pack.slug),
    name: String(pack.name),
    description: String(pack.shortDescription ?? ''),
    price: Number(pack.sellingPriceInr ?? 0),
    sellingPriceInr: Number(pack.sellingPriceInr ?? 0),
    sellingPricePaise: Number(pack.sellingPricePaise ?? 0),
    packLabel: pack.packLabel ? String(pack.packLabel) : null,
    image: String(pack.coverImageUrl ?? pack.images?.[0]?.url ?? ''),
    images: Array.isArray(pack.images) ? pack.images : [],
  }
}

/**
 * Active packs available for new estimates (catalogue must be loaded from public API).
 * @param {string} familyPackId
 */
export function isFamilyPackAvailableForEstimate(familyPackId) {
  const pack = getFamilyPackById(familyPackId)
  return Boolean(pack)
}
