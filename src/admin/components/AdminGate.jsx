import { Loader2, ShieldAlert, ShieldOff } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { adminAuthHint } from '../lib/adminAuthHints.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'

export default function AdminGate({ children }) {
  const { status, error, errorCode, httpStatus, retry } = useAdminSession()

  if (status === 'loading') {
    return (
      <div className="admin-auth-screen">
        <Loader2 className="admin-auth-screen__icon animate-spin" aria-hidden="true" />
        <p className="admin-auth-screen__title">Verifying admin session…</p>
      </div>
    )
  }

  if (status === 'denied') {
    const Icon = httpStatus === 403 ? ShieldOff : ShieldAlert
    return (
      <div className="admin-auth-screen">
        <Icon className="admin-auth-screen__icon text-[var(--color-maroon)]" aria-hidden="true" />
        <h1 className="admin-auth-screen__title">Admin access required</h1>
        <p className="admin-auth-screen__message">{error ?? 'Authentication failed.'}</p>
        <p className="admin-auth-screen__hint">{adminAuthHint({ errorCode, httpStatus })}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button to="/admin/login" variant="primary">
            Sign in
          </Button>
          <Button type="button" variant="secondary" surface="light" onClick={retry}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return children
}
