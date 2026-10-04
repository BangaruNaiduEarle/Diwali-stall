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
  const hasActiveFilters =
    search.trim().length > 0 || (!isAllCategories && categorySlug !== 'all') || (budgetId && budgetId !== 'all')

  const handleClearAllFilters = () => {
    setSearch('')
    handleBudgetChange('all')
    onCategoryChange?.('all')
  }

  return (
    <div ref={topRef}>
      {breadcrumbs}
      {!isAllCategories ? (
        <Button to="/crackers" variant="ghost" size="sm" icon={ArrowLeft} className="mb-6">
          All crackers
        </Button>
      ) : null}

      <header className="mb-6 max-w-3xl md:mb-10">
        {isAllCategories ? (
          <>
            <p className="editorial-label-festive">Crackers</p>
            <h1 className="editorial-title mt-2">{pageDescription}</h1>
          </>
        ) : (
          <>
            {kicker ? <p className="editorial-label-festive">{kicker}</p> : null}
            <h1 className={`editorial-title ${kicker ? 'mt-2' : ''}`}>{pageTitle}</h1>
            <p className="editorial-lead mt-4">{pageDescription}</p>
          </>
        )}
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
          {isAllCategories ? (
            <span className="text-[var(--color-muted)]/80"> · {totalActive} in catalogue</span>
          ) : null}
        </p>
      </header>

      <div className="mb-6 hairline-b pb-5 md:mb-8 md:pb-6">
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
      </div>

      <p className="mb-6 text-sm text-[var(--color-muted)] md:mb-8" aria-live="polite">
        Showing {filtered.length === 0 ? 0 : paginatedProducts.length} of {filtered.length}
        {filtered.length !== totalActive ? (
          <span className="text-[var(--color-muted)]/75"> (from {totalActive} total)</span>
        ) : null}
      </p>

      <ProductGrid
        products={paginatedProducts}
        variant="light"
        emptyMessage={
          hasActiveFilters
            ? 'Try another search or clear your filters.'
            : 'No products are available in this view right now.'
        }
        emptyAction={
          hasActiveFilters ? (
            <Button type="button" variant="secondary" onClick={handleClearAllFilters}>
              Clear filters
            </Button>
          ) : (
            <Button to="/crackers" variant="secondary">
              View all crackers
            </Button>
          )
        }
      />

      <CataloguePagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
      />
    </div>
  )
}
