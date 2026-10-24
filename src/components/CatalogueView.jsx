import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Button from './ui/Button'
import CatalogueProductsGate from './catalogue/CatalogueProductsGate'
import { useCatalogueProducts } from '../context/CatalogueProductsContext'
import { countActiveProducts, filterProducts } from '../utils/filterProducts'
import CataloguePagination from './CataloguePagination'
import ProductFilters from './ProductFilters'
import ComplimentaryGiftPromo from './promo/ComplimentaryGiftPromo'
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
  const [currentPage, setCurrentPage] = useState(1)
  const topRef = useRef(null)
  const { products, loading, error, refresh } = useCatalogueProducts()

  useEffect(() => {
    if (!searchParams.has('budget')) return
    const params = new URLSearchParams(searchParams)
    params.delete('budget')
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, categorySlug])

  const totalActive = countActiveProducts(products)

  const filtered = useMemo(
    () => filterProducts(products, { search, categorySlug }),
    [products, search, categorySlug],
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

  const handlePageChange = (page) => {
    setCurrentPage(page)
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const isAllCategories = !categorySlug || categorySlug === 'all'
  const searchQuery = search.trim()
  const hasActiveFilters = searchQuery.length > 0 || (!isAllCategories && categorySlug !== 'all')

  const handleClearAllFilters = () => {
    setSearch('')
    onCategoryChange?.('all')
  }

  const gridCountLabel =
    hasActiveFilters || filtered.length !== totalActive
      ? `${filtered.length} of ${totalActive} products`
      : `${totalActive} products`

  return (
    <CatalogueProductsGate loading={loading} error={error} onRetry={refresh}>
    <div ref={topRef}>
      {breadcrumbs}

      {!isAllCategories ? (
        <Button to="/crackers" variant="ghost" size="sm" icon={ArrowLeft} className="mb-1.5 md:mb-2">
          All crackers
        </Button>
      ) : null}

      <header className="catalogue-view__header mb-2 max-w-4xl md:mb-1.5">
        {isAllCategories ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-maroon)]">Crackers</p>
            <div className="mt-0.5 md:flex md:flex-wrap md:items-baseline md:gap-x-3">
              <h1 className="text-xl font-semibold leading-tight tracking-tight text-[var(--color-charcoal)] sm:text-2xl md:editorial-title">
                {pageDescription}
              </h1>
              <p className="mt-0.5 text-sm leading-snug text-[var(--color-muted)] md:mt-0">{`${totalActive} products`}</p>
            </div>
          </>
        ) : (
          <>
            {kicker ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-maroon)]">{kicker}</p>
            ) : null}
            <div
              className={`md:flex md:flex-wrap md:items-baseline md:gap-x-3 ${kicker ? 'mt-0.5' : ''}`}
            >
              <h1 className="text-xl font-semibold leading-tight tracking-tight text-[var(--color-charcoal)] sm:text-2xl md:editorial-title">
                {pageTitle}
              </h1>
              <p className="mt-0.5 text-sm leading-snug text-[var(--color-muted)] md:mt-0">
                {pageDescription} · {totalActive} products
              </p>
            </div>
          </>
        )}
      </header>

      <ComplimentaryGiftPromo variant="strip" className="catalogue-gift-promo mb-2.5 md:hidden" />

      <div className="catalogue-view__toolbar mb-2 md:mb-3 md:grid md:grid-cols-[minmax(0,1fr)_min(15rem,17.5rem)] md:items-start md:gap-5 lg:gap-6">
        <ProductFilters
          search={search}
          onSearchChange={setSearch}
          categorySlug={categorySlug}
          onCategoryChange={onCategoryChange}
          onClearAll={handleClearAllFilters}
          hasActiveFilters={hasActiveFilters}
          catalogueRouteLayout
        />
        <ComplimentaryGiftPromo variant="aside" className="hidden w-full md:block md:justify-self-end" />
      </div>

      <div className="catalogue-view__grid mt-2 md:mt-3">
        {searchQuery ? (
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 md:mb-2">
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
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 md:mb-2">
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
    </CatalogueProductsGate>
  )
}
