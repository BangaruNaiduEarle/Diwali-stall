export function cataloguePath(categorySlug, budgetId) {
  const base =
    !categorySlug || categorySlug === 'all'
      ? '/crackers'
      : `/crackers/${categorySlug}`
  if (!budgetId || budgetId === 'all') return base
  return `${base}?budget=${encodeURIComponent(budgetId)}`
}
