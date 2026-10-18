import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, RefreshCw } from 'lucide-react'
import { fetchAdminCustomerRequests } from '../api/adminApi.js'
import AdminCustomerRequestCard from '../components/AdminCustomerRequestCard.jsx'
import { formatRequestCreatedAt, formatShortRequestId } from '../lib/adminCustomerRequestDisplay.js'
import {
  CUSTOMER_REQUEST_STATUSES,
  customerRequestStatusBadgeClass,
  customerRequestStatusLabel,
} from '../lib/customerRequestStatus.js'

export default function AdminCustomerRequestsPage() {
  const [requests, setRequests] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [statusFilter])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchAdminCustomerRequests({ page, status: statusFilter || undefined })
    if (!result.ok) {
      setError(result.message)
      setRequests([])
      setLoading(false)
      return
    }
    setRequests(result.requests)
    const p = result.pagination ?? {}
    setPagination({
      page: Number(p.page ?? page),
      limit: Number(p.limit ?? 25),
      total: Number(p.total ?? 0),
      totalPages: Number(p.totalPages ?? 0),
    })
    setLoading(false)
  }, [page, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const resultsSummary = useMemo(() => {
    const totalPart = `${pagination.total} request${pagination.total === 1 ? '' : 's'}`
    if (pagination.totalPages <= 1) return totalPart
    return `${totalPart} · Page ${pagination.page} of ${pagination.totalPages}`
  }, [pagination])

  return (
    <div className="admin-page admin-page--customer-requests">
      <div className="admin-page__head admin-page__head--requests">
        <div className="admin-page__head-text">
          <h2 className="admin-page__title">Customer requests</h2>
          <p className="admin-page__subtitle admin-page__subtitle--compact">
            Review quotation requests and send WhatsApp quotes.
          </p>
        </div>
      </div>
      <div className="admin-toolbar admin-requests-toolbar">
        <label className="admin-field admin-requests-toolbar__status">
          <span className="admin-label admin-show-desktop">Filter by status</span>
          <select
            className="admin-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {CUSTOMER_REQUEST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {customerRequestStatusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="admin-requests-refresh-btn admin-show-mobile"
          onClick={load}
          disabled={loading}
          aria-label="Refresh requests"
          title="Refresh requests"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
        </button>
        <button type="button" className="admin-link-button admin-show-desktop" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {loading ? (
        <div className="admin-state">
          <Loader2 className="admin-state__icon animate-spin" aria-hidden="true" />
          <p>Loading…</p>
        </div>
      ) : null}
      {error ? (
        <div className="admin-alert admin-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      {!loading && !error && requests.length === 0 ? (
        <div className="admin-state">
          <p>No requests match this filter.</p>
        </div>
      ) : null}
      {!loading && !error && requests.length > 0 ? (
        <>
          <p className="admin-hint admin-requests-results-meta">{resultsSummary}</p>
          <div className="admin-card-list admin-show-mobile" aria-label="Customer requests">
            {requests.map((r) => (
              <AdminCustomerRequestCard key={String(r.id ?? '')} request={r} />
            ))}
          </div>
          <div className="admin-table-wrap admin-show-desktop">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Items</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const id = String(r.id ?? '')
                  const rowStatus = String(r.status ?? '')
                  return (
                    <tr key={id}>
                      <td className="admin-table__mono" title={id}>
                        {formatShortRequestId(id)}
                      </td>
                      <td>
                        <span className="admin-table__primary">{String(r.customerName ?? '—')}</span>
                        {r.customerPhone ? (
                          <span className="admin-table__meta">{String(r.customerPhone)}</span>
                        ) : null}
                      </td>
                      <td>
                        <span className={customerRequestStatusBadgeClass(rowStatus)}>
                          {customerRequestStatusLabel(rowStatus)}
                        </span>
                      </td>
                      <td>{String(r.itemCount ?? 0)}</td>
                      <td>{formatRequestCreatedAt(r.createdAt)}</td>
                      <td>
                        <Link to={`/admin/customer-requests/${encodeURIComponent(id)}`} className="admin-table__link">
                          Open
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pagination.totalPages > 1 ? (
            <div className="admin-toolbar admin-requests-pagination">
              <button
                type="button"
                className="admin-link-button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="admin-link-button"
                disabled={page >= pagination.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
