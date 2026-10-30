import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import {
  formatAdminPublicReference,
  formatRequestCreatedAt,
  formatShortRequestId,
} from '../lib/adminCustomerRequestDisplay.js'
import {
  customerRequestStatusBadgeClass,
  customerRequestStatusLabel,
} from '../lib/customerRequestStatus.js'
import { stallBillFinalizationDisplay } from '../lib/stallBillFinalization.js'
import AdminCustomerRequestListAudit from './AdminCustomerRequestListAudit.jsx'
import AdminCustomerRequestWorkflowAudit from './AdminCustomerRequestWorkflowAudit.jsx'

/** @param {{ request: Record<string, unknown>, showListAudit?: boolean }} props */
export default function AdminCustomerRequestCard({ request, showListAudit = false }) {
  const id = String(request.id ?? '')
  const rowStatus = String(request.status ?? '')
  const phone = String(request.customerPhone ?? '').trim()
  const name = String(request.customerName ?? '—')
  const itemCount = Number(request.itemCount ?? 0)
  const stallFinalization = stallBillFinalizationDisplay(request)
  const shortId = formatShortRequestId(id)
  const publicRefLabel = formatAdminPublicReference(request.publicReference)
  const createdLabel = formatRequestCreatedAt(request.createdAt)
  const detailPath = `/admin/customer-requests/${encodeURIComponent(id)}`

  return (
    <article className="admin-card admin-request-card admin-request-card--list">
      <Link
        to={detailPath}
        className="admin-request-card__link-body"
        aria-label={`Open request for ${name}`}
      >
        <div className="admin-request-card__head">
          <p className="admin-request-card__customer">{name}</p>
          <span className="admin-request-card__badges">
            <span className={customerRequestStatusBadgeClass(rowStatus)}>
              {customerRequestStatusLabel(rowStatus)}
            </span>
            {stallFinalization ? (
              <span className={stallFinalization.badgeClass}>{stallFinalization.label}</span>
            ) : null}
          </span>
        </div>
        <p className="admin-request-card__subline">
          {phone ? <span className="admin-request-card__phone">{phone}</span> : null}
          {phone ? (
            <span className="admin-request-card__dot" aria-hidden="true">
              {' '}
              ·{' '}
            </span>
          ) : null}
          <span className="admin-request-card__items">
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
        </p>
        {showListAudit ? (
          <AdminCustomerRequestListAudit
            auditSummary={
              request.auditSummary && typeof request.auditSummary === 'object'
                ? /** @type {Record<string, unknown>} */ (request.auditSummary)
                : null
            }
            variant="inline"
          />
        ) : null}
        <div className="admin-request-card__foot">
          <span className="admin-request-card__id" title={publicRefLabel !== '—' ? publicRefLabel : id}>
            {publicRefLabel !== '—' ? publicRefLabel : shortId}
          </span>
          <span className="admin-request-card__date">{createdLabel}</span>
          <ChevronRight className="admin-request-card__chevron" size={18} aria-hidden="true" />
        </div>
      </Link>
      <AdminCustomerRequestWorkflowAudit request={request} variant="listCard" />
    </article>
  )
}
