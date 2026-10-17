import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import { loginAdmin } from '../api/adminApi.js'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const usingViteProxy =
    import.meta.env.DEV && !String(import.meta.env.VITE_API_BASE_URL ?? '').trim()

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

  return (
    <div className="admin-auth-screen">
      <h1 className="admin-auth-screen__title">Admin sign in</h1>
      <p className="admin-auth-screen__hint mb-6 max-w-sm text-center">
        Use your stall admin email and password. Sessions expire after several hours.
      </p>
      {usingViteProxy ? (
        <p className="admin-auth-screen__hint mb-4 max-w-sm text-center text-xs opacity-90">
          Dev: requests go to the local API proxy. To sign in with the deployed Worker account, set{' '}
          <code className="text-[0.7rem]">VITE_API_BASE_URL</code> in <code className="text-[0.7rem]">.env.local</code>{' '}
          and restart Vite.
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <label className="block text-sm">
          <span className="font-medium text-[var(--color-charcoal)]">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-[var(--color-charcoal)]">Password</span>
          <div className="relative mt-1">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-[var(--color-border)] py-2 pl-3 pr-10 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-charcoal)] opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-maroon)]"
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
        <Button type="submit" variant="primary" fullWidth loading={loading}>
          Sign in
        </Button>
      </form>
    </div>
  )
}
