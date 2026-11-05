import { useState } from 'react'
import { patchRequestPaymentPreferences } from '../api/adminApi.js'
import { preferenceAmountToPaise, validateRequestPaymentPreferences } from '../../shared/requestPaymentPreferences.js'

export default function RequestPaymentPreferences({ request, agreedAmountPaise, revision, disabled, onSaved }) {
  const saved = request?.paymentPreferences
  const [status, setStatus] = useState(saved?.status ?? '')
  const [mode, setMode] = useState(saved?.mode ?? '')
  const [amount, setAmount] = useState(saved?.receivedAmountPaise == null ? '' : String(saved.receivedAmountPaise / 100))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const savedKey = JSON.stringify(saved)
  const [previousSaved, setPreviousSaved] = useState(savedKey)
  if (previousSaved !== savedKey) {
    setPreviousSaved(savedKey)
    setStatus(saved?.status ?? '')
    setMode(saved?.mode ?? '')
    setAmount(saved?.receivedAmountPaise == null ? '' : String(saved.receivedAmountPaise / 100))
  }

  async function save(event) {
    event.preventDefault()
    if (disabled || busy) return
    setError('')
    setMessage('')
    const parsed = validateRequestPaymentPreferences({ status, mode,
      receivedAmountPaise: status === 'partial_paid' ? preferenceAmountToPaise(amount) : null,
    }, agreedAmountPaise)
    if (!parsed.ok) { setError(parsed.message); return }
    setBusy(true)
    try {
      const result = await patchRequestPaymentPreferences(request.id, parsed.data, { revision })
      if (!result.ok) { setError(result.message || 'Could not save payment preferences.'); return }
      await onSaved()
      setMessage('Payment preferences saved. No payment transaction was recorded.')
    } finally { setBusy(false) }
  }

  return <section className="admin-request-detail__section admin-card">
    <h3>Pre-finalization Payment Preferences</h3>
    <p>Preferences and records only. These do not change payments or balances. Record actual payments through the existing payment workflow.</p>
    <form onSubmit={save}>
      <fieldset disabled={disabled || busy}>
        <label>Payment Status
          <select value={status} onChange={event => { setStatus(event.target.value); setAmount(''); setMessage('') }} required>
            <option value="">Choose status</option>
            <option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="partial_paid">Partial Paid</option>
          </select>
        </label>
        <label>Payment Mode
          <select value={mode} onChange={event => { setMode(event.target.value); setMessage('') }} required>
            <option value="">Choose mode</option><option value="online">Online</option><option value="offline">Offline</option>
          </select>
        </label>
        {status === 'partial_paid' ? <label>Received Amount (₹)
          <input type="text" inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setMessage('') }} required />
          <small>Must be greater than zero and less than the saved agreed amount.</small>
        </label> : null}
        <button type="submit" className="admin-touch-button admin-touch-button--secondary">{busy ? 'Saving…' : 'Save payment preferences'}</button>
      </fieldset>
    </form>
    {error ? <p role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>
}
