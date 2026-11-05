import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react'
import { formatINR } from '../../utils/currency.js'
import { buildAgreedBelowFinalWarning } from '../../lib/agreedBelowFinalWarning.js'
import { formatAgreedBelowFinalDetailMessage } from '../lib/agreedBelowFinalWarningDisplay.js'
import {
  fetchAdminProductsPage,
  patchAdminCustomerRequestAdjustBill,
  previewAdminCustomerRequestAdjustBill,
} from '../api/adminApi.js'
import AdminProductNameWithCompany from './AdminProductNameWithCompany.jsx'
import {
  addProductToCart,
  removeCartLine,
  setCartLineQuantity,
} from '../lib/quickBillCart.js'
import {
  customerRequestItemsToAdjustCart,
} from '../lib/adminCustomerRequestAdjustBillCart.js'
import { paiseToInrHelper } from '../lib/moneyDisplay.js'
import { resolveQuickBillApiImageUrl } from '../lib/quickBillProductImage.js'
import { adjustmentPayload, draftHasNewerRevision, paiseInputValue } from '../lib/billAdjustment.js'

/** @param {number | null | undefined} paise */
function formatPaiseLabel(paise) {
  if (paise == null) return '—'
  const p = Number(paise)
  if (!Number.isInteger(p) || p < 0) return '—'
  return formatINR(paiseToInrHelper(p))
}

/** @param {{
 *   requestId: string,
 *   requestItems: unknown[],
 *   pricingMode?: string,
 *   disabled?: boolean,
 *   onAdjusted?: (payload: { clearedAcceptedAmount?: boolean, savedAcceptedAmount?: boolean }) => void,
 * }} props */
export default function AdminCustomerRequestAdjustBillPanel({
  requestId,
  requestItems,
  pricingMode = 'selling',
  privileged = false,
  revision = null,
  discountPaise = 0,
  onReload,
  disabled = false,
  onAdjusted,
}) {
  const bargainMode = pricingMode === 'bargain'
  const dirty = useRef(false)
  const [draftRevision, setDraftRevision] = useState(revision)
  const draftRevisionRef = useRef(revision)
  const [conflict, setConflict] = useState(false)
  const [discountInr, setDiscountInr] = useState(paiseInputValue(discountPaise))
  const [cart, setCart] = useState(() => customerRequestItemsToAdjustCart(requestItems))
  const [query, setQuery] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchResults, setSearchResults] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState(/** @type {string | null} */ (null))
  const [preview, setPreview] = useState(
    /** @type {{
     *   customerSellingSubtotalPaise?: number | null,
     *   sellingSubtotalPaise?: number | null,
     *   finalSubtotalPaise?: number | null,
     *   bargainFloorPaise?: number | null,
     * } | null} */ (null),
  )
  const [agreedAmountInr, setAgreedAmountInr] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState(/** @type {string | null} */ (null))
  const [saveMessage, setSaveMessage] = useState(/** @type {string | null} */ (null))

  useEffect(() => {
    if (dirty.current) {
      if (draftHasNewerRevision(draftRevisionRef.current, revision, true)) setConflict(true)
      return
    }
    setCart(customerRequestItemsToAdjustCart(requestItems))
    setDraftRevision(revision)
    draftRevisionRef.current = revision
    setDiscountInr(paiseInputValue(discountPaise))
    setAgreedAmountInr('')
    setSaveMessage(null)
  }, [requestItems, revision, discountPaise])

  const previewPayload = useMemo(() => adjustmentPayload(cart, { privileged, discountInr }), [cart, privileged, discountInr])

  const loadPreview = useCallback(async (isCancelled) => {
    if (!cart.length) {
      setPreview(null)
      setPreviewError(null)
      setPreviewBusy(false)
      return
    }
    setPreviewBusy(true)
    setPreviewError(null)
    if (!previewPayload.ok) { setPreviewError(previewPayload.message); setPreviewBusy(false); return }
    const res = await previewAdminCustomerRequestAdjustBill(requestId, previewPayload.body, { revision: draftRevision })
    if (isCancelled()) return
    setPreviewBusy(false)
    if (!res.ok) {
      if (res.status === 409) setConflict(true)
      setPreviewError(res.message || 'Could not preview adjusted bill.')
      setPreview(null)
      return
    }
    setPreview(/** @type {typeof preview} */ (res.preview))
  }, [cart.length, previewPayload, requestId, draftRevision])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => loadPreview(() => cancelled), 280)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [loadPreview])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) {
      setSearchResults([])
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchBusy(true)
      const res = await fetchAdminProductsPage({ q, page: 1, limit: 8, flexSearch: true })
      if (!cancelled) {
        setSearchBusy(false)
        setSearchResults(res.ok ? /** @type {Record<string, unknown>[]} */ (res.products) : [])
      }
    }, 260)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const agreedPaisePreview = useMemo(() => {
    const trimmed = String(agreedAmountInr ?? '').trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) return null
    const paise = Math.round(n * 100)
    return Number.isInteger(paise) && paise >= 0 ? paise : null
  }, [agreedAmountInr])

  const belowFinalMessage = useMemo(() => {
    if (!bargainMode || agreedPaisePreview == null) return null
    const warning = buildAgreedBelowFinalWarning(agreedPaisePreview, preview?.finalSubtotalPaise)
    return warning ? formatAgreedBelowFinalDetailMessage(warning.shortfallPaise) : null
  }, [agreedPaisePreview, bargainMode, preview?.finalSubtotalPaise])

  function handleAddProduct(product, unitType = 'box') {
    const id = String(product.id ?? '')
    const name = String(product.name ?? id)
    if (!id) return
    const company =
      product.company != null && String(product.company).trim()
        ? String(product.company).trim()
        : null
    editCart((prev) =>
      addProductToCart(
        prev,
        {
          productId: id,
          name,
          company,
          productImageUrl: resolveQuickBillApiImageUrl(product),
          allowLooseSale: Boolean(product.allowLooseSale),
        },
        1,
        unitType === 'piece' ? 'piece' : 'box',
      ),
    )
    setSaveMessage(null)
  }

  function editCart(update) { dirty.current = true; setCart(update) }

  async function handleSave() {
    if (saveBusy || disabled || conflict || !cart.length) return
    setSaveBusy(true)
    setSaveError(null)
    setSaveMessage(null)
    const parsed = adjustmentPayload(cart, { privileged, discountInr, agreedAmountInr: bargainMode ? agreedAmountInr : '' })
    if (!parsed.ok) { setSaveError(parsed.message); setSaveBusy(false); return }
    const body = parsed.body
    const res = await patchAdminCustomerRequestAdjustBill(requestId, body, { revision: draftRevision })
    setSaveBusy(false)
    if (!res.ok) {
      if (res.status === 409) setConflict(true)
      setSaveError(res.message || 'Could not save adjusted bill.')
      return
    }
    dirty.current = false
    setConflict(false)
    setDraftRevision(res.request.revision)
    draftRevisionRef.current = res.request.revision
    const parts = ['Adjusted bill saved. Prior quotation voided; customer-facing totals updated.']
    if (bargainMode && !body.acceptedAmountInr) {
      parts.push('Record customer-agreed amount before finalizing.')
    }
    setSaveMessage(parts.join(' '))
    onAdjusted?.({
      clearedAcceptedAmount: Boolean(res.clearedAcceptedAmount),
      savedAcceptedAmount: Boolean(res.savedAcceptedAmount),
    })
  }

  return (
    <div className="admin-request-detail__adjust-bill">
      <p className="admin-hint">
        Change products or quantities before finalize. Saving voids the previous
        quotation and never carries over a prior customer-agreed amount.
      </p>
      {conflict ? <div className="admin-alert admin-alert--warning" role="alert">
        This request changed. Your draft has been kept. Reload the latest request before making further edits.
        <button type="button" className="admin-touch-button" onClick={async () => { dirty.current = false; setConflict(false); await onReload?.() }}>Reload latest request</button>
      </div> : null}
      <label className="admin-field admin-quick-bill__search-field admin-request-detail__adjust-search">
        <span className="admin-label">Add product</span>
        <span className="admin-quick-bill__search-wrap">
          <Search size={18} className="admin-quick-bill__search-icon" aria-hidden="true" />
          <input
            className="admin-input admin-quick-bill__search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, company, or ID"
            disabled={disabled || saveBusy}
          />
        </span>
      </label>
      {searchBusy ? (
        <p className="admin-hint" role="status">
          <Loader2 className="inline h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Searching…
        </p>
      ) : null}
      {searchResults.length > 0 ? (
        <ul className="admin-quick-bill__results admin-request-detail__adjust-results">
          {searchResults.map((product) => {
            const id = String(product.id ?? '')
            const name = String(product.name ?? '')
            const allowLoose = Boolean(product.allowLooseSale) && Boolean(product.hasSellingPrice)
            return (
              <li key={id} className="admin-quick-bill__product admin-request-detail__adjust-product">
                <button
                  type="button"
                  className="admin-request-detail__adjust-add-box admin-quick-bill__product-add"
                  onClick={() => handleAddProduct(product, 'box')}
                  disabled={disabled || saveBusy}
                >
                  <AdminProductNameWithCompany name={name} company={product.company} />
                  <span className="admin-request-detail__adjust-add-label">+ Box</span>
                </button>
                {allowLoose ? (
                  <button
                    type="button"
                    className="admin-request-detail__adjust-add-piece admin-quick-bill__product-add-piece"
                    onClick={() => handleAddProduct(product, 'piece')}
                    disabled={disabled || saveBusy}
                  >
                    + pc
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      <ul className="admin-request-detail__adjust-lines">
        {cart.map((line) => {
          const unitType = line.unitType === 'piece' ? 'piece' : 'box'
          const unitLabel = unitType === 'piece' ? 'Loose pc' : 'Box'
          return (
            <li key={`${line.productId}-${unitType}`} className="admin-request-detail__adjust-line">
              <AdminProductNameWithCompany name={line.name} company={line.company} />
              <span className="admin-request-detail__adjust-line-meta">{unitLabel}</span>
              <div className="admin-request-detail__adjust-qty">
                <button
                  type="button"
                  className="admin-quick-bill__qty-btn"
                  aria-label={`Decrease ${unitLabel}`}
                  disabled={disabled || saveBusy}
                  onClick={() =>
                    editCart((prev) =>
                      setCartLineQuantity(prev, line.productId, line.quantity - 1, unitType),
                    )
                  }
                >
                  <Minus size={18} aria-hidden="true" />
                </button>
                <span className="tabular-nums">{line.quantity}</span>
                <button
                  type="button"
                  className="admin-quick-bill__qty-btn"
                  aria-label={`Increase ${unitLabel}`}
                  disabled={disabled || saveBusy}
                  onClick={() =>
                    editCart((prev) =>
                      setCartLineQuantity(prev, line.productId, line.quantity + 1, unitType),
                    )
                  }
                >
                  <Plus size={18} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                className="admin-request-detail__adjust-remove"
                aria-label={`Remove ${line.name}`}
                disabled={disabled || saveBusy}
                onClick={() => editCart((prev) => removeCartLine(prev, line.productId, unitType))}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
              {privileged ? <label className="admin-field">
                <span className="admin-label">Selling price per {unitType === 'piece' ? 'piece' : 'box'} (₹)</span>
                <input className="admin-input" inputMode="decimal" value={line.priceInr ?? ''} placeholder="Keep saved price"
                  disabled={disabled || saveBusy || conflict} onChange={event => editCart(previous => previous.map(item => item === line ? { ...item, priceInr: event.target.value } : item))} />
              </label> : null}
            </li>
          )
        })}
      </ul>

      <div className="admin-request-detail__adjust-summary" aria-live="polite">
        <h4 className="admin-request-detail__adjust-summary-title">Adjusted bill summary</h4>
        <dl className="admin-request-detail__summary-dl admin-request-detail__adjust-summary-dl">
          <div>
            <dt>Bill total</dt>
            <dd className="tabular-nums">
              {previewBusy ? '…' : formatPaiseLabel(preview?.totalPaise)}
            </dd>
          </div>
          {privileged ? <div>
            <dt>Adjusted Final subtotal</dt>
            <dd className="tabular-nums">
              {previewBusy ? '…' : formatPaiseLabel(preview?.finalSubtotalPaise)}
            </dd>
          </div> : null}
        </dl>
        {previewError ? (
          <p className="admin-alert admin-alert--error" role="alert">
            {previewError}
          </p>
        ) : null}
      </div>

      {privileged ? <label className="admin-field">
        <span className="admin-label">Bill discount (₹)</span>
        <input className="admin-input" inputMode="decimal" value={discountInr} disabled={disabled || saveBusy || conflict}
          onChange={event => { dirty.current = true; setDiscountInr(event.target.value) }} />
      </label> : null}

      {privileged && bargainMode ? (
        <div className="admin-request-detail__adjust-agreed">
          <label className="admin-field" htmlFor={`adjust-agreed-${requestId}`}>
            <span className="admin-label">Customer-agreed amount (₹)</span>
            <span className="admin-hint">
              Enter what the customer agrees to pay. The reference amount is guidance only — not the agreed
              amount.
            </span>
            <input
              id={`adjust-agreed-${requestId}`}
              type="text"
              inputMode="decimal"
              className="admin-input"
              value={agreedAmountInr}
              onChange={(e) => { dirty.current = true; setAgreedAmountInr(e.target.value) }}
              placeholder="Optional until customer confirms"
              disabled={disabled || saveBusy}
            />
          </label>
          {belowFinalMessage ? (
            <p className="admin-alert admin-alert--warning" role="status">
              {belowFinalMessage}
            </p>
          ) : null}
          <p className="admin-hint">
            You can save the adjusted bill without an agreed amount, but finalize stays blocked until it is saved.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        className="admin-touch-button admin-touch-button--secondary"
        disabled={disabled || saveBusy || conflict || !cart.length || previewBusy || !Number.isSafeInteger(draftRevision)}
        onClick={handleSave}
      >
        {saveBusy ? 'Saving…' : 'Save adjusted bill'}
      </button>
      {saveMessage ? (
        <p className="admin-alert admin-alert--success" role="status">
          {saveMessage}
        </p>
      ) : null}
      {saveError ? (
        <p className="admin-alert admin-alert--error" role="alert">
          {saveError}
        </p>
      ) : null}
    </div>
  )
}
