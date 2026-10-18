import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { formatINR } from '../../utils/currency.js'
import {
  createQuotationForRequest,
  fetchAdminCustomerRequest,
  fetchQuotationForRequest,
  fetchQuotationWhatsApp,
  patchAdminCustomerRequestStatus,
  regenerateQuotationForRequest,
} from '../api/adminApi.js'
import {
  formatRequestCreatedAt,
  formatShortRequestId,
} from '../lib/adminCustomerRequestDisplay.js'
import { copyTextToClipboard } from '../lib/copyToClipboard.js'
import {
  CUSTOMER_REQUEST_STATUSES,
  customerRequestStatusLabel,
  isTerminalCustomerRequestStatus,
} from '../lib/customerRequestStatus.js'
import { paiseToInrHelper } from '../lib/moneyDisplay.js'

export default function AdminCustomerRequestDetailPage() {
  const { id } = useParams()
  const requestId = String(id ?? '')
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
    setStatusMessage('Status saved.')
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

  const items = Array.isArray(request?.items) ? request.items : []
  const currentStatus = String(request?.status ?? statusValue)
  const statusTerminal = isTerminalCustomerRequestStatus(currentStatus)
  const quoteLines = Array.isArray(quotation?.items) ? quotation.items : []

  return (
    <div className="admin-page admin-page--wide admin-page--request-detail">
      <nav className="admin-request-detail__back">
        <Link to="/admin/customer-requests" className="admin-table__link">
          ← Customer requests
        </Link>
      </nav>

      <header className="admin-request-detail__header">
        <h2 className="admin-page__title admin-request-detail__title">Request details</h2>
        <p className="admin-request-detail__ref" title={requestId}>
          ID {formatShortRequestId(requestId)}
        </p>
      </header>

      {error ? (
        <div className="admin-alert admin-alert--error" role="alert">
          {error}
        </div>
      ) : null}

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
          <div className="admin-request-detail__dl-item--full">
            <dt>Received</dt>
            <dd>{formatRequestCreatedAt(request?.createdAt)}</dd>
          </div>
        </dl>
      </section>

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
          {statusMessage ? (
            <p className="admin-hint admin-hint--success" role="status">
              {statusMessage}
            </p>
          ) : null}
          {statusError ? (
            <p className="admin-field-error" role="alert">
              {statusError}
            </p>
          ) : null}
          {statusTerminal ? (
            <p id="request-status-terminal-hint" className="admin-hint admin-hint--warn">
              This request is in a terminal state ({customerRequestStatusLabel(currentStatus)}) and cannot be changed
              here.
            </p>
          ) : null}
        </div>
      </section>

      <section className="admin-request-detail__section admin-card admin-request-detail__card" aria-labelledby="request-items-heading">
        <h3 id="request-items-heading" className="admin-request-detail__section-title">
          Requested items
        </h3>
        <ul className="admin-request-detail__item-list">
          {items.map((it) => (
            <li key={String(it.lineNumber)} className="admin-request-detail__item-row">
              <span className="admin-request-detail__item-name">{String(it.productName)}</span>
              <span className="admin-request-detail__item-meta">
                {String(it.productId)} × {String(it.quantity)}
              </span>
            </li>
          ))}
        </ul>
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
              <p className="admin-request-detail__quote-total tabular-nums">
                {formatINR(paiseToInrHelper(quotation.totalPaise))}
              </p>
            </div>
            <div className="admin-form__actions admin-form__actions--start admin-request-detail__actions">
              <button
                type="button"
                className="admin-touch-button admin-touch-button--primary"
                disabled={busy}
                onClick={handlePrepareWhatsApp}
              >
                Prepare WhatsApp message
              </button>
              <button type="button" className="admin-touch-button admin-touch-button--secondary" disabled={busy} onClick={handleCreateQuote}>
                Open existing quotation
              </button>
              <button type="button" className="admin-touch-button admin-touch-button--secondary" disabled={busy} onClick={handleRegenerate}>
                Regenerate quotation
              </button>
            </div>
            <ul className="admin-request-detail__quote-lines admin-request-detail__quote-lines--breakdown">
              {quoteLines.map((line) => (
                <li key={String(line.lineNumber)} className="admin-request-detail__quote-line">
                  <span className="admin-request-detail__item-name">{String(line.productName)}</span>
                  <span className="admin-request-detail__item-meta tabular-nums">
                    × {String(line.quantity)} @ {formatINR(paiseToInrHelper(line.unitRatePaise))} ={' '}
                    {formatINR(paiseToInrHelper(line.lineTotalPaise))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="admin-hint admin-request-detail__quote-empty">Create a quotation to price this request with X4 rates.</p>
            <div className="admin-form__actions admin-form__actions--start admin-request-detail__actions">
              <button type="button" className="admin-touch-button admin-touch-button--primary" disabled={busy} onClick={handleCreateQuote}>
                Create quotation
              </button>
            </div>
          </>
        )}
      </section>

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
