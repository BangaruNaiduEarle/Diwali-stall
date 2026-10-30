import { formatAgreedBelowFinalListWarning } from '../lib/agreedBelowFinalWarningDisplay.js'
import { formatListAuditPaise } from '../lib/adminCustomerRequestListAuditDisplay.js'

/**
 * @param {{ auditSummary?: Record<string, unknown> | null, compact?: boolean, variant?: 'card' | 'inline' }} props
 */
export default function AdminCustomerRequestListAudit({
  auditSummary,
  compact = false,
  variant = 'card',
}) {
  if (!auditSummary || typeof auditSummary !== 'object') return null

  const selling = formatListAuditPaise(auditSummary.sellingSubtotalPaise)
  const agreed =
    auditSummary.acceptedAmountPaise != null
      ? formatListAuditPaise(auditSummary.acceptedAmountPaise)
      : null
  const warning = formatAgreedBelowFinalListWarning(auditSummary)

  if (!selling && agreed == null && !warning) return null

  if (variant === 'inline') {
    return (
      <div className="admin-request-list__pricing-row" aria-label="Internal pricing summary">
        {selling ? (
          <span className="admin-request-list__pricing-chip">
            <span className="admin-request-list__pricing-chip-label">Selling</span>
            <span className="admin-request-list__pricing-chip-value tabular-nums">{selling}</span>
          </span>
        ) : null}
        {agreed != null ? (
          <span className="admin-request-list__pricing-chip admin-request-list__pricing-chip--agreed">
            <span className="admin-request-list__pricing-chip-label">Agreed</span>
            <span className="admin-request-list__pricing-chip-value tabular-nums">{agreed}</span>
          </span>
        ) : null}
        {warning ? (
          <span className="admin-request-list__pricing-warn" role="status">
            {warning}
          </span>
        ) : null}
      </div>
    )
  }

  const rootClass = compact
    ? 'admin-request-card__audit admin-request-card__audit--compact'
    : 'admin-request-card__audit'

  return (
    <div className={rootClass}>
      {selling ? (
        <p className="admin-request-card__audit-row">
          <span className="admin-request-card__audit-label">Selling</span>
          <span className="admin-request-card__audit-value tabular-nums">{selling}</span>
        </p>
      ) : null}
      {agreed != null ? (
        <p className="admin-request-card__audit-row">
          <span className="admin-request-card__audit-label">Customer agreed</span>
          <span className="admin-request-card__audit-value tabular-nums">{agreed}</span>
        </p>
      ) : null}
      {warning ? (
        <p className="admin-request-card__audit-warn" role="status">
          {warning}
        </p>
      ) : null}
    </div>
  )
}
