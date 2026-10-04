import { useEffect, useMemo, useState } from 'react'
import { products } from '../data/products'
import { consumePendingCatalogueFilters } from '../utils/catalogueNavigation'
import { countActiveProducts, filterProducts } from '../utils/filterProducts'
import CataloguePagination from './CataloguePagination'
import ProductFilters from './ProductFilters'
import ProductGrid from './ProductGrid'
import SectionHeading from './SectionHeading'

const PRODUCTS_PER_PAGE = 24

export default function CatalogueSection() {
  const [search, setSearch] = useState('')
  const [categorySlug, setCategorySlug] = useState('all')
  const [budgetId, setBudgetId] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    const applyPending = () => {
      if (window.location.hash !== '#crackers') return
      const pending = consumePendingCatalogueFilters()
      if (pending.categorySlug && pending.categorySlug !== 'all') {
        setCategorySlug(pending.categorySlug)
      }
      if (pending.budgetId && pending.budgetId !== 'all') {
        setBudgetId(pending.budgetId)
      }
    }

    const onPending = () => applyPending()

    applyPending()
    window.addEventListener('hashchange', applyPending)
    window.addEventListener('catalogue-filter-pending', onPending)
    return () => {
      window.removeEventListener('hashchange', applyPending)
      window.removeEventListener('catalogue-filter-pending', onPending)
    }
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, categorySlug, budgetId])

  const totalActive = countActiveProducts(products)

  const filtered = useMemo(
    () => filterProducts(products, { search, categorySlug, budgetId }),
    [search, categorySlug, budgetId],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE))

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const paginatedProducts = useMemo(
    () =>
      filtered.slice(
        (currentPage - 1) * PRODUCTS_PER_PAGE,
        currentPage * PRODUCTS_PER_PAGE,
      ),
    [filtered, currentPage],
  )

  const scrollToCatalogueTop = () => {
    document.getElementById('crackers')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  const handlePageChange = (page) => {
    setCurrentPage(page)
    scrollToCatalogueTop()
  }

  return (
    <section
      id="crackers"
      className="scroll-mt-28 bg-diwali-cream py-12 sm:py-16"
      aria-labelledby="crackers-heading"
    >
      <div className="container-page">
        <SectionHeading
          id="crackers-heading"
          eyebrow="Catalogue"
          title="Browse all crackers"
          description="Search and filter the full list. Add to My Estimate in the next phase."
        />

        <div className="mb-8 rounded-xl border border-diwali-border/80 bg-white p-4 shadow-sm sm:p-6">
          <ProductFilters
            search={search}
            onSearchChange={setSearch}
            categorySlug={categorySlug}
            onCategoryChange={setCategorySlug}
            budgetId={budgetId}
            onBudgetChange={setBudgetId}
          />
        </div>

        <p className="mb-6 text-sm text-diwali-muted" aria-live="polite">
          Showing {filtered.length === 0 ? 0 : paginatedProducts.length} of{' '}
          {filtered.length} crackers
          {filtered.length !== totalActive ? (
            <span className="text-diwali-muted/75">
              {' '}
              (from {totalActive} total)
            </span>
          ) : null}
        </p>

        <ProductGrid products={paginatedProducts} variant="light" />

        <CataloguePagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      </div>
    </section>
  )
}
