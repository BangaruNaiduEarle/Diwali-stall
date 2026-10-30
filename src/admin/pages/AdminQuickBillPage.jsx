import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import AdminConfirmDialog from '../components/AdminConfirmDialog.jsx'
import { formatINR } from '../../utils/currency.js'
import {
  checkoutQuickBill,
  fetchAdminCategories,
  fetchAdminProductsPage,
  patchAdminCustomerRequestAssign,
  previewQuickBill,
} from '../api/adminApi.js'
import QuickBillAssigneeSelect from '../components/QuickBillAssigneeSelect.jsx'
import { paiseToInrHelper } from '../lib/moneyDisplay.js'
import AdminProductNameWithCompany from '../components/AdminProductNameWithCompany.jsx'
import AdminQuickBillProductThumb from '../components/AdminQuickBillProductThumb.jsx'
import { resolveQuickBillApiImageUrl } from '../lib/quickBillProductImage.js'
import {
  addProductToCart,
  cartToCheckoutItems,
  findCartLineIndex,
  getCartLineQuantity,
  removeCartLine,
  setCartLineQuantity,
} from '../lib/quickBillCart.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { useQuickBillAssignees } from '../lib/quickBillAssignees.js'
import { canAssignQuickBillCustomerRequests, canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { listQuickBillCustomerValidationIssues } from '../lib/quickBillCustomerValidation.js'

/** @typedef {'selling' | 'bargain'} QuickBillPricingMode */

/** @param {unknown} inrStr */
function parseAcceptedAmountInrToPaise(inrStr) {
  const trimmed = String(inrStr ?? '').trim()
  if (!trimmed) {
    return { ok: false, message: 'Enter the accepted amount in rupees for bargain mode.' }
  }
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: 'Accepted amount must be zero or a positive number.' }
  }
  const paise = Math.round(n * 100)
  if (!Number.isInteger(paise) || paise < 0) {
    return { ok: false, message: 'Accepted amount could not be converted to paise.' }
  }
  return { ok: true, paise }
}

/** @param {Record<string, unknown> | null | undefined} preview @param {string} key */
function formatPreviewPaise(preview, key) {
  if (!preview) return '—'
  const p = Number(preview[key])
  if (!Number.isInteger(p) || p < 0) return '—'
  return formatINR(paiseToInrHelper(p))
}

/** @param {{ active: boolean, onClick: () => void, children: import('react').ReactNode }} props */
function QuickBillCategoryChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`admin-quick-bill__chip focus-ring${active ? ' admin-quick-bill__chip--active' : ''}`}
    >
      {children}
    </button>
  )
}

/** @param {Record<string, unknown>} product */
function formatQuickBillListPrice(product) {
  if (!product.hasSellingPrice) return null
  const inr = product.sellingPriceInr
  if (inr === null || inr === undefined || inr === '') return null
  const n = Number(inr)
  if (!Number.isFinite(n)) return null
  return formatINR(n)
}

/** @param {{ productCount: number, totalBoxes: number, totalLoosePieces: number }} stats */
function QuickBillCompactStats({ stats }) {
  const { productCount, totalBoxes, totalLoosePieces } = stats
  if (productCount === 0 && totalBoxes === 0 && totalLoosePieces === 0) {
    return <p className="admin-quick-bill__dock-breakdown admin-quick-bill__dock-breakdown--empty">No items yet</p>
  }
  return (
    <p className="admin-quick-bill__dock-breakdown">
      <span>{productCount} prod</span>
      <span className="admin-quick-bill__dock-breakdown-sep" aria-hidden="true">
        ·
      </span>
      <span>{totalBoxes} box</span>
      <span className="admin-quick-bill__dock-breakdown-sep" aria-hidden="true">
        ·
      </span>
      <span>{totalLoosePieces} pc</span>
    </p>
  )
}

/** @param {Record<string, unknown>} product */
function formatQuickBillLoosePcPrice(product) {
  if (!product.allowLooseSale || !product.hasSellingPrice) return null
  const pieces = Number(product.piecesPerPack)
  const inr = Number(product.sellingPriceInr)
  if (!Number.isInteger(pieces) || pieces < 1 || !Number.isFinite(inr)) return null
  const boxPaise = Math.round(inr * 100)
  const pcPaise = Math.floor(boxPaise / pieces)
  if (pcPaise <= 0) return null
  return formatINR(paiseToInrHelper(pcPaise))
}

export default function AdminQuickBillPage() {
  const { role } = useAdminSession()
  const canUseBargainMode = canViewSensitiveProductPricing(role)
  const canAssign = canAssignQuickBillCustomerRequests(role)
  const { users: assigneeUsers, loading: assigneesLoading, error: assigneesError } =
    useQuickBillAssignees(canAssign)
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [query, setQuery] = useState('')
  const [categorySlug, setCategorySlug] = useState('')
  const [categories, setCategories] = useState(/** @type {{ slug: string, label: string }[]} */ ([]))
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchResults, setSearchResults] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [cart, setCart] = useState(/** @type {import('../lib/quickBillCart.js').QuickBillCartLine[]} */ ([]))
  const [customerName, setCustomerName] = useState('Walk-in')
  const [customerMobile, setCustomerMobile] = useState('')
  const [preview, setPreview] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState(/** @type {string | null} */ (null))
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState(/** @type {string | null} */ (null))
  const [checkoutCustomerDialogOpen, setCheckoutCustomerDialogOpen] = useState(false)
  const [customerFieldIssues, setCustomerFieldIssues] = useState(
    /** @type {{ field: 'name' | 'mobile', message: string }[]} */ ([]),
  )
  const [pricingMode, setPricingMode] = useState(/** @type {QuickBillPricingMode} */ ('selling'))
  const [acceptedAmountInr, setAcceptedAmountInr] = useState('')
  const [success, setSuccess] = useState(
    /** @type {{
     *   requestId: string,
     *   totalPaise: number,
     *   warnings?: { code?: string, message?: string }[],
     *   assignedToEmail?: string | null,
     *   assignError?: string | null,
     * } | null} */ (null),
  )
  const [successAssigneeUserId, setSuccessAssigneeUserId] = useState('')
  const [assignBusy, setAssignBusy] = useState(false)
  const billSectionRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const previewRequestSeqRef = useRef(0)

  const effectivePricingMode = canUseBargainMode && pricingMode === 'bargain' ? 'bargain' : 'selling'

  const cartItemsPayload = useMemo(() => cartToCheckoutItems(cart), [cart])

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

  useEffect(() => {
    const q = query.trim()
    const hasCategory = categorySlug.length > 0
    if (q.length < 1 && !hasCategory) {
      setSearchResults([])
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchBusy(true)
      const res = await fetchAdminProductsPage({
        q: q || undefined,
        categorySlug: categorySlug || undefined,
        page: 1,
        limit: 12,
        flexSearch: Boolean(q),
      })
      if (!cancelled) {
        setSearchBusy(false)
        setSearchResults(res.ok ? /** @type {Record<string, unknown>[]} */ (res.products) : [])
      }
    }, 280)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, categorySlug])

  useEffect(() => {
    if (!canUseBargainMode && pricingMode === 'bargain') {
      setPricingMode('selling')
      setAcceptedAmountInr('')
    }
  }, [canUseBargainMode, pricingMode])

  const loadPreview = useCallback(async (items, mode) => {
    if (items.length === 0) {
      previewRequestSeqRef.current += 1
      setPreview(null)
      setPreviewError(null)
      setPreviewBusy(false)
      return
    }
    const seq = previewRequestSeqRef.current + 1
    previewRequestSeqRef.current = seq
    setPreviewBusy(true)
    setPreviewError(null)
    const res = await previewQuickBill(items, { pricingMode: mode })
    if (seq !== previewRequestSeqRef.current) {
      return
    }
    setPreviewBusy(false)
    if (!res.ok) {
      const missing = res.missingProductIds?.length
        ? ` Missing selling price for: ${res.missingProductIds.join(', ')}.`
        : ''
      setPreviewError((res.message || 'Could not calculate total.') + missing)
      return
    }
    setPreview(/** @type {Record<string, unknown>} */ (res.preview))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPreview(cartItemsPayload, effectivePricingMode)
    }, 320)
    return () => clearTimeout(timer)
  }, [cartItemsPayload, effectivePricingMode, loadPreview])

  function handleAddProduct(product, unitType = 'box') {
    const id = String(product.id ?? '')
    const name = String(product.name ?? id)
    if (!id) return
    setSuccess(null)
    const productImageUrl = resolveQuickBillApiImageUrl(product)
    const allowLooseSale = Boolean(product.allowLooseSale)
    const company =
      product.company != null && String(product.company).trim()
        ? String(product.company).trim()
        : null
    setCart((prev) =>
      addProductToCart(
        prev,
        { productId: id, name, company, productImageUrl, allowLooseSale },
        1,
        unitType === 'piece' ? 'piece' : 'box',
      ),
    )
  }

  function handleCheckoutClick() {
    setCheckoutError(null)
    const customerIssues = listQuickBillCustomerValidationIssues(
      customerName.trim(),
      customerMobile.trim(),
    )
    if (customerIssues.length) {
      setCustomerFieldIssues(customerIssues)
      setCheckoutCustomerDialogOpen(true)
      return
    }
    setCustomerFieldIssues([])
    void runCheckout()
  }

  function runCheckout() {
    setCheckoutError(null)
    /** @type {{ pricingMode: QuickBillPricingMode, acceptedAmountPaise?: number }} */
    const pricingPayload = { pricingMode: effectivePricingMode }
    if (effectivePricingMode === 'bargain') {
      const parsed = parseAcceptedAmountInrToPaise(acceptedAmountInr)
      if (!parsed.ok) {
        setCheckoutError(parsed.message ?? 'Invalid accepted amount.')
        return
      }
      pricingPayload.acceptedAmountPaise = parsed.paise
    }

    const assignOnSave = assigneeUserId.trim()
    setCheckoutBusy(true)
    checkoutQuickBill({
      customer: {
        name: customerName.trim(),
        mobile: customerMobile.trim(),
      },
      items: cartItemsPayload,
      ...pricingPayload,
    }).then(async (res) => {
      setCheckoutBusy(false)
      if (!res.ok) {
        const missing = res.missingProductIds?.length
          ? ` Missing selling price for: ${res.missingProductIds.join(', ')}.`
          : ''
        const fieldHint = res.fields?.acceptedAmountPaise ?? res.fields?.['customer.mobile']
        const detail = fieldHint ? ` ${fieldHint}` : ''
        setCheckoutError((res.message || 'Checkout failed.') + detail + missing)
        return
      }
      const request = /** @type {{ id?: string }} */ (res.request)
      const quotation = /** @type {{ totalPaise?: number }} */ (res.quotation)
      const warnings = /** @type {{ code?: string, message?: string }[] | undefined} */ (res.warnings)
      const requestId = String(request.id ?? '')
      /** @type {string | null} */
      let assignedToEmail = null
      /** @type {string | null} */
      let assignError = null
      if (assignOnSave) {
        const assignRes = await patchAdminCustomerRequestAssign(requestId, {
          assigneeUserId: assignOnSave,
        })
        if (assignRes.ok) {
          assignedToEmail =
            assignRes.request?.assignedToEmail != null
              ? String(assignRes.request.assignedToEmail)
              : null
        } else {
          assignError = assignRes.message || 'Could not assign bill.'
        }
      }
      setSuccessAssigneeUserId(assignOnSave && !assignedToEmail ? assignOnSave : '')
      setSuccess({
        requestId,
        totalPaise: Number(quotation.totalPaise ?? 0),
        warnings: warnings?.length ? warnings : undefined,
        assignedToEmail,
        assignError,
      })
      setCart([])
      setPreview(null)
      setAcceptedAmountInr('')
      setPricingMode('selling')
      setAssigneeUserId('')
      setCustomerFieldIssues([])
    })
  }

  const customerNameInvalid = customerFieldIssues.some((i) => i.field === 'name')
  const customerMobileInvalid = customerFieldIssues.some((i) => i.field === 'mobile')

  async function handleSuccessAssign() {
    if (!success?.requestId || !successAssigneeUserId.trim()) return
    setAssignBusy(true)
    const res = await patchAdminCustomerRequestAssign(success.requestId, {
      assigneeUserId: successAssigneeUserId.trim(),
    })
    setAssignBusy(false)
    if (!res.ok) {
      setSuccess((prev) =>
        prev ? { ...prev, assignError: res.message || 'Could not assign bill.' } : prev,
      )
      return
    }
    setSuccess((prev) =>
      prev
        ? {
            ...prev,
            assignedToEmail:
              res.request?.assignedToEmail != null ? String(res.request.assignedToEmail) : null,
            assignError: null,
          }
        : prev,
    )
  }

  const totalInr = preview ? formatINR(paiseToInrHelper(preview.totalPaise)) : '—'

  const bargainAcceptedMissing =
    effectivePricingMode === 'bargain' && !String(acceptedAmountInr).trim()

  const billSummary = useMemo(() => {
    /** @type {Set<string>} */
    const productIds = new Set()
    let totalBoxes = 0
    let totalLoosePieces = 0
    for (const line of cart) {
      productIds.add(line.productId)
      if (line.unitType === 'piece') {
        totalLoosePieces += line.quantity
      } else {
        totalBoxes += line.quantity
      }
    }
    return {
      productCount: productIds.size,
      totalBoxes,
      totalLoosePieces,
    }
  }, [cart])

  const cartBoxLines = useMemo(
    () => cart.filter((line) => line.unitType !== 'piece'),
    [cart],
  )
  const cartLooseLines = useMemo(
    () => cart.filter((line) => line.unitType === 'piece'),
    [cart],
  )

  const previewLineTotalByKey = useMemo(() => {
    /** @type {Map<string, number>} */
    const map = new Map()
    const items = preview?.items
    if (!Array.isArray(items)) return map
    for (const entry of items) {
      if (!entry || typeof entry !== 'object') continue
      const row = /** @type {Record<string, unknown>} */ (entry)
      const productId = String(row.productId ?? '')
      const unitType = row.unitType === 'piece' ? 'piece' : 'box'
      const lineTotalPaise = Number(row.lineTotalPaise)
      if (productId && Number.isInteger(lineTotalPaise)) {
        map.set(`${productId}:${unitType}`, lineTotalPaise)
      }
    }
    return map
  }, [preview])

  /** @param {import('../lib/quickBillCart.js').QuickBillCartLine} line */
  function renderBillLine(line) {
    const unitType = line.unitType === 'piece' ? 'piece' : 'box'
    const unitLabel = unitType === 'piece' ? 'Loose pc' : 'Box'
    const unitPillClass =
      unitType === 'piece'
        ? 'admin-quick-bill__unit-pill admin-quick-bill__unit-pill--piece'
        : 'admin-quick-bill__unit-pill admin-quick-bill__unit-pill--box'
    const lineTotalPaise = previewLineTotalByKey.get(`${line.productId}:${unitType}`)
    const lineTotalInr =
      lineTotalPaise != null && Number.isInteger(lineTotalPaise)
        ? formatINR(paiseToInrHelper(lineTotalPaise))
        : previewBusy
          ? '…'
          : '—'
    return (
      <li key={`${line.productId}-${unitType}`} className="admin-quick-bill__line">
        <div className="admin-quick-bill__line-main">
          <AdminQuickBillProductThumb
            src={line.productImageUrl ?? ''}
            label={line.name}
            className="admin-quick-bill__thumb--sm"
          />
          <div className="admin-quick-bill__line-body">
            <AdminProductNameWithCompany
              name={line.name}
              company={line.company}
              className="admin-quick-bill__line-name"
              nameClassName="admin-quick-bill__line-name-text"
            />
            <div className="admin-quick-bill__line-meta">
              <span className="admin-quick-bill__line-id">{line.productId}</span>
              <span className={unitPillClass}>{unitLabel}</span>
              <span className="admin-quick-bill__line-qty">
                Qty <strong>{line.quantity}</strong>
              </span>
            </div>
          </div>
          <div className="admin-quick-bill__line-total-wrap">
            <span className="admin-quick-bill__line-total-label">Amount</span>
            <p className="admin-quick-bill__line-total" aria-live="polite">
              {lineTotalInr}
            </p>
          </div>
        </div>
        <div
          className="admin-quick-bill__line-foot"
          role="group"
          aria-label={`Quantity for ${line.name}, ${unitLabel}`}
        >
          <div className="admin-quick-bill__qty">
            <button
              type="button"
              className="admin-quick-bill__qty-btn"
              aria-label={`Decrease ${unitLabel} quantity`}
              onClick={() =>
                setCart((prev) => setCartLineQuantity(prev, line.productId, line.quantity - 1, unitType))
              }
            >
              <Minus size={20} aria-hidden="true" />
            </button>
            <span className="admin-quick-bill__qty-value" aria-live="polite">
              {line.quantity}
            </span>
            <button
              type="button"
              className="admin-quick-bill__qty-btn"
              aria-label={`Increase ${unitLabel} quantity`}
              onClick={() =>
                setCart((prev) => setCartLineQuantity(prev, line.productId, line.quantity + 1, unitType))
              }
            >
              <Plus size={20} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="admin-quick-bill__remove-btn"
            aria-label={`Remove ${line.name} (${unitLabel})`}
            onClick={() => setCart((prev) => removeCartLine(prev, line.productId, unitType))}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      </li>
    )
  }

  if (success?.requestId) {
    return (
      <div className="admin-page admin-quick-bill">
        <header className="admin-page__head">
          <h2 className="admin-page__title">Bill saved</h2>
          <p className="admin-muted">
            Quotation total {formatINR(paiseToInrHelper(success.totalPaise))} (selling prices). No payment recorded.
          </p>
        </header>
        {success.warnings?.length ? (
          <div className="admin-panel admin-quick-bill__bargain-internal" role="status">
            <p className="admin-quick-bill__bargain-internal-title">Internal bargain notice</p>
            {success.warnings.map((w) => (
              <p key={String(w.code ?? w.message)} className="admin-quick-bill__checkout-warn">
                {String(w.message ?? 'Review accepted amount against Final Price subtotal.')}
              </p>
            ))}
          </div>
        ) : null}
        {canAssign ? (
          <div className="admin-panel admin-quick-bill__assign-panel">
            {success.assignedToEmail ? (
              <p className="admin-hint">
                Assigned to <span className="admin-request-detail__mono">{success.assignedToEmail}</span>
              </p>
            ) : (
              <>
                <QuickBillAssigneeSelect
                  id="quick-bill-success-assignee"
                  value={successAssigneeUserId}
                  onChange={setSuccessAssigneeUserId}
                  users={assigneeUsers}
                  loading={assigneesLoading}
                  disabled={assignBusy}
                  hint={assigneesError}
                />
                {success.assignError ? (
                  <p className="admin-error admin-quick-bill__bill-error">{success.assignError}</p>
                ) : null}
                <Button
                  type="button"
                  className="admin-touch-button"
                  variant="secondary"
                  disabled={assignBusy || !successAssigneeUserId.trim()}
                  onClick={handleSuccessAssign}
                >
                  {assignBusy ? 'Assigning…' : 'Assign bill'}
                </Button>
              </>
            )}
          </div>
        ) : null}
        <div className="admin-panel admin-quick-bill__success">
          <Link to={`/admin/customer-requests/${encodeURIComponent(success.requestId)}`} className="admin-link-button">
            Open request &amp; quotation
          </Link>
          <Button type="button" variant="secondary" onClick={() => setSuccess(null)}>
            New bill
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-page admin-quick-bill admin-quick-bill--sticky-checkout">
      <header className="admin-page__head admin-quick-bill__head">
        <h2 className="admin-page__title">Quick bill</h2>
        <p className="admin-muted admin-quick-bill__lede">Search, add to bill, save quotation.</p>
      </header>

      <section className="admin-quick-bill__search" aria-label="Product search">
        <label className="admin-field admin-quick-bill__search-field">
          <span className="admin-label">Search name or ID</span>
          <span className="admin-quick-bill__search-wrap">
            <Search size={18} className="admin-quick-bill__search-icon" aria-hidden="true" />
            <input
              className="admin-input admin-quick-bill__search-input"
              type="search"
              inputMode="search"
              autoComplete="off"
              placeholder="P005 or name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
        </label>
        {categories.length > 0 ? (
          <div className="admin-quick-bill__categories scroll-chips" aria-label="Category">
            <div className="admin-quick-bill__categories-track">
              <QuickBillCategoryChip active={!categorySlug} onClick={() => setCategorySlug('')}>
                All
              </QuickBillCategoryChip>
              {categories.map(({ slug, label }) => (
                <QuickBillCategoryChip
                  key={slug}
                  active={categorySlug === slug}
                  onClick={() => setCategorySlug(slug)}
                >
                  {label || slug}
                </QuickBillCategoryChip>
              ))}
            </div>
          </div>
        ) : null}
        {searchBusy ? (
          <p className="admin-muted admin-quick-bill__hint">
            <Loader2 size={16} className="inline animate-spin" aria-hidden="true" /> Searching…
          </p>
        ) : null}
        {!searchBusy && searchResults.length === 0 && (query.trim() || categorySlug) ? (
          <p className="admin-muted admin-quick-bill__hint">No products match this search or category.</p>
        ) : null}
        {searchResults.length > 0 ? (
          <ul className="admin-quick-bill__results">
            {searchResults.map((product) => {
              const id = String(product.id ?? '')
              const hasSellingPrice = Boolean(product.hasSellingPrice)
              const allowLooseSale = Boolean(product.allowLooseSale)
              const imageUrl = resolveQuickBillApiImageUrl(product)
              const name = String(product.name ?? '')
              const boxPrice = formatQuickBillListPrice(product)
              const pcPrice = formatQuickBillLoosePcPrice(product)
              const boxInCart = findCartLineIndex(cart, id, 'box') >= 0
              const pieceInCart = findCartLineIndex(cart, id, 'piece') >= 0
              const boxQty = getCartLineQuantity(cart, id, 'box')
              const pieceQty = getCartLineQuantity(cart, id, 'piece')
              const showQtyBadges =
                (boxQty != null && boxQty > 0) || (pieceQty != null && pieceQty > 0)
              return (
                <li key={id} className="admin-quick-bill__product">
                  <button
                    type="button"
                    className={`admin-quick-bill__product-add${boxInCart ? ' admin-quick-bill__product-add--active' : ''}`}
                    aria-pressed={boxInCart}
                    onClick={() => handleAddProduct(product, 'box')}
                  >
                    <AdminQuickBillProductThumb
                      src={imageUrl}
                      label={name}
                      className="admin-quick-bill__thumb--sm"
                    />
                    <span className="admin-quick-bill__product-copy">
                      <AdminProductNameWithCompany
                        name={name}
                        company={product.company}
                        className="admin-quick-bill__result-name"
                        nameClassName="admin-quick-bill__result-name-text"
                      />
                      <span className="admin-quick-bill__result-id">{id}</span>
                      {showQtyBadges ? (
                        <span className="admin-quick-bill__result-qty-badges" aria-label="In bill">
                          {boxQty != null && boxQty > 0 ? (
                            <span className="admin-quick-bill__result-qty-badge tabular-nums">
                              Box × {boxQty}
                            </span>
                          ) : null}
                          {pieceQty != null && pieceQty > 0 ? (
                            <span className="admin-quick-bill__result-qty-badge tabular-nums">
                              Piece × {pieceQty}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                    <span className="admin-quick-bill__product-price">
                      {boxPrice ? (
                        <>
                          <span className="admin-quick-bill__price-value">{boxPrice}</span>
                          <span className="admin-quick-bill__price-unit">/ box</span>
                        </>
                      ) : (
                        <span className="admin-quick-bill__badge admin-quick-bill__badge--warn">No price</span>
                      )}
                    </span>
                  </button>
                  {allowLooseSale && hasSellingPrice && pcPrice ? (
                    <button
                      type="button"
                      className={`admin-quick-bill__product-add-piece${pieceInCart ? ' admin-quick-bill__product-add-piece--active' : ''}`}
                      aria-label={`Add ${name} loose piece at ${pcPrice}`}
                      aria-pressed={pieceInCart}
                      onClick={() => handleAddProduct(product, 'piece')}
                    >
                      <span className="admin-quick-bill__piece-label">pc</span>
                      <span className="admin-quick-bill__piece-price">{pcPrice}</span>
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <div ref={billSectionRef} id="quick-bill-bill" className="admin-quick-bill__bill">
        <section className="admin-quick-bill__cart" aria-label="Cart">
          <h3 className="admin-quick-bill__section-title">Your bill</h3>
          {cart.length === 0 ? (
            <p className="admin-muted">Add products from search, then review and save here.</p>
          ) : (
            <>
              <QuickBillCompactStats stats={billSummary} />
              {cartBoxLines.length > 0 ? (
                <div className="admin-quick-bill__lines-group">
                  <h4 className="admin-quick-bill__lines-heading admin-quick-bill__lines-heading--box">
                    Boxes / packs
                    <span className="admin-quick-bill__lines-heading-count">
                      {billSummary.totalBoxes} total
                    </span>
                  </h4>
                  <ul className="admin-quick-bill__lines">{cartBoxLines.map(renderBillLine)}</ul>
                </div>
              ) : null}
              {cartLooseLines.length > 0 ? (
                <div className="admin-quick-bill__lines-group">
                  <h4 className="admin-quick-bill__lines-heading admin-quick-bill__lines-heading--piece">
                    Loose pieces
                    <span className="admin-quick-bill__lines-heading-count">
                      {billSummary.totalLoosePieces} total
                    </span>
                  </h4>
                  <ul className="admin-quick-bill__lines">{cartLooseLines.map(renderBillLine)}</ul>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="admin-quick-bill__customer admin-quick-bill__customer-panel">
          <h3 className="admin-quick-bill__section-title">Customer</h3>
          <div className="admin-form__row admin-quick-bill__customer-row">
            <label className="admin-field">
              <span className="admin-label">Name</span>
              <input
                className={`admin-input${customerNameInvalid ? ' admin-quick-bill__input--invalid' : ''}`}
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value)
                  if (customerFieldIssues.length) {
                    setCustomerFieldIssues(
                      listQuickBillCustomerValidationIssues(e.target.value, customerMobile),
                    )
                  }
                }}
                autoComplete="name"
                aria-invalid={customerNameInvalid || undefined}
              />
            </label>
            <label className="admin-field">
              <span className="admin-label">Mobile (10 digits)</span>
              <input
                className={`admin-input${customerMobileInvalid ? ' admin-quick-bill__input--invalid' : ''}`}
                type="tel"
                inputMode="numeric"
                value={customerMobile}
                onChange={(e) => {
                  setCustomerMobile(e.target.value)
                  if (customerFieldIssues.length) {
                    setCustomerFieldIssues(
                      listQuickBillCustomerValidationIssues(customerName, e.target.value),
                    )
                  }
                }}
                autoComplete="tel"
                placeholder="9876543210"
                aria-invalid={customerMobileInvalid || undefined}
              />
            </label>
          </div>
        </section>

        <section className="admin-quick-bill__checkout-panel" aria-label="Pricing and checkout">
          {previewError ? <p className="admin-error admin-quick-bill__bill-error">{previewError}</p> : null}
          {checkoutError ? <p className="admin-error admin-quick-bill__bill-error">{checkoutError}</p> : null}

          {canUseBargainMode && cart.length > 0 ? (
            <div className="admin-quick-bill__pricing-bar">
              <div className="admin-quick-bill__pricing-mode" role="group" aria-label="Pricing mode">
                <span className="admin-quick-bill__pricing-mode-label">Internal</span>
                <QuickBillCategoryChip
                  active={effectivePricingMode === 'selling'}
                  onClick={() => {
                    setPricingMode('selling')
                    setAcceptedAmountInr('')
                  }}
                >
                  Selling
                </QuickBillCategoryChip>
                <QuickBillCategoryChip
                  active={effectivePricingMode === 'bargain'}
                  onClick={() => setPricingMode('bargain')}
                >
                  Bargain
                </QuickBillCategoryChip>
              </div>
              <div className="admin-quick-bill__pricing-bar-total">
                <span className="admin-quick-bill__total-label">Customer total</span>
                <span className="admin-quick-bill__total-value admin-quick-bill__total-value--inline">
                  {previewBusy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : totalInr}
                </span>
              </div>
            </div>
          ) : (
            <div className="admin-quick-bill__total-block admin-quick-bill__total-block--inline">
              <span className="admin-quick-bill__total-label">Customer total (Selling Price)</span>
              <span className="admin-quick-bill__total-value admin-quick-bill__total-value--inline">
                {previewBusy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : totalInr}
              </span>
            </div>
          )}

          {canUseBargainMode && effectivePricingMode === 'bargain' && cart.length > 0 ? (
            <div className="admin-quick-bill__bargain-internal" aria-label="Internal bargain reference">
              <p className="admin-quick-bill__bargain-internal-title">Internal only — not sent to customer</p>
              <dl>
                <div className="admin-quick-bill__bargain-row">
                  <dt>Selling subtotal</dt>
                  <dd>{formatPreviewPaise(preview, 'sellingSubtotalPaise')}</dd>
                </div>
                <div className="admin-quick-bill__bargain-row">
                  <dt>Final subtotal</dt>
                  <dd>{formatPreviewPaise(preview, 'finalSubtotalPaise')}</dd>
                </div>
                <div className="admin-quick-bill__bargain-row">
                  <dt>Floor (Final + ₹500)</dt>
                  <dd>{formatPreviewPaise(preview, 'bargainFloorPaise')}</dd>
                </div>
              </dl>
              <label className="admin-field admin-quick-bill__accepted-field">
                <span className="admin-label">Accepted amount (₹)</span>
                <input
                  className="admin-input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={acceptedAmountInr}
                  onChange={(e) => setAcceptedAmountInr(e.target.value)}
                  placeholder="e.g. 1250"
                  autoComplete="off"
                />
              </label>
            </div>
          ) : null}
        </section>

        {canAssign && cart.length > 0 ? (
          <QuickBillAssigneeSelect
            id="quick-bill-checkout-assignee"
            value={assigneeUserId}
            onChange={setAssigneeUserId}
            users={assigneeUsers}
            loading={assigneesLoading}
            disabled={checkoutBusy}
            hint={assigneesError ?? 'Optional — assign after save if left unassigned.'}
          />
        ) : null}

        <footer className="admin-quick-bill__cart-footer">
          <div className="admin-quick-bill__footer-compact">
            <QuickBillCompactStats stats={billSummary} />
            <div className="admin-quick-bill__footer-total">
              <span className="admin-quick-bill__dock-total-label">Selling total</span>
              <span className="admin-quick-bill__total-value admin-quick-bill__total-value--dock">
                {previewBusy ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : totalInr}
              </span>
            </div>
          </div>
          <Button
            type="button"
            className="admin-touch-button admin-quick-bill__checkout-btn"
            disabled={
              cart.length === 0 ||
              previewBusy ||
              Boolean(previewError) ||
              checkoutBusy ||
              bargainAcceptedMissing
            }
            onClick={handleCheckoutClick}
          >
            {checkoutBusy ? 'Saving…' : 'Save bill & quotation'}
          </Button>
        </footer>
        <div className="admin-quick-bill__bottom-spacer" aria-hidden="true" />
      </div>

      <AdminConfirmDialog
        open={checkoutCustomerDialogOpen}
        title="Customer details incomplete"
        hideConfirm
        cancelLabel="Go back and fill in"
        onCancel={() => setCheckoutCustomerDialogOpen(false)}
        onConfirm={() => {}}
        description={
          <>
            <p>Fix the following before saving the bill and quotation:</p>
            <ul className="admin-confirm-dialog__issue-list">
              {customerFieldIssues.map((issue) => (
                <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </>
        }
      />
    </div>
  )
}
