import { Navigate, Outlet, useLocation } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { adminRouteAccess, resolveAdminLanding, resolveAdminLoginDestination } from '../lib/adminWorkspaceAccess.js'

export function AdminLanding() {
  const session = useAdminSession()
  const location = useLocation()
  return <Navigate to={resolveAdminLoginDestination(session, location.state?.from)} replace />
}

export default function AdminRouteGuard() {
  const session = useAdminSession()
  const location = useLocation()
  const access = adminRouteAccess(session, location)
  if (access.allowed) return <Outlet />
  if (access.reason === 'context_required') return <Navigate to="/admin/context" replace state={{ from: location }} />
  if (access.reason === 'context_switching') return <p className="admin-state" role="status">Switching stall…</p>
  return (
    <div className="admin-page admin-state" role="alert">
      <h1 className="admin-page__title">Workspace access required</h1>
      <p className="admin-page__subtitle">Your current permissions do not allow this page. Choose another authorized stall or return to your workspace.</p>
      <Button to={resolveAdminLanding(session)} className="mt-4">Go to my workspace</Button>
    </div>
  )
}
