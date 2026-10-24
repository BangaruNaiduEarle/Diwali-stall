import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, PackageOpen, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { formatINR } from '../../utils/currency.js'
import {
  deleteAdminProduct,
  fetchAdminCategories,
  fetchAdminProductsPage,
  updateAdminProduct,
} from '../api/adminApi.js'
import AdminConfirmDialog from '../components/AdminConfirmDialog.jsx'
import AdminProductCard from '../components/AdminProductCard.jsx'
import AdminProductTableInlineCell from '../components/AdminProductTableInlineCell.jsx'
import AdminProductTableThumb from '../components/AdminProductTableThumb.jsx'
import AdminToast from '../components/AdminToast.jsx'
import { mergeAdminProductRowAfterInlineSave } from '../lib/adminProductInlineSave.js'
import {
  showAdminProductMappingColumn,
  showAdminProductSensitiveColumns,
  showAdminProductUnitColumn,
} from '../lib/adminProductTableColumns.js'
import {
  adminProductListSellingPriceView,
  formatAdminProductCompany,
  formatAdminProductPack,
} from '../lib/adminProductTableDisplay.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { canDeleteAdminProducts } from '../lib/adminRoles.js'

/** @param {{ active?: boolean }} props */
function StatusBadge({ active = true }) {
  return (
    <span className={`admin-badge${active ? '' : ' admin-badge--muted'}`}>
      {active ? 'Active' : 'Inactive'}
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
  const { role } = useAdminSession()
  const showSensitiveColumns = showAdminProductSensitiveColumns(role)
  const showUnitColumn = showAdminProductUnitColumn(role)
  const showMappingColumn = showAdminProductMappingColumn(role)
  const canDeleteProduct = canDeleteAdminProducts(role)
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
  const [deleteTarget, setDeleteTarget] = useState(/** @type {{ id: string, name: string } | null} */ (null))
  const [deleting, setDeleting] = useState(false)
  const [activeInlineEdit, setActiveInlineEdit] = useState(
    /** @type {{ id: string, field: import('../lib/adminProductInlineSave.js').AdminProductInlineField } | null} */ (null),
  )
  const [listToast, setListToast] = useState(/** @type {{ type: 'success' | 'error', message: string } | null} */ (null))
  const [selectedIds, setSelectedIds] = useState(/** @type {Set<string>} */ () => new Set())
  const [bulkTargetSlug, setBulkTargetSlug] = useState('')
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkUpdating, setBulkUpdating] = useState(false)

  useEffect(() => {
    if (!listToast) return undefined
    const t = window.setTimeout(() => setListToast(null), 5000)
    return () => window.clearTimeout(t)
  }, [listToast])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
  }, [debouncedQ, categorySlug, missingRateOnly, missingPurchaseRateOnly, includeArchived])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, debouncedQ, categorySlug, missingRateOnly, missingPurchaseRateOnly, includeArchived])

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

  const activeFilterCount = useMemo(() => {
    const filters = [includeArchived]
    if (showSensitiveColumns) filters.push(missingRateOnly, missingPurchaseRateOnly)
    return filters.filter(Boolean).length
  }, [missingRateOnly, missingPurchaseRateOnly, includeArchived, showSensitiveColumns])

  const resultsSummary = useMemo(() => {
    const totalPart = `${pagination.total} product${pagination.total === 1 ? '' : 's'}`
    return pageLabel ? `${totalPart} · ${pageLabel}` : totalPart
  }, [pagination.total, pageLabel])

  const mobileFiltersPanelId = 'admin-products-mobile-filters'

  const pageProductIds = useMemo(
    () => products.map((p) => String(p.id ?? '')).filter(Boolean),
    [products],
  )

  const selectedCount = selectedIds.size

  const allPageSelected =
    pageProductIds.length > 0 && pageProductIds.every((id) => selectedIds.has(id))

  const somePageSelected = pageProductIds.some((id) => selectedIds.has(id))

  const bulkTargetLabel =
    categories.find((c) => c.slug === bulkTargetSlug)?.label ?? bulkTargetSlug

  function toggleProductSelected(id, checked) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleSelectAllPage(checked) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of pageProductIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function openBulkConfirm() {
    if (!bulkTargetSlug || selectedCount === 0) {
      setListToast({ type: 'error', message: 'Choose a target category and at least one product.' })
      return
    }
    setBulkConfirmOpen(true)
  }

  async function confirmBulkCategoryUpdate() {
    if (!bulkTargetSlug || selectedCount === 0 || bulkUpdating) return
    const ids = [...selectedIds]
    setBulkUpdating(true)
    setError(null)
    const results = await Promise.all(
      ids.map((id) => updateAdminProduct(id, { categorySlug: bulkTargetSlug })),
    )
    setBulkUpdating(false)
    const failed = results.filter((r) => !r.ok)
    setBulkConfirmOpen(false)
    if (failed.length === 0) {
      setSelectedIds(new Set())
      setListToast({
        type: 'success',
        message: `Updated category for ${ids.length} product${ids.length === 1 ? '' : 's'}.`,
      })
      await load()
      return
    }
    if (failed.length === ids.length) {
      setListToast({
        type: 'error',
        message: failed[0]?.message || 'Could not update categories.',
      })
      return
    }
    setListToast({
      type: 'error',
      message: `Updated ${ids.length - failed.length} of ${ids.length}. ${failed.length} failed.`,
    })
    const failedIds = ids.filter((id, index) => !results[index]?.ok)
    setSelectedIds(new Set(failedIds))
    await load()
  }

  /** @param {string} productId @param {import('../lib/adminProductInlineSave.js').AdminProductInlineField} field */
  function handleInlineSaved(productId, field, result, draft) {
    if (result.ok) {
      setProducts((prev) =>
        prev.map((row) =>
          String(row.id ?? '') === productId
            ? mergeAdminProductRowAfterInlineSave(row, field, result, draft)
            : row,
        ),
      )
      setListToast({ type: 'success', message: 'Product updated.' })
      return
    }
    setListToast({ type: 'error', message: result.message || 'Could not save changes.' })
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setError(null)
    const result = await deleteAdminProduct(deleteTarget.id)
    setDeleting(false)
    if (!result.ok) {
      setError(result.message)
      setDeleteTarget(null)
      return
    }
    setDeleteTarget(null)
    await load()
  }

  return (
    <div className="admin-page admin-page--products">
      <div className="admin-page__head admin-page__head--products">
        <div className="admin-page__head-text">
          <h2 className="admin-page__title">Products</h2>
          <p className="admin-page__subtitle admin-page__subtitle--compact">
            {showSensitiveColumns
              ? 'Manage purchase rates and selling prices.'
              : 'Manage catalogue products, images, and selling prices.'}
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
          <div className="admin-products-toolbar__desktop-filters">
            {showSensitiveColumns ? (
              <label className="admin-check admin-check--inline">
                <input type="checkbox" checked={missingRateOnly} onChange={(e) => setMissingRateOnly(e.target.checked)} />
                <span>Missing selling price</span>
              </label>
            ) : null}
            {showSensitiveColumns ? (
              <label className="admin-check admin-check--inline">
                <input
                  type="checkbox"
                  checked={missingPurchaseRateOnly}
                  onChange={(e) => setMissingPurchaseRateOnly(e.target.checked)}
                />
                <span>Missing purchase rate</span>
              </label>
            ) : null}
            <label className="admin-check admin-check--inline">
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
              <span>Show inactive</span>
            </label>
            <div className="admin-products-toolbar__refresh-wrap">
              <button
                type="button"
                className="admin-products-toolbar__refresh"
                onClick={load}
                disabled={loading}
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
                Refresh
              </button>
            </div>
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
          {showSensitiveColumns ? (
            <label className="admin-check">
              <input type="checkbox" checked={missingRateOnly} onChange={(e) => setMissingRateOnly(e.target.checked)} />
              <span>Missing selling price</span>
            </label>
          ) : null}
          {showSensitiveColumns ? (
            <label className="admin-check">
              <input
                type="checkbox"
                checked={missingPurchaseRateOnly}
                onChange={(e) => setMissingPurchaseRateOnly(e.target.checked)}
              />
              <span>Missing purchase rate</span>
            </label>
          ) : null}
          <label className="admin-check">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            <span>Show inactive</span>
          </label>
          <button
            type="button"
            className="admin-products-toolbar__refresh admin-products-toolbar__refresh--panel"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
            Refresh list
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

      <AdminToast
        variant={listToast?.type ?? 'success'}
        message={listToast?.message}
        onDismiss={() => setListToast(null)}
      />

      {!loading && !error && products.length > 0 ? (
        <>
          <p className="admin-hint admin-products-results-meta">{resultsSummary}</p>

          {selectedCount > 0 ? (
            <div className="admin-panel admin-products-bulk mt-4 flex flex-wrap items-end gap-3">
              <p className="text-sm font-medium text-[var(--color-charcoal)]">
                {selectedCount} selected on this page
              </p>
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
                <span className="admin-label">Move to category</span>
                <select
                  className="admin-input"
                  value={bulkTargetSlug}
                  onChange={(e) => setBulkTargetSlug(e.target.value)}
                  aria-label="Target category for bulk update"
                >
                  <option value="">Select category…</option>
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="button" variant="primary" size="sm" onClick={openBulkConfirm}>
                Update category
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </Button>
            </div>
          ) : null}

          <div className="admin-card-list admin-show-mobile" aria-label="Products">
            {products.map((p) => {
              const id = String(p.id ?? '')
              return (
                <div key={id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-4 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                    checked={selectedIds.has(id)}
                    onChange={(e) => toggleProductSelected(id, e.target.checked)}
                    aria-label={`Select ${String(p.name ?? id)}`}
                  />
                  <div className="min-w-0 flex-1">
                    <AdminProductCard
                      product={p}
                      showSensitiveColumns={showSensitiveColumns}
                      showUnitInSummary={showUnitColumn}
                      onDelete={
                        canDeleteProduct
                          ? (target) => setDeleteTarget({ id: target.id, name: target.name })
                          : undefined
                      }
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="admin-table-wrap admin-show-desktop">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col" className="w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-brand)]"
                      checked={allPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = somePageSelected && !allPageSelected
                      }}
                      onChange={(e) => toggleSelectAllPage(e.target.checked)}
                      aria-label="Select all products on this page"
                    />
                  </th>
                  <th scope="col" className="admin-table__thumb-col">
                    <span className="sr-only">Image</span>
                  </th>
                  <th scope="col">ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">Company</th>
                  {showUnitColumn ? <th scope="col">Unit</th> : null}
                  {showSensitiveColumns ? <th scope="col">Purchase</th> : null}
                  <th scope="col">Selling Price</th>
                  {showMappingColumn ? <th scope="col">Mapping</th> : null}
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
                  const sellingView = adminProductListSellingPriceView(p)
                  const purchaseSeed =
                    p.hasPurchaseRate && p.purchaseRateInr != null && p.purchaseRateInr !== ''
                      ? String(p.purchaseRateInr)
                      : ''
                  const sellingSeed =
                    sellingView.kind === 'value' && sellingView.inr != null ? String(sellingView.inr) : ''
                  const isEditing = (field) =>
                    activeInlineEdit?.id === id && activeInlineEdit?.field === field
                  return (
                    <tr key={id}>
                      <td>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--color-brand)]"
                          checked={selectedIds.has(id)}
                          onChange={(e) => toggleProductSelected(id, e.target.checked)}
                          aria-label={`Select ${String(p.name ?? id)}`}
                        />
                      </td>
                      <td className="admin-table__thumb-col">
                        <AdminProductTableThumb images={p.images} name={String(p.name ?? '')} />
                      </td>
                      <td className="admin-table__mono">{id}</td>
                      <td>
                        <AdminProductTableInlineCell
                          productId={id}
                          field="name"
                          editable
                          draftSeed={String(p.name ?? '')}
                          isActive={isEditing('name')}
                          onActivate={() => setActiveInlineEdit({ id, field: 'name' })}
                          onDeactivate={() => setActiveInlineEdit(null)}
                          onSaved={(result, draft) => handleInlineSaved(id, 'name', result, draft)}
                          display={<span className="admin-table__primary">{String(p.name ?? '')}</span>}
                        />
                        <span className="admin-table__meta">{String(p.categoryLabel ?? p.categorySlug ?? '')}</span>
                      </td>
                      <td>
                        <AdminProductTableInlineCell
                          productId={id}
                          field="company"
                          editable
                          maxLength={120}
                          draftSeed={String(p.company ?? '').trim()}
                          isActive={isEditing('company')}
                          onActivate={() => setActiveInlineEdit({ id, field: 'company' })}
                          onDeactivate={() => setActiveInlineEdit(null)}
                          onSaved={(result, draft) => handleInlineSaved(id, 'company', result, draft)}
                          display={formatAdminProductCompany(p.company)}
                        />
                      </td>
                      {showUnitColumn ? (
                        <td>
                          <AdminProductTableInlineCell
                            productId={id}
                            field="pack"
                            editable
                            draftSeed={String(p.pack ?? '')}
                            isActive={isEditing('pack')}
                            onActivate={() => setActiveInlineEdit({ id, field: 'pack' })}
                            onDeactivate={() => setActiveInlineEdit(null)}
                            onSaved={(result, draft) => handleInlineSaved(id, 'pack', result, draft)}
                            display={formatAdminProductPack(p.pack)}
                          />
                        </td>
                      ) : null}
                      {showSensitiveColumns ? (
                        <td className="tabular-nums">
                          <AdminProductTableInlineCell
                            productId={id}
                            field="purchaseRateInr"
                            editable
                            inputMode="decimal"
                            draftSeed={purchaseSeed}
                            isActive={isEditing('purchaseRateInr')}
                            onActivate={() => setActiveInlineEdit({ id, field: 'purchaseRateInr' })}
                            onDeactivate={() => setActiveInlineEdit(null)}
                            onSaved={(result, draft) => handleInlineSaved(id, 'purchaseRateInr', result, draft)}
                            display={
                              p.hasPurchaseRate ? (
                                formatOptionalInr(p.purchaseRateInr)
                              ) : (
                                <span className="admin-table__meta admin-table__meta--warn">Missing</span>
                              )
                            }
                          />
                        </td>
                      ) : null}
                      <td className="tabular-nums">
                        <AdminProductTableInlineCell
                          productId={id}
                          field="sellingPriceInr"
                          editable={showSensitiveColumns}
                          inputMode="decimal"
                          draftSeed={sellingSeed}
                          isActive={isEditing('sellingPriceInr')}
                          onActivate={() => setActiveInlineEdit({ id, field: 'sellingPriceInr' })}
                          onDeactivate={() => setActiveInlineEdit(null)}
                          onSaved={(result, draft) => handleInlineSaved(id, 'sellingPriceInr', result, draft)}
                          display={
                            sellingView.kind === 'value' ? (
                              formatOptionalInr(sellingView.inr)
                            ) : (
                              <span className="admin-table__meta admin-table__meta--warn">Missing</span>
                            )
                          }
                        />
                      </td>
                      {showMappingColumn ? (
                        <td>
                          {mapping?.mappingStatus === 'review' ? (
                            <span className="admin-table__meta admin-table__meta--warn">Review</span>
                          ) : mapping?.mappingStatus === 'verified' ? (
                            'Verified'
                          ) : (
                            <span className="admin-table__meta">—</span>
                          )}
                        </td>
                      ) : null}
                      <td>
                        <StatusBadge active={p.active !== false} />
                      </td>
                      <td className="admin-table__actions-col">
                        <div className="admin-table__actions">
                          <Link to={`/admin/products/${encodeURIComponent(id)}/edit`} className="admin-table__link">
                            Edit
                          </Link>
                          {canDeleteProduct ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDeleteTarget({ id, name: String(p.name ?? id) })
                              }
                            >
                              Delete
                            </Button>
                          ) : null}
                        </div>
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

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `Delete “${deleteTarget.name}”?` : 'Delete product?'}
        description="Permanent deletion cannot be undone. If this product appears on customer requests, quotations, or family packs, deletion will be blocked — deactivate the product instead."
        cancelLabel="Keep product"
        confirmLabel="Delete permanently"
        confirming={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        onConfirm={confirmDelete}
      />

      <AdminConfirmDialog
        open={bulkConfirmOpen}
        title="Update product categories?"
        description={`Move ${selectedCount} product${selectedCount === 1 ? '' : 's'} to “${bulkTargetLabel}”. Only the category field will change; IDs, prices, images, and other data stay the same.`}
        cancelLabel="Cancel"
        confirmLabel="Update categories"
        confirming={bulkUpdating}
        onCancel={() => {
          if (!bulkUpdating) setBulkConfirmOpen(false)
        }}
        onConfirm={confirmBulkCategoryUpdate}
      />
    </div>
  )
}
