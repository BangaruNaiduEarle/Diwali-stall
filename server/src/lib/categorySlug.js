/**
 * Category label ↔ slug (aligned with src/data/categories.js).
 */

/** @type {ReadonlyMap<string, string>} label → slug */
const LABEL_TO_SLUG = new Map([
  ['Gift Boxes', 'gift-boxes'],
  ['Sparklers', 'sparklers'],
  ['Flower Pots & Fountains', 'flower-pots-fountains'],
  ['Chakkars & Wheels', 'chakkars-wheels'],
  ['Bombs', 'bombs'],
  ['Bijili', 'bijili'],
  ['Rockets & Shots', 'rockets-shots'],
  ['Fancy / Multi-Shots', 'fancy-multi-shots'],
  ['Novelty', 'novelty'],
  ['Others', 'others'],
])

/** @type {ReadonlyMap<string, string>} slug → label */
const SLUG_TO_LABEL = new Map([...LABEL_TO_SLUG.entries()].map(([label, slug]) => [slug, label]))

/** @param {string} label */
export function categoryLabelToSlug(label) {
  const key = String(label ?? '').trim()
  return LABEL_TO_SLUG.get(key) ?? null
}

/** @param {string} slug */
export function categorySlugToLabel(slug) {
  return SLUG_TO_LABEL.get(String(slug ?? '').trim()) ?? null
}

export function listKnownCategorySlugs() {
  return [...SLUG_TO_LABEL.keys()]
}
