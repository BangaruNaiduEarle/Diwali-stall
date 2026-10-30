import { ChevronDown } from 'lucide-react'
import { customerRequestWorkflowAuditRows } from '../lib/adminCustomerRequestWorkflowAuditDisplay.js'

/**
 * @param {{ request: Record<string, unknown>, compact?: boolean, variant?: 'detail' | 'listTable' | 'listCard' }} props
 */
export default function AdminCustomerRequestWorkflowAudit({
  request,
  compact = false,
  variant = 'detail',
}) {
  const rows = customerRequestWorkflowAuditRows(request)
  if (!rows.length) return null

  const resolvedVariant =
    variant === 'detail' && compact ? 'listCard' : variant

  const grid = (
    <div className="admin-request-list__workflow-grid">
      {rows.map((row) => (
        <div key={row.label} className="admin-request-list__workflow-grid-row">
          <span className="admin-request-list__workflow-grid-label">{row.label}</span>
          <span className="admin-request-list__workflow-grid-value">{row.value}</span>
        </div>
      ))}
    </div>
  )

  if (resolvedVariant === 'listTable') {
    return (
      <div
        className="admin-request-list__workflow admin-request-list__workflow--table"
        aria-label="Workflow audit"
      >
        <p className="admin-request-list__workflow-heading">Workflow audit</p>
        {grid}
      </div>
    )
  }

  if (resolvedVariant === 'listCard') {
    return (
      <details
        className="admin-request-list__workflow-details"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <summary className="admin-request-list__workflow-summary">
          <span>Workflow details</span>
          <ChevronDown className="admin-request-list__workflow-chevron" size={16} aria-hidden="true" />
        </summary>
        <div className="admin-request-list__workflow-panel">
          <p className="admin-request-list__workflow-heading">Workflow audit</p>
          {grid}
        </div>
      </details>
    )
  }

  const rootClass = compact
    ? 'admin-request-card__workflow-audit admin-request-card__workflow-audit--compact'
    : 'admin-request-card__workflow-audit'

  return (
    <div className={rootClass} aria-label="Assignment and closure">
      {rows.map((row) => (
        <p key={row.label} className="admin-request-card__workflow-audit-row">
          <span className="admin-request-card__workflow-audit-label">{row.label}</span>
          <span className="admin-request-card__workflow-audit-value">{row.value}</span>
        </p>
      ))}
    </div>
  )
}
