import { CATALOG_CATEGORIES } from '../data/categories.js'
import { productMatchesBudget } from '../data/budgetRanges.js'
import { productCategorySlug } from './catalogueCategories.js'

export function getCategoryLabelFromSlug(slug, categories = CATALOG_CATEGORIES) {
  if (!slug || slug === 'all') return null
  return categories.find((c) => c.slug === slug)?.label ?? null
}

export function filterProducts(
  products,
  { search = '', categorySlug = 'all', budgetId = 'all' } = {},
) {
  let list = products.filter((p) => p.active !== false)

  if (categorySlug && categorySlug !== 'all') {
    list = list.filter((p) => productCategorySlug(p) === categorySlug)
  }

  if (budgetId && budgetId !== 'all') {
    list = list.filter((p) => productMatchesBudget(p.price, budgetId))
  }

  const query = search.trim().toLowerCase()
  if (query) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query),
    )
  }

  return list
}

export function countActiveProducts(products) {
  return products.filter((p) => p.active !== false).length
}
