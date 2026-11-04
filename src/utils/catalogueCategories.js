import { CATALOG_CATEGORIES } from '../data/categories.js'

/** API slugs are authoritative; labels are presentation, not category identity. */
export function productCategorySlug(product) {
  return String(product.categorySlug ?? '').trim() || CATALOG_CATEGORIES.find(category => category.label === product.category)?.slug || ''
}

export function buildCatalogueCategories(products) {
  const categories = new Map()
  for (const product of products ?? []) {
    if (product.active === false) continue
    const slug = productCategorySlug(product)
    if (!slug || slug === 'all' || categories.has(slug)) continue
    categories.set(slug, { slug, label: String(product.category ?? '').trim() || slug })
  }
  const rank = slug => {
    const index = CATALOG_CATEGORIES.findIndex(category => category.slug === slug)
    return index < 0 ? CATALOG_CATEGORIES.length : index
  }
  return [{ slug: 'all', label: 'All' }, ...[...categories.values()].sort((a, b) => rank(a.slug) - rank(b.slug) || a.label.localeCompare(b.label))]
}
