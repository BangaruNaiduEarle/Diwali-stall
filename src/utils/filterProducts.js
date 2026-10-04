import { CATALOG_CATEGORIES } from '../data/categories'
import { productMatchesBudget } from '../data/budgetRanges'

export function getCategoryLabelFromSlug(slug) {
  if (!slug || slug === 'all') return null
  return CATALOG_CATEGORIES.find((c) => c.slug === slug)?.label ?? null
}

export function filterProducts(
  products,
  { search = '', categorySlug = 'all', budgetId = 'all' } = {},
) {
  let list = products.filter((p) => p.active !== false)

  const categoryLabel = getCategoryLabelFromSlug(categorySlug)
  if (categoryLabel) {
    list = list.filter((p) => p.category === categoryLabel)
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
