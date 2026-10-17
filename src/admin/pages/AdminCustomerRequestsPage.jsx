import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { fetchAdminCustomerRequests } from '../api/adminApi.js'

export default function AdminCustomerRequestsPage() {
  const [requests, setRequests] = useState(/** @type {Record<string, unknown>[]} */ ([]))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchAdminCustomerRequests({ status: status || undefined })
    if (!result.ok) {
      setError(result.message)
      setRequests([])
      setLoading(false)
      return
    }
    setRequests(result.requests)
    setLoading(false)
  }, [status])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="admin-page">
      <div className="admin-page__head">
        <div>
          <h2 className="admin-page__title">Customer requests</h2>
          <p className="admin-page__subtitle">Review web quotation requests and create private quotations.</p>
        </div>
      </div>
      <div className="admin-toolbar">
        <select className="admin-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="received">Received</option>
          <option value="reviewing">Reviewing</option>
          <option value="quoted">Quoted</option>
          <option value="closed">Closed</option>
          <option value="void">Void</option>
        </select>
        <button type="button" className="admin-link-button" onClick={load} disabled={loading}>
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
      {!loading && !error ? (
        <div className="admin-table-wrap">
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
                return (
                  <tr key={id}>
                    <td className="admin-table__mono">{id.slice(0, 12)}…</td>
                    <td>{String(r.customerName ?? '—')}</td>
                    <td>{String(r.status ?? '')}</td>
                    <td>{String(r.itemCount ?? 0)}</td>
                    <td>{String(r.createdAt ?? '')}</td>
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
      ) : null}
    </div>
  )
}
