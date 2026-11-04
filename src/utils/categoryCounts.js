import { CATALOG_CATEGORIES } from '../data/categories.js'
import { productCategorySlug } from './catalogueCategories.js'

/**
 * @param {Array<{ active?: boolean, category?: string }>} products
 */
export function getCategoryProductCounts(products) {
  const active = (products ?? []).filter((p) => p.active !== false)
  const counts = {}

  for (const product of active) {
    const slug = productCategorySlug(product)
    if (slug && slug !== 'all') counts[slug] = (counts[slug] ?? 0) + 1
  }

  return counts
}

export function isValidCategorySlug(slug, categories = CATALOG_CATEGORIES) {
  if (!slug || slug === 'all') return false
  return categories.some((c) => c.slug === slug && c.slug !== 'all')
}
