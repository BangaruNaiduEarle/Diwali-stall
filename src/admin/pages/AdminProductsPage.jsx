import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, PackageOpen, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { formatINR } from '../../utils/currency.js'
import { fetchAdminCategories, fetchAdminProductsPage } from '../api/adminApi.js'
import AdminProductCard from '../components/AdminProductCard.jsx'
import AdminProductTableThumb from '../components/AdminProductTableThumb.jsx'
import { formatAdminProductCompany, formatAdminProductPack } from '../lib/adminProductTableDisplay.js'

/** @param {{ active?: boolean }} props */
function StatusBadge({ active = true }) {
  return (
    <span className={`admin-badge${active ? '' : ' admin-badge--muted'}`}>
      {active ? 'Active' : 'Archived'}
    </span>
  )
}

function formatOptionalInr(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return formatINR(n)
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [categorySlug, setCategorySlug] = useState('')
  const [missingRateOnly, setMissingRateOnly] = useState(false)
  const [missingPurchaseRateOnly, setMissingPurchaseRateOnly] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [categories, setCategories] = useState(/** @type {{ slug: string, label: string }[]} */ ([]))
  const [page, setPage] = useState(1)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
  }, [debouncedQ, categorySlug, missingRateOnly, missingPurchaseRateOnly, includeArchived])

  useEffect(() => {
    fetchAdminCategories().then((res) => {
      if (!res.ok) return
      const mapped = res.categories
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          slug: String(/** @type {Record<string, unknown>} */ (c).slug ?? ''),
          label: String(/** @type {Record<string, unknown>} */ (c).label ?? ''),
        }))
        .filter((c) => c.slug)
      setCategories(mapped)
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchAdminProductsPage({
      page,
      q: debouncedQ || undefined,
      categorySlug: categorySlug || undefined,
      missingRateOnly,
      missingPurchaseRateOnly,
      includeArchived,
    })
    if (!result.ok) {
      setProducts([])
      setError(result.message)
      setLoading(false)
      return
    }
    setProducts(result.products)
    setPagination(result.pagination)
    setLoading(false)
  }, [page, debouncedQ, categorySlug, missingRateOnly, missingPurchaseRateOnly, includeArchived])

  useEffect(() => {
    load()
  }, [load])

  const pageLabel = useMemo(() => {
    if (pagination.totalPages <= 1) return null
    return `Page ${pagination.page} of ${pagination.totalPages}`
  }, [pagination])

  const activeFilterCount = useMemo(
    () => [missingRateOnly, missingPurchaseRateOnly, includeArchived].filter(Boolean).length,
    [missingRateOnly, missingPurchaseRateOnly, includeArchived],
  )

  const resultsSummary = useMemo(() => {
    const totalPart = `${pagination.total} product${pagination.total === 1 ? '' : 's'}`
    return pageLabel ? `${totalPart} · ${pageLabel}` : totalPart
  }, [pagination.total, pageLabel])

  const mobileFiltersPanelId = 'admin-products-mobile-filters'

  return (
    <div className="admin-page admin-page--products">
      <div className="admin-page__head admin-page__head--products">
        <div className="admin-page__head-text">
          <h2 className="admin-page__title">Products</h2>
          <p className="admin-page__subtitle admin-page__subtitle--compact">
            Manage purchase rates and X4 selling prices.
          </p>
        </div>
        <Button
          to="/admin/products/new"
          variant="primary"
          surface="light"
          className="admin-page__new-product-btn"
          icon={Plus}
        >
          New product
        </Button>
      </div>

      <div className="admin-toolbar admin-toolbar--stack admin-products-toolbar">
        <label className="admin-search admin-products-toolbar__search">
          <Search className="admin-search__icon" size={18} strokeWidth={1.75} aria-hidden="true" />
          <input
            type="search"
            className="admin-input admin-search__input"
            placeholder="Search by name or product ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="admin-products-toolbar__row">
          <div className="admin-products-toolbar__category-wrap">
            <select
              className="admin-input admin-products-toolbar__category"
              value={categorySlug}
              onChange={(e) => setCategorySlug(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-products-toolbar__desktop-filters admin-show-desktop">
            <label className="admin-check admin-check--inline">
              <input type="checkbox" checked={missingRateOnly} onChange={(e) => setMissingRateOnly(e.target.checked)} />
              Missing X4 selling
            </label>
            <label className="admin-check admin-check--inline">
              <input
                type="checkbox"
                checked={missingPurchaseRateOnly}
                onChange={(e) => setMissingPurchaseRateOnly(e.target.checked)}
              />
              Missing purchase rate
            </label>
            <label className="admin-check admin-check--inline">
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
              Show archived
            </label>
            <button type="button" className="admin-link-button" onClick={load} disabled={loading}>
              Refresh
            </button>
          </div>
          <button
            type="button"
            className={`admin-products-filters-toggle admin-show-mobile${activeFilterCount > 0 ? ' admin-products-filters-toggle--active' : ''}`}
            aria-expanded={mobileFiltersOpen}
            aria-controls={mobileFiltersPanelId}
            aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
            onClick={() => setMobileFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span className="admin-products-filters-toggle__label">Filters</span>
            {activeFilterCount > 0 ? (
              <span className="admin-products-filters-toggle__count" aria-hidden="true">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className="admin-products-refresh-btn admin-show-mobile"
            onClick={load}
            disabled={loading}
            aria-label="Refresh products"
            title="Refresh products"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          </button>
        </div>
        <div
          id={mobileFiltersPanelId}
          className={`admin-products-filters-panel admin-show-mobile${mobileFiltersOpen ? ' admin-products-filters-panel--open' : ''}`}
          hidden={!mobileFiltersOpen}
        >
          <label className="admin-check">
            <input type="checkbox" checked={missingRateOnly} onChange={(e) => setMissingRateOnly(e.target.checked)} />
            Missing X4 selling
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={missingPurchaseRateOnly}
              onChange={(e) => setMissingPurchaseRateOnly(e.target.checked)}
            />
            Missing purchase rate
          </label>
          <label className="admin-check">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
      </div>

      {loading ? (
        <div className="admin-state" aria-live="polite">
          <Loader2 className="admin-state__icon animate-spin" aria-hidden="true" />
          <p>Loading products…</p>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="admin-alert admin-alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {!loading && !error && products.length === 0 ? (
        <div className="admin-state">
          <PackageOpen className="admin-state__icon" aria-hidden="true" />
          <p>No products match your filters.</p>
        </div>
      ) : null}

      {!loading && !error && products.length > 0 ? (
        <>
          <p className="admin-hint admin-products-results-meta">{resultsSummary}</p>
          <div className="admin-card-list admin-show-mobile" aria-label="Products">
            {products.map((p) => (
              <AdminProductCard key={String(p.id ?? '')} product={p} />
            ))}
          </div>
          <div className="admin-table-wrap admin-show-desktop">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col" className="admin-table__thumb-col">
                    <span className="sr-only">Image</span>
                  </th>
                  <th scope="col">ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">Company</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Purchase</th>
                  <th scope="col">X4</th>
                  <th scope="col">Catalogue ref.</th>
                  <th scope="col">Mapping</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="admin-table__actions-col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const id = String(p.id ?? '')
                  const mapping = p.pricingMapping && typeof p.pricingMapping === 'object' ? p.pricingMapping : null
                  return (
                    <tr key={id}>
                      <td className="admin-table__thumb-col">
                        <AdminProductTableThumb images={p.images} name={String(p.name ?? '')} />
                      </td>
                      <td className="admin-table__mono">{id}</td>
                      <td>
                        <span className="admin-table__primary">{String(p.name ?? '')}</span>
                        <span className="admin-table__meta">{String(p.categoryLabel ?? p.categorySlug ?? '')}</span>
                      </td>
                      <td>{formatAdminProductCompany(p.company)}</td>
                      <td>{formatAdminProductPack(p.pack)}</td>
                      <td className="tabular-nums">
                        {p.hasPurchaseRate ? (
                          formatOptionalInr(p.purchaseRateInr)
                        ) : (
                          <span className="admin-table__meta admin-table__meta--warn">Missing</span>
                        )}
                      </td>
                      <td className="tabular-nums">
                        {p.hasX4SellingRate || p.hasPrivateX4Rate ? (
                          formatOptionalInr(p.x4SellingPriceInr ?? p.privateX4Inr)
                        ) : (
                          <span className="admin-table__meta admin-table__meta--warn">Missing</span>
                        )}
                      </td>
                      <td className="tabular-nums">{formatOptionalInr(p.cataloguePublicPriceInr)}</td>
                      <td>
                        {mapping?.mappingStatus === 'review' ? (
                          <span className="admin-table__meta admin-table__meta--warn">Review</span>
                        ) : mapping?.mappingStatus === 'verified' ? (
                          'Verified'
                        ) : (
                          <span className="admin-table__meta">—</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge active={p.active !== false} />
                      </td>
                      <td className="admin-table__actions-col">
                        <Link to={`/admin/products/${encodeURIComponent(id)}/edit`} className="admin-table__link">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pagination.totalPages > 1 ? (
            <div className="admin-toolbar">
              <button
                type="button"
                className="admin-link-button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="admin-link-button"
                disabled={page >= pagination.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
