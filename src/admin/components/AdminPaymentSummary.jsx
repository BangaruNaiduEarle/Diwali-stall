import { paymentSummaryDisplay } from '../lib/payments.js'

export default function AdminPaymentSummary({ summary }) {
  const display = paymentSummaryDisplay(summary)
  if (!display) return null
  return <div className="admin-request-detail__section" aria-label="Payment summary">
    <p><strong>Payment: {display.label}</strong></p>
    <dl className="admin-request-detail__summary-dl">
      <div><dt>Agreed amount due</dt><dd>{display.due}</dd></div>
      <div><dt>Received</dt><dd>{display.received}</dd></div>
      <div><dt>Outstanding</dt><dd>{display.outstanding}</dd></div>
    </dl>
  </div>
}
