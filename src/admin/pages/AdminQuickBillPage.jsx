import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { formatINR } from '../../utils/currency.js'
import { checkoutQuickBill, fetchAdminProductsPage, previewQuickBill } from '../api/adminApi.js'
import { paiseToInrHelper } from '../lib/moneyDisplay.js'
import AdminQuickBillProductThumb from '../components/AdminQuickBillProductThumb.jsx'
import { resolveQuickBillApiImageUrl } from '../lib/quickBillProductImage.js'
import {
  addProductToCart,
  cartItemCount,
  cartToCheckoutItems,
  removeCartLine,
  setCartLineQuantity,
} from '../lib/quickBillCart.js'

export default function AdminQuickBillPage() {
  const [query, setQuery] = useState('')
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
  const [success, setSuccess] = useState(
    /** @type {{ requestId: string, totalPaise: number } | null} */ (null),
  )

  const cartItemsPayload = useMemo(() => cartToCheckoutItems(cart), [cart])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) {
      setSearchResults([])
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchBusy(true)
      const res = await fetchAdminProductsPage({ q, page: 1, limit: 12 })
      if (!cancelled) {
        setSearchBusy(false)
        setSearchResults(res.ok ? /** @type {Record<string, unknown>[]} */ (res.products) : [])
      }
    }, 280)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const loadPreview = useCallback(async (items) => {
    if (items.length === 0) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    setPreviewBusy(true)
    setPreviewError(null)
    const res = await previewQuickBill(items)
    setPreviewBusy(false)
    if (!res.ok) {
      setPreview(null)
      const missing = res.missingProductIds?.length
        ? ` Missing X4 for: ${res.missingProductIds.join(', ')}.`
        : ''
      setPreviewError((res.message || 'Could not calculate total.') + missing)
      return
    }
    setPreview(/** @type {Record<string, unknown>} */ (res.preview))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPreview(cartItemsPayload)
    }, 320)
    return () => clearTimeout(timer)
  }, [cartItemsPayload, loadPreview])

  function handleAddProduct(product) {
    const id = String(product.id ?? '')
    const name = String(product.name ?? id)
    if (!id) return
    setSuccess(null)
    const productImageUrl = resolveQuickBillApiImageUrl(product)
    setCart((prev) => addProductToCart(prev, { productId: id, name, productImageUrl }, 1))
  }

  function handleCheckout() {
    setCheckoutBusy(true)
    setCheckoutError(null)
    checkoutQuickBill({
      customer: {
        name: customerName.trim(),
        mobile: customerMobile.trim(),
      },
      items: cartItemsPayload,
    }).then((res) => {
      setCheckoutBusy(false)
      if (!res.ok) {
        const missing = res.missingProductIds?.length
          ? ` Missing X4 for: ${res.missingProductIds.join(', ')}.`
          : ''
        setCheckoutError((res.message || 'Checkout failed.') + missing)
        return
      }
      const request = /** @type {{ id?: string }} */ (res.request)
      const quotation = /** @type {{ totalPaise?: number }} */ (res.quotation)
      setSuccess({
        requestId: String(request.id ?? ''),
        totalPaise: Number(quotation.totalPaise ?? 0),
      })
      setCart([])
      setPreview(null)
    })
  }

  const totalInr = preview ? formatINR(paiseToInrHelper(preview.totalPaise)) : '—'
  const itemCount = cartItemCount(cart)

  if (success?.requestId) {
    return (
      <div className="admin-page admin-quick-bill">
        <header className="admin-page__head">
          <h2 className="admin-page__title">Bill saved</h2>
          <p className="admin-muted">
            Quotation total {formatINR(paiseToInrHelper(success.totalPaise))} (X4 rates). No payment recorded.
          </p>
        </header>
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
    <div className="admin-page admin-quick-bill admin-quick-bill--with-dock">
      <header className="admin-page__head">
        <h2 className="admin-page__title">Quick bill</h2>
        <p className="admin-muted">Search products, build a cart, create a manual request with X4 quotation.</p>
      </header>

      <section className="admin-quick-bill__search" aria-label="Product search">
        <label className="admin-field">
          <span className="admin-label">Search name or ID</span>
          <span className="admin-quick-bill__search-wrap">
            <Search size={20} className="admin-quick-bill__search-icon" aria-hidden="true" />
            <input
              className="admin-input admin-quick-bill__search-input"
              type="search"
              inputMode="search"
              autoComplete="off"
              placeholder="e.g. P005 or emerald"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
        </label>
        {searchBusy ? (
          <p className="admin-muted admin-quick-bill__hint">
            <Loader2 size={16} className="inline animate-spin" aria-hidden="true" /> Searching…
          </p>
        ) : null}
        {searchResults.length > 0 ? (
          <ul className="admin-quick-bill__results">
            {searchResults.map((product) => {
              const id = String(product.id ?? '')
              const hasX4 = Boolean(product.hasX4SellingRate)
              const imageUrl = resolveQuickBillApiImageUrl(product)
              const name = String(product.name ?? '')
              return (
                <li key={id}>
                  <button type="button" className="admin-quick-bill__result-btn" onClick={() => handleAddProduct(product)}>
                    <AdminQuickBillProductThumb src={imageUrl} label={name} />
                    <span className="admin-quick-bill__result-text">
                      <span className="admin-quick-bill__result-id">{id}</span>
                      <span className="admin-quick-bill__result-name">{name}</span>
                    </span>
                    {!hasX4 ? (
                      <span className="admin-quick-bill__badge admin-quick-bill__badge--warn">No X4</span>
                    ) : (
                      <span className="admin-quick-bill__badge-spacer" aria-hidden="true" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <section className="admin-quick-bill__cart" aria-label="Cart">
        <h3 className="admin-quick-bill__section-title">Cart ({itemCount})</h3>
        {cart.length === 0 ? (
          <p className="admin-muted">Add products from search.</p>
        ) : (
          <ul className="admin-quick-bill__lines">
            {cart.map((line) => (
              <li key={line.productId} className="admin-quick-bill__line">
                <div className="admin-quick-bill__line-row">
                  <AdminQuickBillProductThumb src={line.productImageUrl ?? ''} label={line.name} />
                  <div className="admin-quick-bill__line-body">
                    <div className="admin-quick-bill__line-head">
                      <span className="admin-quick-bill__line-id">{line.productId}</span>
                      <button
                        type="button"
                        className="admin-quick-bill__icon-btn"
                        aria-label={`Remove ${line.name}`}
                        onClick={() => setCart((prev) => removeCartLine(prev, line.productId))}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <p className="admin-quick-bill__line-name">{line.name}</p>
                  </div>
                </div>
                <div className="admin-quick-bill__qty">
                  <button
                    type="button"
                    className="admin-quick-bill__qty-btn"
                    aria-label="Decrease quantity"
                    onClick={() =>
                      setCart((prev) => setCartLineQuantity(prev, line.productId, line.quantity - 1))
                    }
                  >
                    <Minus size={20} />
                  </button>
                  <span className="admin-quick-bill__qty-value">{line.quantity}</span>
                  <button
                    type="button"
                    className="admin-quick-bill__qty-btn"
                    aria-label="Increase quantity"
                    onClick={() =>
                      setCart((prev) => setCartLineQuantity(prev, line.productId, line.quantity + 1))
                    }
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-panel admin-quick-bill__customer">
        <h3 className="admin-quick-bill__section-title">Customer</h3>
        <div className="admin-form__row">
          <label className="admin-field">
            <span className="admin-label">Name</span>
            <input
              className="admin-input"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="admin-field">
            <span className="admin-label">Mobile (10 digits)</span>
            <input
              className="admin-input"
              type="tel"
              inputMode="numeric"
              value={customerMobile}
              onChange={(e) => setCustomerMobile(e.target.value)}
              autoComplete="tel"
              placeholder="9876543210"
            />
          </label>
        </div>
      </section>

      {previewError ? <p className="admin-error admin-quick-bill__dock-pad">{previewError}</p> : null}
      {checkoutError ? <p className="admin-error admin-quick-bill__dock-pad">{checkoutError}</p> : null}

      <div className="admin-quick-bill__dock" aria-live="polite">
        <div className="admin-quick-bill__dock-inner">
          <div className="admin-quick-bill__total-block">
            <span className="admin-quick-bill__total-label">Total (X4)</span>
            <span className="admin-quick-bill__total-value">
              {previewBusy ? <Loader2 size={22} className="animate-spin" aria-hidden="true" /> : totalInr}
            </span>
          </div>
          <Button
            type="button"
            className="admin-touch-button admin-quick-bill__checkout-btn"
            disabled={cart.length === 0 || previewBusy || Boolean(previewError) || checkoutBusy}
            onClick={handleCheckout}
          >
            {checkoutBusy ? 'Saving…' : 'Save bill & quotation'}
          </Button>
        </div>
      </div>
    </div>
  )
}
