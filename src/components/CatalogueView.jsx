import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Button from './ui/Button'
import { products } from '../data/products'
import { countActiveProducts, filterProducts } from '../utils/filterProducts'
import CataloguePagination from './CataloguePagination'
import ProductFilters from './ProductFilters'
import ProductGrid from './ProductGrid'

export const PRODUCTS_PER_PAGE = 24

export default function CatalogueView({
  categorySlug = 'all',
  onCategoryChange,
  pageTitle = 'Crackers',
  pageDescription = 'The festive collection.',
  breadcrumbs = null,
  kicker = '',
}) {
  const [search, setSearch] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const budgetFromUrl = searchParams.get('budget') || 'all'
  const [budgetId, setBudgetId] = useState(budgetFromUrl)
  const [currentPage, setCurrentPage] = useState(1)
  const topRef = useRef(null)

  useEffect(() => {
    setBudgetId(budgetFromUrl)
  }, [budgetFromUrl])

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

  const handleBudgetChange = (next) => {
    setBudgetId(next)
    const params = new URLSearchParams(searchParams)
    if (!next || next === 'all') {
      params.delete('budget')
    } else {
      params.set('budget', next)
    }
    setSearchParams(params, { replace: true })
  }

  const handlePageChange = (page) => {
    setCurrentPage(page)
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const isAllCategories = !categorySlug || categorySlug === 'all'
  const searchQuery = search.trim()
  const hasActiveFilters =
    searchQuery.length > 0 || (!isAllCategories && categorySlug !== 'all') || (budgetId && budgetId !== 'all')

  const handleClearAllFilters = () => {
    setSearch('')
    handleBudgetChange('all')
    onCategoryChange?.('all')
  }

  const gridCountLabel =
    hasActiveFilters || filtered.length !== totalActive
      ? `${filtered.length} of ${totalActive} products`
      : `${totalActive} products`

  return (
    <div ref={topRef}>
      {breadcrumbs}

      {!isAllCategories ? (
        <Button to="/crackers" variant="ghost" size="sm" icon={ArrowLeft} className="mb-3 md:mb-4">
          All crackers
        </Button>
      ) : null}

      <header className="mb-3 max-w-3xl md:mb-4">
        {isAllCategories ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-maroon)]">Crackers</p>
            <h1 className="mt-1 text-xl font-semibold leading-tight tracking-tight text-[var(--color-charcoal)] sm:text-2xl md:editorial-title md:mt-2">
              {pageDescription}
            </h1>
          </>
        ) : (
          <>
            {kicker ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-maroon)]">{kicker}</p>
            ) : null}
            <h1
              className={`text-xl font-semibold leading-tight tracking-tight text-[var(--color-charcoal)] sm:text-2xl md:editorial-title ${kicker ? 'mt-1 md:mt-2' : ''}`}
            >
              {pageTitle}
            </h1>
            <p className="mt-1 text-sm text-[var(--color-muted)] md:mt-2">{pageDescription}</p>
          </>
        )}
        <p className="mt-1 text-sm text-[var(--color-muted)]">{`${totalActive} products`}</p>
      </header>

      <ProductFilters
        search={search}
        onSearchChange={setSearch}
        categorySlug={categorySlug}
        onCategoryChange={onCategoryChange}
        budgetId={budgetId}
        onBudgetChange={handleBudgetChange}
        onClearAll={handleClearAllFilters}
        hasActiveFilters={hasActiveFilters}
      />

      <div className="mt-2.5 md:mt-4">
        {searchQuery ? (
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 md:mb-3">
            <p className="text-sm text-[var(--color-charcoal)]" aria-live="polite">
              Showing {filtered.length} {filtered.length === 1 ? 'result' : 'results'} for &quot;{searchQuery}&quot;
            </p>
            {hasActiveFilters ? (
              <button
                type="button"
                className="focus-ring text-xs font-medium text-[var(--color-brand)] underline-offset-2 hover:underline md:text-sm"
                onClick={handleClearAllFilters}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : hasActiveFilters || filtered.length !== totalActive ? (
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 md:mb-3">
            <p className="text-xs font-medium text-[var(--color-muted)] md:text-sm">{gridCountLabel}</p>
            {hasActiveFilters ? (
              <button
                type="button"
                className="focus-ring text-xs font-medium text-[var(--color-brand)] underline-offset-2 hover:underline md:text-sm"
                onClick={handleClearAllFilters}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}

        <ProductGrid
          products={paginatedProducts}
          variant="light"
          emptyMessage="Try another product name or clear your filters."
          emptyAction={
            hasActiveFilters ? (
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <Button type="button" variant="secondary" onClick={handleClearAllFilters}>
                  Clear filters
                </Button>
                <Button to="/crackers" variant="ghost">
                  View all crackers
                </Button>
              </div>
            ) : (
              <Button to="/crackers" variant="secondary">
                View all crackers
              </Button>
            )
          }
        />

        <CataloguePagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
      </div>
    </div>
  )
}
