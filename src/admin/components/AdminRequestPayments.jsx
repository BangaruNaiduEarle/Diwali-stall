import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRequestPayments, recordRequestPayment } from '../api/adminPayments.js'
import { createPaymentOperationKeys, formatPaymentPaise, paymentPayload, PAYMENT_METHOD_OPTIONS, PAYMENT_MODE_OPTIONS } from '../lib/payments.js'
import AdminPaymentSummary from './AdminPaymentSummary.jsx'

export default function AdminRequestPayments({ requestId, contextKey, initialSummary, canRecord = false, disabled = false, onRecorded }) {
  const [summary, setSummary] = useState(initialSummary ?? null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [entryType, setEntryType] = useState('PAYMENT')
  const [amountInr, setAmountInr] = useState('')
  const [recordingMode, setRecordingMode] = useState('ONLINE')
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const [details, setDetails] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const pending = useRef(false)
  const [keys] = useState(() => createPaymentOperationKeys())

  const load = useCallback((isCancelled = () => false) => fetchRequestPayments(requestId).then(result => {
    if (isCancelled()) return
    setLoading(false)
    if (!result.ok) { setLoadError(result.message); return }
    setLoadError(null); setSummary(result.summary); setEntries(result.entries); setHasMore(result.entries.length === 50)
  }), [requestId])
  useEffect(() => { let cancelled = false; load(() => cancelled); return () => { cancelled = true } }, [load])

  async function submit(event) {
    event.preventDefault()
    if (pending.current || disabled || !canRecord || !summary?.eligible || loading || loadError) return
    const parsed = paymentPayload({ entryType, amountInr, recordingMode, paymentMethod, reference, details, occurredAt })
    if (!parsed.ok) { setError(parsed.message); return }
    const operationId = keys.forEntry(parsed.body, `${contextKey}:${requestId}`)
    pending.current = true; setBusy(true); setError(null); setMessage(null)
    try {
      const result = await recordRequestPayment(requestId, { ...parsed.body, operationId }, { revision: summary.revision })
      if (!result.ok) { setError(result.message || 'Payment was not confirmed. Retry the same details.'); return }
      keys.complete()
      setSummary(result.summary)
      setEntries(previous => hasMore || previous.some(row => row.paymentId === result.entry.paymentId) ? previous : [...previous, result.entry])
      setAmountInr(''); setReference(''); setDetails(''); setOccurredAt('')
      setMessage(`${result.idempotentReplay ? 'Previously recorded entry confirmed.' : 'Payment ledger updated.'} Payment ID: ${result.entry.paymentId}`)
      await onRecorded?.()
    } finally { pending.current = false; setBusy(false) }
  }

  async function loadMore() {
    if (pending.current || !entries.length) return
    pending.current = true; setBusy(true)
    try {
      const result = await fetchRequestPayments(requestId, { afterSequence: entries.at(-1).sequence })
      if (!result.ok) { setError(result.message); return }
      setSummary(result.summary)
      setEntries(previous => [...previous, ...result.entries.filter(item => !previous.some(row => row.paymentId === item.paymentId))])
      setHasMore(result.entries.length === 50)
    } finally { pending.current = false; setBusy(false) }
  }

  const formDisabled = disabled || busy || loading || Boolean(loadError)
  return <section className="admin-request-detail__section admin-card" aria-labelledby="request-payments-heading">
    <h3 id="request-payments-heading">Payments</h3>
    <AdminPaymentSummary summary={summary} />
    <p className="admin-hint">Payment status is separate from request closure and bargaining status.</p>
    <button type="button" className="admin-touch-button admin-touch-button--secondary" disabled={busy || loading} onClick={() => { setLoading(true); load() }}>Refresh payments</button>
    {loading ? <p role="status">Loading payment history…</p> : null}
    {loadError ? <p className="admin-alert admin-alert--error" role="alert">{loadError}</p> : null}
    {error ? <p className="admin-alert admin-alert--error" role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {!summary?.eligible && !loading ? <p className="admin-hint">Payments can be recorded after finalization with a saved customer-agreed amount.</p> : null}
    {canRecord && summary?.eligible ? <form onSubmit={submit}>
      <fieldset disabled={formDisabled}>
        <label className="admin-field"><span className="admin-label">Action</span>
          <select className="admin-input" value={entryType} onChange={event => setEntryType(event.target.value)}>
            <option value="PAYMENT">Record payment</option><option value="HOLD">Place payment hold</option><option value="RELEASE_HOLD">Release payment hold</option>
          </select>
        </label>
        {entryType === 'PAYMENT' ? <>
          <label className="admin-field"><span className="admin-label">Received amount (₹)</span><input className="admin-input" inputMode="decimal" required value={amountInr} onChange={event => setAmountInr(event.target.value)} /></label>
          <label className="admin-field"><span className="admin-label">Payment method</span><select className="admin-input" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}>{PAYMENT_METHOD_OPTIONS.map(method => <option key={method}>{method}</option>)}</select></label>
          <label className="admin-field"><span className="admin-label">Transaction reference</span><input className="admin-input" maxLength={200} required={['UPI','CARD','BANK'].includes(paymentMethod)} value={reference} onChange={event => setReference(event.target.value)} /></label>
        </> : null}
        <label className="admin-field"><span className="admin-label">Recording mode</span><select className="admin-input" value={recordingMode} onChange={event => setRecordingMode(event.target.value)}>{PAYMENT_MODE_OPTIONS.map(mode => <option key={mode}>{mode}</option>)}</select></label>
        <label className="admin-field"><span className="admin-label">Occurrence time{recordingMode === 'OFFLINE' ? ' (required)' : ' (optional)'}</span><input className="admin-input" type="datetime-local" required={recordingMode === 'OFFLINE'} value={occurredAt} onChange={event => setOccurredAt(event.target.value)} /></label>
        <label className="admin-field"><span className="admin-label">Details / hold reason</span><textarea className="admin-input" maxLength={500} value={details} onChange={event => setDetails(event.target.value)} /></label>
        <button className="admin-touch-button" type="submit">{busy ? 'Recording…' : entryType === 'PAYMENT' ? 'Record payment' : 'Save payment hold change'}</button>
      </fieldset>
    </form> : null}
    <h4>Payment history</h4>
    {!entries.length && !loading ? <p>No payment entries recorded.</p> : null}
    <ol>{entries.map(entry => <li key={entry.paymentId} className="admin-card">
      <p><strong>{entry.entryType === 'PAYMENT' ? `${formatPaymentPaise(entry.amountPaise)} · ${entry.paymentMethod}` : entry.entryType === 'HOLD' ? 'Payment hold placed' : 'Payment hold released'}</strong></p>
      <p>{entry.recordingMode} · {entry.actorName ?? entry.actorUserId} ({entry.actorRole})</p>
      <p>Occurred: {new Date(entry.occurredAt).toLocaleString()} · Recorded: {new Date(entry.receivedAt).toLocaleString()}</p>
      {entry.reference ? <p>Reference: {entry.reference}</p> : null}{entry.details ? <p>{entry.details}</p> : null}
      <p className="admin-hint">Payment ID: {entry.paymentId}{entry.deviceId ? ` · Device: ${entry.deviceId}` : ''}</p>
    </li>)}</ol>
    {hasMore ? <button type="button" className="admin-touch-button" disabled={busy} onClick={loadMore}>Load more payment history</button> : null}
  </section>
}
