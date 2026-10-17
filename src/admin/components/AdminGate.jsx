import { Loader2, ShieldAlert, ShieldOff } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { useAdminSession } from '../context/AdminSessionContext.jsx'

function authHint(errorCode, httpStatus) {
  if (httpStatus === 0 || errorCode === 'network_error') {
    return 'Start the Worker (npm run dev in server/) and set VITE_API_BASE_URL to the Worker origin when not using the Vite proxy.'
  }
  if (httpStatus === 401 || errorCode === 'unauthorized') {
    return 'Sign in with your admin email and password.'
  }
  if (httpStatus === 403 || errorCode === 'forbidden') {
    return 'This account is disabled or not authorized.'
  }
  if (errorCode === 'auth_not_configured' || httpStatus === 503) {
    return 'The API database or auth configuration is unavailable.'
  }
  return 'Admin access could not be verified.'
}

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
        <p className="admin-auth-screen__hint">{authHint(errorCode, httpStatus)}</p>
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
