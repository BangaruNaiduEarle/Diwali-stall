/**
 * Catalogue category labels — shared by homepage cards and Phase 3 filters.
 */
export const CATALOG_CATEGORIES = [
  { slug: 'all', label: 'All' },
  { slug: 'gift-boxes', label: 'Gift Boxes' },
  { slug: 'sparklers', label: 'Sparklers' },
  { slug: 'flower-pots-fountains', label: 'Flower Pots & Fountains' },
  { slug: 'chakkars-wheels', label: 'Chakkars & Wheels' },
  { slug: 'bombs', label: 'Bombs' },
  { slug: 'bijili', label: 'Bijili' },
  { slug: 'rockets-shots', label: 'Rockets & Shots' },
  { slug: 'fancy-multi-shots', label: 'Fancy / Multi-Shots' },
  { slug: 'novelty', label: 'Novelty' },
  { slug: 'others', label: 'Others' },
]

/** Category value stored on products (exclude "All") */
export const PRODUCT_CATEGORY_LABELS = CATALOG_CATEGORIES.filter(
  (c) => c.slug !== 'all',
).map((c) => c.label)
