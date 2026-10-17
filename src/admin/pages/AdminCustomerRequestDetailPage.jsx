import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { formatINR } from '../../utils/currency.js'
import {
  createQuotationForRequest,
  fetchAdminCustomerRequest,
  fetchQuotationForRequest,
  fetchQuotationWhatsApp,
  regenerateQuotationForRequest,
} from '../api/adminApi.js'
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
      await loadQuotation()
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [requestId, loadQuotation])

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
  }

  async function handlePrepareWhatsApp() {
    if (!quotation?.id) return
    setBusy(true)
    const res = await fetchQuotationWhatsApp(String(quotation.id))
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setWaMessage(String(res.data?.message ?? ''))
    setWhatsAppUrl(String(res.data?.whatsAppUrl ?? ''))
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

  return (
    <div className="admin-page admin-page--wide">
      <p>
        <Link to="/admin/customer-requests" className="admin-table__link">
          ← Requests
        </Link>
      </p>
      <h2 className="admin-page__title">Request {requestId}</h2>
      {error ? (
        <div className="admin-alert admin-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="admin-form__row">
        <div>
          <p>
            <strong>{String(request?.customerName ?? '')}</strong> · {String(request?.customerPhone ?? '')}
          </p>
          <p className="admin-hint">Status: {String(request?.status ?? '')}</p>
        </div>
      </div>
      <h3 className="admin-page__subtitle">Requested items</h3>
      <ul className="admin-list">
        {items.map((it) => (
          <li key={String(it.lineNumber)}>
            {String(it.productName)} ({String(it.productId)}) × {String(it.quantity)}
          </li>
        ))}
      </ul>
      <div className="admin-form__actions">
        <button type="button" className="admin-link-button" disabled={busy} onClick={handleCreateQuote}>
          {quotation ? 'Open existing quotation' : 'Create quotation'}
        </button>
        {quotation ? (
          <button type="button" className="admin-link-button" disabled={busy} onClick={handleRegenerate}>
            Regenerate quotation
          </button>
        ) : null}
        {quotation ? (
          <button type="button" className="admin-link-button" disabled={busy} onClick={handlePrepareWhatsApp}>
            Prepare WhatsApp message
          </button>
        ) : null}
      </div>
      {quotation ? (
        <div className="admin-panel">
          <h3>Quotation {String(quotation.id)}</h3>
          <p className="tabular-nums">Total: {formatINR(paiseToInrHelper(quotation.totalPaise))}</p>
          <ul className="admin-list">
            {(quotation.items ?? []).map((line) => (
              <li key={String(line.lineNumber)}>
                {String(line.productName)} × {String(line.quantity)} @{' '}
                {formatINR(paiseToInrHelper(line.unitRatePaise))} ={' '}
                {formatINR(paiseToInrHelper(line.lineTotalPaise))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {waMessage ? (
        <div className="admin-panel">
          <h3>WhatsApp preview</h3>
          <pre className="admin-pre">{waMessage}</pre>
          {whatsAppUrl ? (
            <a href={whatsAppUrl} target="_blank" rel="noreferrer" className="admin-table__link">
              Open WhatsApp (review before send)
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
