/**
 * Explicit pack id → hero image for Family Pack cards.
 * Replace files under public/images/family-packs/{id}.webp to update photos.
 */
export const FAMILY_PACK_IMAGE_BY_ID = {
  'pocket-budget': '/images/family-packs/pocket-budget.webp',
  'budget-mix': '/images/family-packs/budget-mix.webp',
  'budget-family': '/images/family-packs/budget-family.webp',
  'mini-starter': '/images/family-packs/mini-starter.webp',
  'mini-family': '/images/family-packs/mini-family.jpg',
  'happy-family': '/images/family-packs/happy-family.webp',
  'premium-family': '/images/family-packs/premium-family.webp',
}

export function getFamilyPackImage(packId) {
  return FAMILY_PACK_IMAGE_BY_ID[packId] ?? ''
}
