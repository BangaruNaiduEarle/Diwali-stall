import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import { isLocalViteProxyMode } from '../../api/adminApiMode.js'
import { fetchAdminSession, loginAdmin } from '../api/adminApi.js'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const usingViteProxy = isLocalViteProxyMode()

  useEffect(() => {
    let cancelled = false
    fetchAdminSession().then((result) => {
      if (cancelled) return
      setCheckingSession(false)
      if (result.ok) {
        navigate('/admin/products', { replace: true })
      }
    })
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await loginAdmin({ email, password })
    setLoading(false)
    if (!result.ok) {
      setError(result.message || 'Sign in failed.')
      return
    }
    navigate('/admin/products', { replace: true })
    window.location.reload()
  }

  if (checkingSession) {
    return (
      <div className="admin-auth-screen">
        <p className="admin-auth-screen__title">Checking admin session…</p>
      </div>
    )
  }

  return (
    <div className="admin-auth-screen">
      <h1 className="admin-auth-screen__title">Admin sign in</h1>
      <p className="admin-auth-screen__hint mb-6 max-w-sm text-center">
        Use your stall admin email and password. Sessions expire after several hours.
      </p>
      {usingViteProxy ? (
        <div className="admin-auth-screen__hint mb-4 max-w-md space-y-2 text-center text-xs opacity-90">
          <p>
            <strong>Local dev (Vite proxy → local D1):</strong> Admin API calls use{' '}
            <code className="text-[0.7rem]">/api/admin</code> on this dev server, not the deployed Worker.
            With a fresh <code className="text-[0.7rem]">ADMIN_LOCAL_DEV_JWT</code> in root{' '}
            <code className="text-[0.7rem]">.env.local</code>, open{' '}
            <Button to="/admin/products" variant="secondary" surface="light" className="inline-flex px-2 py-0.5 text-xs">
              Admin products
            </Button>{' '}
            directly — no production password required.
          </p>
          <p>
            Optional password sign-in here needs a <strong>local</strong> owner bootstrap (
            <code className="text-[0.7rem]">server/docs/LOCAL_ADMIN_DEV.md</code>). To hit production D1
            instead, set <code className="text-[0.7rem]">VITE_API_BASE_URL</code> to the Worker URL and restart
            Vite.
          </p>
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="admin-form admin-form--auth w-full max-w-sm">
        <label className="admin-field">
          <span className="admin-label">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            className="admin-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span className="admin-label">Password</span>
          <div className="admin-password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              className="admin-input admin-password-field__input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="admin-password-field__toggle"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
        </label>
        {error ? (
          <p className="text-sm text-[var(--color-maroon)]" role="alert">
            {error}
          </p>
        ) : null}
        {usingViteProxy && error ? (
          <p className="text-xs text-[var(--color-charcoal)] opacity-80">
            If you expected local access without a password, refresh{' '}
            <code className="text-[0.7rem]">ADMIN_LOCAL_DEV_JWT</code> (
            <code className="text-[0.7rem]">npm run admin:local-jwt</code> in <code className="text-[0.7rem]">server/</code>
            ), restart Vite, then open Admin products.
          </p>
        ) : null}
        <Button type="submit" variant="primary" fullWidth loading={loading}>
          Sign in
        </Button>
      </form>
    </div>
  )
}
