import familyPacksData from './familyPacks.json'

export const DIWALI_CRACKER_PACKS = familyPacksData.packs.map((pack) => ({
  ...pack,
  slug: pack.id,
}))

export function getCrackerPackBySlug(slug) {
  return DIWALI_CRACKER_PACKS.find((p) => p.slug === slug || p.id === slug) ?? null
}
