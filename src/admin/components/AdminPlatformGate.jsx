import { ShieldOff } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { platformDashboardAccessBlockReason } from '../lib/adminPlatformAccess.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'

/** @param {{ children: import('react').ReactNode }} props */
export default function AdminPlatformGate({ children }) {
  const { status, platformAdmin } = useAdminSession()
  const blockReason = platformDashboardAccessBlockReason({ status, platformAdmin })

  if (status === 'loading') {
    return null
  }

  if (blockReason === 'platform_admin_required') {
    return (
      <div className="admin-page">
        <div className="admin-state">
          <ShieldOff className="admin-state__icon text-[var(--color-maroon)]" aria-hidden="true" />
          <h2 className="admin-page__title">Platform admin required</h2>
          <p className="admin-page__subtitle">
            This area is only available to Platform Admins. Season owner or super admin roles do not
            grant access here.
          </p>
          <Button to="/admin" variant="primary" className="mt-4">
            Back to admin home
          </Button>
        </div>
      </div>
    )
  }

  if (blockReason) {
    return null
  }

  return children
}
