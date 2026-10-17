import { CATALOG_CATEGORIES } from '../data/categories'

/**
 * @param {Array<{ active?: boolean, category?: string }>} products
 */
export function getCategoryProductCounts(products) {
  const active = (products ?? []).filter((p) => p.active !== false)
  const counts = {}

  for (const { slug, label } of CATALOG_CATEGORIES) {
    if (slug === 'all') continue
    counts[slug] = active.filter((p) => p.category === label).length
  }

  return counts
}

export function isValidCategorySlug(slug) {
  if (!slug || slug === 'all') return false
  return CATALOG_CATEGORIES.some((c) => c.slug === slug && c.slug !== 'all')
}
