import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, PackageOpen, Plus, Search } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { formatINR } from '../../utils/currency.js'
import { fetchAdminCategories, fetchAdminProductsPage } from '../api/adminApi.js'

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

  return (
    <div className="admin-page">
      <div className="admin-page__head">
        <div>
          <h2 className="admin-page__title">Products</h2>
          <p className="admin-page__subtitle">
            Purchase rates (Excel Rate) and X4 selling prices (D1) — separate from static public catalogue.
          </p>
        </div>
        <Button to="/admin/products/new" variant="primary" surface="light" icon={Plus}>
          New product
        </Button>
      </div>

      <div className="admin-toolbar admin-toolbar--stack">
        <label className="admin-search">
          <Search className="admin-search__icon" aria-hidden="true" />
          <input
            type="search"
            className="admin-input admin-search__input"
            placeholder="Search by name or product ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="admin-toolbar">
          <select
            className="admin-input"
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
          <p className="admin-hint">
            {pagination.total} product{pagination.total === 1 ? '' : 's'}
            {pageLabel ? ` · ${pageLabel}` : ''}
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">Category</th>
                  <th scope="col">Purchase rate</th>
                  <th scope="col">X4 selling</th>
                  <th scope="col">Catalogue ref.</th>
                  <th scope="col">Mapping</th>
                  <th scope="col">Stock</th>
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
                      <td className="admin-table__mono">{id}</td>
                      <td>
                        <span className="admin-table__primary">{String(p.name ?? '')}</span>
                      </td>
                      <td>{String(p.categoryLabel ?? p.categorySlug ?? '—')}</td>
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
                      <td>{String(p.stockStatus ?? '—')}</td>
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
