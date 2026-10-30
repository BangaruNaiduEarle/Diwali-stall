import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { formatINR } from '../../utils/currency.js'
import {
  createQuotationForRequest,
  fetchAdminCustomerRequest,
  fetchQuotationForRequest,
  fetchOrderConfirmationWhatsApp,
  fetchQuotationWhatsApp,
  patchAdminCustomerRequestAssign,
  patchAdminCustomerRequestCustomerAgreed,
  patchAdminCustomerRequestFinalize,
  patchAdminCustomerRequestStatus,
  patchQuotationCustomerAgreedAmount,
  regenerateQuotationForRequest,
} from '../api/adminApi.js'
import AdminCustomerRequestQuotationLineCard from '../components/AdminCustomerRequestQuotationLineCard.jsx'
import QuickBillAssigneeSelect from '../components/QuickBillAssigneeSelect.jsx'
import AdminCustomerRequestAdjustBillPanel from '../components/AdminCustomerRequestAdjustBillPanel.jsx'
import AdminCustomerRequestWorkflowAudit from '../components/AdminCustomerRequestWorkflowAudit.jsx'
import {
  formatAdminPublicReference,
  formatRequestCreatedAt,
  formatShortRequestId,
} from '../lib/adminCustomerRequestDisplay.js'
import AdminConfirmDialog from '../components/AdminConfirmDialog.jsx'
import AdminFeedbackBanner from '../components/AdminFeedbackBanner.jsx'
import { copyTextToClipboard } from '../lib/copyToClipboard.js'
import {
  CUSTOMER_REQUEST_STATUSES,
  customerRequestStatusLabel,
  isTerminalCustomerRequestStatus,
} from '../lib/customerRequestStatus.js'
import { paiseToInrHelper } from '../lib/moneyDisplay.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { useQuickBillAssignees } from '../lib/quickBillAssignees.js'
import {
  canAssignQuickBillCustomerRequests,
  canFinalizeQuickBillCustomerRequests,
  canViewSensitiveProductPricing,
} from '../lib/adminRoles.js'
import { mergeQuotationLinesWithInternal } from '../lib/adminCustomerRequestQuotationDisplay.js'
import { formatAgreedBelowFinalDetailMessage } from '../lib/agreedBelowFinalWarningDisplay.js'
import { quotationIsBargainMode } from '../../lib/quotationBargainMode.js'
import {
  CUSTOMER_AGREED_AMOUNT_REQUIRED_BEFORE_FINALIZE,
  customerAgreedAmountReadyToFinalize,
  parseCustomerAgreedInrToPaise,
} from '../lib/customerRequestAgreedAmountFinalize.js'
import {
  internalSummaryHasVisibleContent,
  resolveInternalSummaryDisplay,
} from '../lib/adminCustomerRequestInternalSummary.js'
import {
  requestSourceUsesFinalizationWorkflow,
  stallBillFinalizationDisplay,
} from '../lib/stallBillFinalization.js'

/** @param {unknown} paise */
function formatPaiseOrDash(paise) {
  const p = Number(paise)
  if (!Number.isInteger(p) || p < 0) return '—'
  return formatINR(paiseToInrHelper(p))
}

export default function AdminCustomerRequestDetailPage() {
  const { id } = useParams()
  const requestId = String(id ?? '')
  const { role: adminRole } = useAdminSession()
  const canAssign = canAssignQuickBillCustomerRequests(adminRole)
  const { users: assigneeUsers, loading: assigneesLoading, error: assigneesError } =
    useQuickBillAssignees(canAssign)
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignError, setAssignError] = useState(/** @type {string | null} */ (null))
  const [assignMessage, setAssignMessage] = useState(/** @type {string | null} */ (null))
  const [finalizeBusy, setFinalizeBusy] = useState(false)
  const [finalizeError, setFinalizeError] = useState(/** @type {string | null} */ (null))
  const [finalizeMessage, setFinalizeMessage] = useState(/** @type {string | null} */ (null))
  const [agreementBusy, setAgreementBusy] = useState(false)
  const [agreementError, setAgreementError] = useState(/** @type {string | null} */ (null))
  const [agreementMessage, setAgreementMessage] = useState(/** @type {string | null} */ (null))
  const [request, setRequest] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [quotation, setQuotation] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [whatsAppUrl, setWhatsAppUrl] = useState(/** @type {string | null} */ (null))
  const [waMessage, setWaMessage] = useState('')
  const [copyFeedback, setCopyFeedback] = useState(/** @type {{ type: 'success' | 'error', text: string } | null} */ (null))
  const [copying, setCopying] = useState(false)
  const [statusValue, setStatusValue] = useState('')
  const [statusSaving, setStatusSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState(/** @type {string | null} */ (null))
  const [statusError, setStatusError] = useState(/** @type {string | null} */ (null))
  const [agreedAmountInr, setAgreedAmountInr] = useState('')
  const [agreedAmountBusy, setAgreedAmountBusy] = useState(false)
  const [agreedAmountError, setAgreedAmountError] = useState(/** @type {string | null} */ (null))
  const [agreedAmountMessage, setAgreedAmountMessage] = useState(/** @type {string | null} */ (null))
  const [finalizeDialog, setFinalizeDialog] = useState(
    /** @type {null | 'missing-agreed' | 'confirm-close'} */ (null),
  )

  const reloadRequest = useCallback(async () => {
    const res = await fetchAdminCustomerRequest(requestId)
    if (res.ok) {
      setRequest(res.request)
      setStatusValue(String(res.request?.status ?? ''))
    }
    return res
  }, [requestId])

  const loadQuotation = useCallback(async () => {
    const q = await fetchQuotationForRequest(requestId)
    if (q.ok && q.data?.quotation) {
      setQuotation(/** @type {Record<string, unknown>} */ (q.data.quotation))
    } else {
      setQuotation(null)
    }
  }, [requestId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchAdminCustomerRequest(requestId).then(async (res) => {
      if (cancelled) return
      if (!res.ok) {
        setError(res.message)
        setLoading(false)
        return
      }
      setRequest(res.request)
      setStatusValue(String(res.request?.status ?? ''))
      await loadQuotation()
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [requestId, loadQuotation])

  useEffect(() => {
    const saved = quotation?.acceptedAmountPaise
    if (saved == null || saved === '') {
      setAgreedAmountInr('')
      return
    }
    const p = Number(saved)
    if (Number.isInteger(p) && p >= 0) {
      setAgreedAmountInr(String(p / 100))
    }
  }, [quotation?.acceptedAmountPaise, quotation?.id])

  async function handleStatusChange(e) {
    const next = e.target.value
    const previous = String(request?.status ?? statusValue)
    if (next === previous) return

    setStatusValue(next)
    setStatusSaving(true)
    setStatusError(null)
    setStatusMessage(null)

    const res = await patchAdminCustomerRequestStatus(requestId, next)
    setStatusSaving(false)

    if (!res.ok) {
      setStatusValue(previous)
      setStatusError(res.message || 'Could not update status.')
      return
    }

    setRequest((prev) => (prev ? { ...prev, status: res.request.status } : prev))
    setStatusValue(res.request.status)
    setStatusMessage('Status updated successfully.')
  }

  async function handleCreateQuote() {
    setBusy(true)
    setError(null)
    const res = await createQuotationForRequest(requestId)
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setQuotation(/** @type {Record<string, unknown>} */ (res.data?.quotation))
    await reloadRequest()
  }

  async function handleRegenerate() {
    if (!window.confirm('Create a new quotation snapshot? The previous active quotation will be voided.')) return
    setBusy(true)
    setError(null)
    const res = await regenerateQuotationForRequest(requestId)
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setQuotation(/** @type {Record<string, unknown>} */ (res.data?.quotation))
    setWhatsAppUrl(null)
    setWaMessage('')
    setCopyFeedback(null)
    await reloadRequest()
  }

  async function handlePrepareOrderConfirmation() {
    setBusy(true)
    setCopyFeedback(null)
    const res = await fetchOrderConfirmationWhatsApp(requestId)
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setWaMessage(String(res.data?.message ?? ''))
    setWhatsAppUrl(String(res.data?.whatsAppUrl ?? ''))
  }

  async function handlePrepareWhatsApp() {
    if (!quotation?.id) return
    setBusy(true)
    setCopyFeedback(null)
    const res = await fetchQuotationWhatsApp(String(quotation.id))
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setWaMessage(String(res.data?.message ?? ''))
    setWhatsAppUrl(String(res.data?.whatsAppUrl ?? ''))
  }

  async function handleCopyMessage() {
    if (!waMessage) return
    setCopying(true)
    setCopyFeedback(null)
    const result = await copyTextToClipboard(waMessage)
    setCopying(false)
    if (result.ok) {
      setCopyFeedback({ type: 'success', text: result.message ?? 'Message copied to clipboard.' })
    } else {
      setCopyFeedback({ type: 'error', text: result.message ?? 'Could not copy to clipboard.' })
    }
  }

  if (loading) {
    return (
      <div className="admin-state">
        <Loader2 className="admin-state__icon animate-spin" aria-hidden="true" />
      </div>
    )
  }

  if (error && !request) {
    return (
      <div className="admin-alert admin-alert--error" role="alert">
        {error}
      </div>
    )
  }

  const currentStatus = String(request?.status ?? statusValue)
  const statusTerminal = isTerminalCustomerRequestStatus(currentStatus)
  const quoteLines = Array.isArray(quotation?.items) ? quotation.items : []
  const hasQuotation = Boolean(quotation?.id)
  const requestSource = String(request?.source ?? '')
  const canViewInternalPricing = canViewSensitiveProductPricing(adminRole)
  const internalPreview =
    canViewInternalPricing && quotation?.internalPricingPreview && typeof quotation.internalPricingPreview === 'object'
      ? /** @type {{ sellingSubtotalPaise?: number, finalSubtotalPaise?: number, bargainFloorPaise?: number }} */ (
          quotation.internalPricingPreview
        )
      : null
  const internalPricingView =
    canViewInternalPricing &&
    request?.internalPricingView &&
    typeof request.internalPricingView === 'object'
      ? /** @type {{ items?: unknown[], sellingSubtotalPaise?: number, finalSubtotalPaise?: number, bargainFloorPaise?: number }} */ (
          request.internalPricingView
        )
      : null
  const internalPricingItems = Array.isArray(internalPricingView?.items) ? internalPricingView.items : []
  const internalSummary =
    canViewInternalPricing && hasQuotation
      ? resolveInternalSummaryDisplay({
          quotation,
          internalPricingView,
          internalPricingPreview: internalPreview,
          requestSource,
        })
      : null
  const internalViewUsesSellingFinalFallback = internalPricingItems.some(
    (line) => /** @type {Record<string, unknown>} */ (line).finalUsesSellingFallback,
  )
  const showInternalSummary = Boolean(
    canViewInternalPricing && hasQuotation && internalSummaryHasVisibleContent(internalSummary),
  )
  const belowFinalDetailMessage =
    internalSummary?.belowFinalWarning != null
      ? formatAgreedBelowFinalDetailMessage(internalSummary.belowFinalWarning.shortfallPaise)
      : null
  const mergedQuotationLines = mergeQuotationLinesWithInternal(
    quoteLines,
    canViewInternalPricing ? internalPricingItems : [],
  )
  const showAgreedAmountForm = canViewInternalPricing && hasQuotation && !statusTerminal
  const finalizationStatus = String(request?.finalizationStatus ?? '').trim()
  const isPendingFinalization = finalizationStatus === 'pending'
  const isPendingManualBill = requestSource === 'manual' && isPendingFinalization
  const showAssignPanel = canAssign && isPendingManualBill
  const canFinalize = canFinalizeQuickBillCustomerRequests(adminRole)
  const showAdjustBillPanel = canFinalize && isPendingManualBill && hasQuotation
  const showFinalizePanel = canFinalize && isPendingFinalization
  const bargainModeQuotation = quotationIsBargainMode(
    /** @type {{ pricingMode?: string, bargainFloorPaise?: number | null, acceptedAmountPaise?: number | null }} */ (
      quotation
    ),
  )
  const agreedAmountReadyToFinalize = customerAgreedAmountReadyToFinalize(quotation, agreedAmountInr)
  const agreedAmountFinalizeBlocked =
    hasQuotation && isPendingFinalization && !agreedAmountReadyToFinalize
  const showAgreedAmountRequiredValidation =
    showAgreedAmountForm && isPendingFinalization && !agreedAmountReadyToFinalize
  const stallFinalization = stallBillFinalizationDisplay(request)
  const isFinalizedWorkflowRequest =
    requestSourceUsesFinalizationWorkflow(requestSource) && finalizationStatus === 'finalized'
  const showCustomerAgreedPanel =
    canFinalize &&
    requestSource === 'web' &&
    !finalizationStatus &&
    !isTerminalCustomerRequestStatus(currentStatus)
  const showCreateQuotation = !hasQuotation && !statusTerminal
  const showQuotationMessaging = hasQuotation && !statusTerminal
  const showRegenerateQuotation = showQuotationMessaging && requestSource === 'web'

  async function handleAssignBill() {
    if (!assigneeUserId.trim()) return
    setAssignBusy(true)
    setAssignError(null)
    setAssignMessage(null)
    const res = await patchAdminCustomerRequestAssign(requestId, { assigneeUserId: assigneeUserId.trim() })
    setAssignBusy(false)
    if (!res.ok) {
      setAssignError(res.message || 'Could not assign bill.')
      return
    }
    setRequest(res.request)
    setAssignMessage('Assignment saved.')
    setAssigneeUserId('')
    await reloadRequest()
    await loadQuotation()
  }

  async function handleCustomerAgreed() {
    if (!showCustomerAgreedPanel || agreementBusy) return
    if (
      !window.confirm(
        'Record that the customer agreed to proceed? This starts pending finalization (same as Quick Bill). Sending a quotation or WhatsApp does not record agreement.',
      )
    ) {
      return
    }
    setAgreementBusy(true)
    setAgreementError(null)
    setAgreementMessage(null)
    const res = await patchAdminCustomerRequestCustomerAgreed(requestId)
    setAgreementBusy(false)
    if (!res.ok) {
      setAgreementError(res.message || 'Could not record customer agreement.')
      return
    }
    setRequest(res.request)
    setAgreementMessage('Customer agreement recorded — pending finalization.')
  }

  async function handleSaveAgreedAmount() {
    if (!showAgreedAmountForm || agreedAmountBusy) return
    const parsed = parseCustomerAgreedInrToPaise(agreedAmountInr)
    if (!parsed.ok) {
      setAgreedAmountError(parsed.message ?? 'Invalid amount.')
      return
    }
    setAgreedAmountBusy(true)
    setAgreedAmountError(null)
    setAgreedAmountMessage(null)
    const res = await patchQuotationCustomerAgreedAmount(requestId, {
      acceptedAmountInr: String(agreedAmountInr).trim(),
    })
    setAgreedAmountBusy(false)
    if (!res.ok) {
      setAgreedAmountError(res.message || 'Could not save customer-agreed amount.')
      return
    }
    if (res.data?.quotation) {
      setQuotation(/** @type {Record<string, unknown>} */ (res.data.quotation))
    }
    await loadQuotation()
    setAgreedAmountMessage('Customer-agreed amount saved.')
  }

  function handleFinalizeBillClick() {
    if (!isPendingFinalization || finalizeBusy) return
    if (agreedAmountFinalizeBlocked) {
      setFinalizeDialog('missing-agreed')
      return
    }
    setFinalizeDialog('confirm-close')
  }

  async function executeFinalizeBill() {
    if (!isPendingFinalization || finalizeBusy) return
    if (agreedAmountFinalizeBlocked) {
      setFinalizeDialog('missing-agreed')
      return
    }
    setFinalizeBusy(true)
    setFinalizeError(null)
    setFinalizeMessage(null)
    const res = await patchAdminCustomerRequestFinalize(requestId)
    setFinalizeBusy(false)
    setFinalizeDialog(null)
    if (!res.ok) {
      setFinalizeError(res.message || 'Could not finalize bill.')
      return
    }
    setRequest(res.request)
    setStatusValue(String(res.request?.status ?? ''))
    setFinalizeMessage('Bill finalized and request closed.')
  }

  return (
    <div className="admin-page admin-page--wide admin-page--request-detail">
      <nav className="admin-request-detail__back">
        <Link to="/admin/customer-requests" className="admin-table__link">
          ← Customer requests
        </Link>
      </nav>

      <header className="admin-request-detail__header">
        <div className="admin-request-detail__title-row">
          <h2 className="admin-page__title admin-request-detail__title">Request details</h2>
          {stallFinalization ? (
            <span className={stallFinalization.badgeClass}>{stallFinalization.label}</span>
          ) : null}
        </div>
        <p className="admin-request-detail__ref" title={requestId}>
          Reference {formatAdminPublicReference(request?.publicReference)}
          <span className="admin-request-detail__ref-sep" aria-hidden="true">
            {' '}
            ·{' '}
          </span>
          ID {formatShortRequestId(requestId)}
        </p>
      </header>

      {error ? (
        <div className="admin-alert admin-alert--error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="admin-request-detail__section admin-card admin-request-detail__card" aria-labelledby="request-status-heading">
        <h3 id="request-status-heading" className="admin-request-detail__section-title">
          Status
        </h3>
        <div className="admin-field admin-field--status admin-request-detail__status-field">
          <label className="admin-label" htmlFor="request-status">
            Request status
          </label>
          <select
            id="request-status"
            className="admin-input"
            value={statusValue}
            onChange={handleStatusChange}
            disabled={statusTerminal || statusSaving || busy}
            aria-describedby={statusTerminal ? 'request-status-terminal-hint' : undefined}
          >
            {CUSTOMER_REQUEST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {customerRequestStatusLabel(value)}
              </option>
            ))}
          </select>
          {statusSaving ? (
            <p className="admin-hint" role="status">
              <Loader2 className="inline h-3.5 w-3.5 animate-spin align-[-2px]" aria-hidden="true" /> Saving status…
            </p>
          ) : null}
          <AdminFeedbackBanner
            variant="success"
            message={statusMessage}
            onDismiss={() => setStatusMessage(null)}
            className="mt-2"
          />
          <AdminFeedbackBanner
            variant="error"
            message={statusError}
            onDismiss={() => setStatusError(null)}
            className="mt-2"
          />
          {statusTerminal ? (
            <p id="request-status-terminal-hint" className="admin-hint admin-hint--warn">
              This request is in a terminal state ({customerRequestStatusLabel(currentStatus)}) and cannot be changed
              here.
            </p>
          ) : null}
        </div>
      </section>

      <section className="admin-request-detail__section admin-card admin-request-detail__card" aria-labelledby="request-customer-heading">
        <h3 id="request-customer-heading" className="admin-request-detail__section-title">
          Customer
        </h3>
        <dl className="admin-request-detail__dl">
          <div>
            <dt>Name</dt>
            <dd>{String(request?.customerName ?? '—')}</dd>
          </div>
          <div>
            <dt>Mobile</dt>
            <dd className="admin-request-detail__mono">{String(request?.customerPhone ?? '—')}</dd>
          </div>
          {request?.customerArea ? (
            <div>
              <dt>Area</dt>
              <dd>{String(request.customerArea)}</dd>
            </div>
          ) : null}
          {request?.pickupPreference ? (
            <div>
              <dt>Pickup</dt>
              <dd>{String(request.pickupPreference)}</dd>
            </div>
          ) : null}
          {request?.deliveryAddress ? (
            <div className="admin-request-detail__dl-item--full">
              <dt>Delivery address</dt>
              <dd>{String(request.deliveryAddress)}</dd>
            </div>
          ) : null}
          {request?.deliveryLandmark ? (
            <div>
              <dt>Landmark</dt>
              <dd>{String(request.deliveryLandmark)}</dd>
            </div>
          ) : null}
          {request?.deliveryMapsUrl ? (
            <div className="admin-request-detail__dl-item--full">
              <dt>Google Maps</dt>
              <dd className="admin-request-detail__mono break-all">{String(request.deliveryMapsUrl)}</dd>
            </div>
          ) : null}
          <div className="admin-request-detail__dl-item--full">
            <dt>Received</dt>
            <dd>{formatRequestCreatedAt(request?.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="admin-request-detail__section admin-card admin-request-detail__card" aria-labelledby="request-quote-actions-heading">
        <h3 id="request-quote-actions-heading" className="admin-request-detail__section-title">
          Quotation
        </h3>
        {quotation ? (
          <>
            <div className="admin-request-detail__quote-head">
              <p className="admin-request-detail__quote-id">
                <span className="admin-request-detail__quote-label">Ref</span>{' '}
                <span className="admin-request-detail__mono" title={String(quotation.id)}>
                  {formatShortRequestId(String(quotation.id))}
                </span>
              </p>
              <div className="admin-request-detail__quote-total-block">
                <span className="admin-request-detail__quote-total-label">Customer total (Selling)</span>
                <p className="admin-request-detail__quote-total tabular-nums">
                  {formatINR(paiseToInrHelper(quotation.totalPaise))}
                </p>
              </div>
            </div>
            {showQuotationMessaging || showRegenerateQuotation ? (
              <div className="admin-form__actions admin-form__actions--start admin-request-detail__actions admin-request-detail__quote-actions-top">
                {showQuotationMessaging ? (
                  <>
                    <button
                      type="button"
                      className="admin-touch-button admin-touch-button--primary"
                      disabled={busy}
                      onClick={handlePrepareWhatsApp}
                    >
                      Prepare quotation WhatsApp
                    </button>
                    <button
                      type="button"
                      className="admin-touch-button admin-touch-button--secondary"
                      disabled={busy}
                      onClick={handlePrepareOrderConfirmation}
                    >
                      Prepare order confirmation
                    </button>
                  </>
                ) : null}
                {showRegenerateQuotation ? (
                  <button
                    type="button"
                    className="admin-touch-button admin-touch-button--secondary"
                    disabled={busy}
                    onClick={handleRegenerate}
                  >
                    Regenerate quotation
                  </button>
                ) : null}
              </div>
            ) : null}
            {mergedQuotationLines.length > 0 ? (
              <>
                <p className="admin-hint admin-request-detail__bill-readonly-note">
                  Quantities and box vs loose pc are from the saved request (read-only here). Use Quick Bill to
                  create a new stall bill with different items.
                </p>
                <ul className="admin-request-detail__bill-lines">
                  {mergedQuotationLines.map((row, index) => {
                    const quote = row.quote
                    const internal = row.internal
                    const lineNumber = quote?.lineNumber ?? internal?.lineNumber ?? index + 1
                    const productName = String(quote?.productName ?? internal?.productName ?? '—')
                    const productCompany = internal?.company ?? quote?.company ?? null
                    const quantity = quote?.quantity ?? internal?.quantity
                    const sellingUnitPaise =
                      quote?.unitRatePaise != null
                        ? Number(quote.unitRatePaise)
                        : internal?.sellingUnitPaise != null
                          ? Number(internal.sellingUnitPaise)
                          : null
                    const sellingLinePaise =
                      quote?.lineTotalPaise != null
                        ? Number(quote.lineTotalPaise)
                        : internal?.sellingLinePaise != null
                          ? Number(internal.sellingLinePaise)
                          : null
                    return (
                      <li key={String(lineNumber)}>
                        <AdminCustomerRequestQuotationLineCard
                          productName={productName}
                          company={productCompany}
                          quantity={quantity}
                          unitType={internal?.unitType ?? null}
                          sellingUnitPaise={sellingUnitPaise}
                          sellingLinePaise={sellingLinePaise}
                          finalUnitPaise={internal?.finalUnitPaise ?? null}
                          finalLinePaise={internal?.finalLinePaise ?? null}
                          finalUsesSellingFallback={Boolean(internal?.finalUsesSellingFallback)}
                          showInternalFinal={canViewInternalPricing}
                        />
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : null}
            {showInternalSummary && internalSummary ? (
              <div className="admin-request-detail__internal-summary" aria-label="Internal pricing summary">
                <p className="admin-request-detail__internal-summary-label">
                  Internal summary
                  {internalSummary.headlineLabel ? (
                    <span className="admin-request-detail__estimate-tag">{internalSummary.headlineLabel}</span>
                  ) : null}
                </p>
                {internalSummary.isBargainMode ? (
                  <p className="admin-hint admin-request-detail__pricing-mode-note">Bargain mode (Quick Bill)</p>
                ) : null}
                {internalViewUsesSellingFinalFallback ? (
                  <p className="admin-hint admin-request-detail__final-fallback-note">
                    Final (Internal) uses catalogue Selling where no separate Final price is set (Quick Bill rule).
                  </p>
                ) : null}
                <dl className="admin-request-detail__summary-dl">
                  <div>
                    <dt>
                      Selling subtotal
                      {!internalSummary.sellingSubtotalIsSaved && internalSummary.sellingSubtotalPaise != null ? (
                        <span className="admin-request-detail__field-estimate-tag">est.</span>
                      ) : null}
                    </dt>
                    <dd className="tabular-nums">
                      {formatPaiseOrDash(internalSummary.sellingSubtotalPaise)}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      Final subtotal
                      {!internalSummary.finalSubtotalIsSaved && internalSummary.finalSubtotalPaise != null ? (
                        <span className="admin-request-detail__field-estimate-tag">est.</span>
                      ) : null}
                    </dt>
                    <dd className="tabular-nums">{formatPaiseOrDash(internalSummary.finalSubtotalPaise)}</dd>
                  </div>
                  {internalSummary.showBargainFloor ? (
                    <div>
                      <dt>
                        {internalSummary.isBargainMode
                          ? 'Bargain floor (Final + ₹500)'
                          : 'Reference floor (Final + ₹500)'}
                        {internalSummary.bargainFloorIsEstimate ? (
                          <span className="admin-request-detail__field-estimate-tag">est.</span>
                        ) : null}
                      </dt>
                      <dd className="tabular-nums">{formatPaiseOrDash(internalSummary.bargainFloorPaise)}</dd>
                    </div>
                  ) : null}
                  {internalSummary.acceptedAmountPaise != null ? (
                    <div className="admin-request-detail__summary-agreed">
                      <dt>Customer-agreed amount</dt>
                      <dd className="tabular-nums">
                        {formatPaiseOrDash(internalSummary.acceptedAmountPaise)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {belowFinalDetailMessage ? (
                  <p className="admin-alert admin-alert--warning admin-request-detail__below-final" role="status">
                    {belowFinalDetailMessage}
                  </p>
                ) : null}
              </div>
            ) : null}
            {showAgreedAmountForm ? (
              <div className="admin-request-detail__agreed-form">
                <p className="admin-hint">
                  Record the amount the customer agreed to pay at the stall. Internal only — not shown on quotations or
                  WhatsApp.
                  {isPendingFinalization ? ' Required before finalize.' : null}
                </p>
                <div className="admin-request-detail__agreed-row">
                  <label className="admin-label" htmlFor="customer-agreed-amount">
                    Customer-agreed amount (₹)
                    {isPendingFinalization ? (
                      <span className="admin-label__required" aria-hidden="true">
                        {' '}
                        *
                      </span>
                    ) : null}
                  </label>
                  <input
                    id="customer-agreed-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required={isPendingFinalization && hasQuotation}
                    inputMode="decimal"
                    className={`admin-input admin-request-detail__agreed-input${
                      showAgreedAmountRequiredValidation ? ' admin-request-detail__agreed-input--invalid' : ''
                    }`}
                    value={agreedAmountInr}
                    onChange={(e) => {
                      setAgreedAmountInr(e.target.value)
                      if (agreedAmountError) setAgreedAmountError(null)
                    }}
                    disabled={agreedAmountBusy || busy}
                    placeholder="e.g. 2500"
                    aria-invalid={showAgreedAmountRequiredValidation ? true : undefined}
                    aria-describedby={
                      showAgreedAmountRequiredValidation ? 'customer-agreed-amount-required-hint' : undefined
                    }
                  />
                  <button
                    type="button"
                    className="admin-touch-button admin-touch-button--secondary admin-request-detail__agreed-save"
                    disabled={agreedAmountBusy || busy || !String(agreedAmountInr).trim()}
                    onClick={handleSaveAgreedAmount}
                  >
                    {agreedAmountBusy ? 'Saving…' : 'Save agreed amount'}
                  </button>
                </div>
                {showAgreedAmountRequiredValidation ? (
                  <p
                    id="customer-agreed-amount-required-hint"
                    className="admin-field__error admin-request-detail__agreed-required-hint"
                    role="alert"
                  >
                    {CUSTOMER_AGREED_AMOUNT_REQUIRED_BEFORE_FINALIZE}
                  </p>
                ) : null}
                <AdminFeedbackBanner
                  variant="success"
                  message={agreedAmountMessage}
                  onDismiss={() => setAgreedAmountMessage(null)}
                  className="mt-2"
                />
                <AdminFeedbackBanner
                  variant="error"
                  message={agreedAmountError}
                  onDismiss={() => setAgreedAmountError(null)}
                  className="mt-2"
                />
              </div>
            ) : null}
          </>
        ) : showCreateQuotation ? (
          <>
            <p className="admin-hint admin-request-detail__quote-empty">
              Create a quotation to price this request using selling prices.
            </p>
            <div className="admin-form__actions admin-form__actions--start admin-request-detail__actions">
              <button
                type="button"
                className="admin-touch-button admin-touch-button--primary"
                disabled={busy}
                onClick={handleCreateQuote}
              >
                Create quotation
              </button>
            </div>
          </>
        ) : (
          <p className="admin-hint admin-request-detail__quote-empty">No active quotation for this request.</p>
        )}
      </section>

      {showCustomerAgreedPanel ? (
        <section
          className="admin-request-detail__section admin-card admin-request-detail__card"
          aria-labelledby="request-customer-agreed-heading"
        >
          <h3 id="request-customer-agreed-heading" className="admin-request-detail__section-title">
            Customer agreement
          </h3>
          <p className="admin-hint">
            Owner / Super Admin only. Use after the customer confirms they want to proceed. Not recorded
            automatically when you create a quotation or prepare WhatsApp.
          </p>
          <div className="admin-form__actions admin-form__actions--start admin-request-detail__actions">
            <button
              type="button"
              className="admin-touch-button admin-touch-button--primary"
              disabled={agreementBusy || busy}
              onClick={handleCustomerAgreed}
            >
              {agreementBusy ? 'Saving…' : 'Customer agreed — pending finalization'}
            </button>
          </div>
          <AdminFeedbackBanner
            variant="success"
            message={agreementMessage}
            onDismiss={() => setAgreementMessage(null)}
            className="mt-2"
          />
          <AdminFeedbackBanner
            variant="error"
            message={agreementError}
            onDismiss={() => setAgreementError(null)}
            className="mt-2"
          />
        </section>
      ) : null}

      {showAssignPanel ? (
        <section
          className="admin-request-detail__section admin-card admin-request-detail__card"
          aria-labelledby="request-assign-heading"
        >
          <h3 id="request-assign-heading" className="admin-request-detail__section-title">
            Stall bill assignment
          </h3>
          {request?.assignedToEmail ? (
            <p className="admin-hint">
              Assigned to{' '}
              <span className="admin-request-detail__mono">{String(request.assignedToEmail)}</span>
            </p>
          ) : (
            <p className="admin-hint">Pending finalization — assign an Owner or Super Admin.</p>
          )}
          <QuickBillAssigneeSelect
            id="request-detail-assignee"
            value={assigneeUserId}
            onChange={setAssigneeUserId}
            users={assigneeUsers}
            loading={assigneesLoading}
            disabled={assignBusy}
            hint={assigneesError}
          />
          <div className="admin-form__actions admin-form__actions--start admin-request-detail__actions">
            <button
              type="button"
              className="admin-touch-button admin-touch-button--secondary"
              disabled={assignBusy || !assigneeUserId.trim()}
              onClick={handleAssignBill}
            >
              {assignBusy ? 'Saving…' : 'Save assignment'}
            </button>
          </div>
          <AdminFeedbackBanner
            variant="success"
            message={assignMessage}
            onDismiss={() => setAssignMessage(null)}
            className="mt-2"
          />
          <AdminFeedbackBanner
            variant="error"
            message={assignError}
            onDismiss={() => setAssignError(null)}
            className="mt-2"
          />
        </section>
      ) : null}

      {showAdjustBillPanel ? (
        <section
          className="admin-request-detail__section admin-card admin-request-detail__card"
          aria-labelledby="request-adjust-bill-heading"
        >
          <h3 id="request-adjust-bill-heading" className="admin-request-detail__section-title">
            Adjust bill before finalize
          </h3>
          <AdminCustomerRequestAdjustBillPanel
            requestId={requestId}
            requestItems={Array.isArray(request?.items) ? request.items : []}
            pricingMode={bargainModeQuotation ? 'bargain' : 'selling'}
            disabled={busy || finalizeBusy}
            onAdjusted={async (payload) => {
              await reloadRequest()
              await loadQuotation()
              if (payload.savedAcceptedAmount) {
                setAgreedAmountMessage('Customer-agreed amount saved with adjusted bill.')
              } else {
                setAgreedAmountMessage(null)
              }
            }}
          />
        </section>
      ) : null}

      <AdminConfirmDialog
        open={finalizeDialog === 'missing-agreed'}
        title="Customer-agreed amount required"
        hideConfirm
        description={
          <>
            <p>
              This bill cannot be finalized or closed until the customer-agreed amount is saved. Internal audit would
              be incomplete without it — the system will not store ₹0 or guess an amount.
            </p>
            <p className="mt-2">Record the amount in Internal summary (or when saving an adjusted bill), then finalize.</p>
          </>
        }
        cancelLabel="Go back and record amount"
        confirming={finalizeBusy}
        onCancel={() => setFinalizeDialog(null)}
        onConfirm={() => {}}
      />
      <AdminConfirmDialog
        open={finalizeDialog === 'confirm-close'}
        title="Finalize and close request?"
        description="Status becomes Closed. Quotation totals and WhatsApp stay on Selling Price only."
        cancelLabel="Cancel"
        confirmLabel="Finalize and close"
        confirming={finalizeBusy}
        onCancel={() => setFinalizeDialog(null)}
        onConfirm={executeFinalizeBill}
      />

      {showFinalizePanel ? (
        <section
          className="admin-request-detail__section admin-card admin-request-detail__card"
          aria-labelledby="request-finalize-heading"
        >
          <h3 id="request-finalize-heading" className="admin-request-detail__section-title">
            Finalize
          </h3>
          <p className="admin-hint">
            Owner / Super Admin only. Finalizes and closes the request in one step. Customer quotation and
            WhatsApp stay Selling Price-only.
          </p>
          <div className="admin-form__actions admin-form__actions--start admin-request-detail__actions">
            <button
              type="button"
              className="admin-touch-button admin-touch-button--primary"
              disabled={finalizeBusy || busy || agreedAmountFinalizeBlocked}
              onClick={handleFinalizeBillClick}
            >
              {finalizeBusy ? 'Finalizing…' : 'Finalize bill'}
            </button>
          </div>
          <AdminFeedbackBanner
            variant="success"
            message={finalizeMessage}
            onDismiss={() => setFinalizeMessage(null)}
            className="mt-2"
          />
          <AdminFeedbackBanner
            variant="error"
            message={finalizeError}
            onDismiss={() => setFinalizeError(null)}
            className="mt-2"
          />
        </section>
      ) : null}

      {isFinalizedWorkflowRequest ? (
        <section
          className="admin-request-detail__section admin-card admin-request-detail__card admin-request-detail__stall-done"
          aria-label="Request finalized"
        >
          <p className="admin-hint admin-request-detail__stall-done-text">
            This request is <strong>finalized</strong>
            {String(request?.status ?? '') === 'closed' ? (
              <>
                {' '}
                and <strong>closed</strong>
              </>
            ) : null}
            . No further status changes are required.
          </p>
          <AdminCustomerRequestWorkflowAudit request={/** @type {Record<string, unknown>} */ (request)} />
        </section>
      ) : null}

      {waMessage ? (
        <section className="admin-request-detail__section admin-card admin-request-detail__card" aria-labelledby="request-wa-heading">
          <h3 id="request-wa-heading" className="admin-request-detail__section-title">
            WhatsApp message
          </h3>
          <pre className="admin-pre admin-request-detail__wa-pre">{waMessage}</pre>
          <div className="admin-request-detail__wa-actions">
            <button
              type="button"
              className="admin-touch-button admin-touch-button--secondary admin-request-detail__copy-btn"
              disabled={copying || !waMessage}
              onClick={handleCopyMessage}
            >
              {copying ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              Copy message
            </button>
            {whatsAppUrl ? (
              <a
                href={whatsAppUrl}
                target="_blank"
                rel="noreferrer"
                className="admin-touch-button admin-touch-button--primary admin-request-detail__wa-open"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open WhatsApp
              </a>
            ) : null}
          </div>
          {copyFeedback ? (
            <p
              className={copyFeedback.type === 'success' ? 'admin-hint admin-hint--success' : 'admin-field-error'}
              role={copyFeedback.type === 'success' ? 'status' : 'alert'}
            >
              {copyFeedback.text}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
