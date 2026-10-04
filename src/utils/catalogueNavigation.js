const CATEGORY_KEY = 'diwali_catalogue_category'
const BUDGET_KEY = 'diwali_catalogue_budget'

export function setPendingCatalogueFilters({ categorySlug, budgetId }) {
  if (categorySlug) {
    sessionStorage.setItem(CATEGORY_KEY, categorySlug)
  }
  if (budgetId) {
    sessionStorage.setItem(BUDGET_KEY, budgetId)
  }
}

export function consumePendingCatalogueFilters() {
  const categorySlug = sessionStorage.getItem(CATEGORY_KEY) || 'all'
  const budgetId = sessionStorage.getItem(BUDGET_KEY) || 'all'
  sessionStorage.removeItem(CATEGORY_KEY)
  sessionStorage.removeItem(BUDGET_KEY)
  return { categorySlug, budgetId }
}

export function navigateToCatalogueFilters({ categorySlug, budgetId }) {
  setPendingCatalogueFilters({ categorySlug, budgetId })
  if (window.location.hash === '#crackers') {
    window.dispatchEvent(new Event('catalogue-filter-pending'))
  }
}
