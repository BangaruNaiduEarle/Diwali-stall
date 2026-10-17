import { useCallback, useEffect, useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import { createAdminUser, disableAdminUser, enableAdminUser, fetchAdminUsers, resetAdminUserPassword } from '../api/adminApi.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'

export default function AdminUsersPage() {
  const { role } = useAdminSession()
  const [users, setUsers] = useState(/** @type {unknown[]} */ ([]))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ email: '', displayName: '', password: '' })

  const load = useCallback(async () => {
    const res = await fetchAdminUsers()
    if (!res.ok) {
      setError(res.message)
      return
    }
    setUsers(res.users)
    setError('')
  }, [])

  useEffect(() => {
    if (role === 'owner') load()
  }, [role, load])

  if (role !== 'owner') {
    return <p className="text-sm text-[var(--color-muted)]">Owner access required.</p>
  }

  async function handleCreate(e) {
    e.preventDefault()
    setBusy(true)
    const res = await createAdminUser(form)
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setForm({ email: '', displayName: '', password: '' })
    load()
  }

  async function handleDisable(id) {
    setBusy(true)
    await disableAdminUser(id)
    setBusy(false)
    load()
  }

  async function handleEnable(id) {
    setBusy(true)
    await enableAdminUser(id)
    setBusy(false)
    load()
  }

  async function handleReset(id) {
    const password = window.prompt('New password (min 12 characters):')
    if (!password) return
    setBusy(true)
    const res = await resetAdminUserPassword(id, password)
    setBusy(false)
    if (!res.ok) setError(res.message)
    else load()
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-lg font-semibold">Admin users</h2>
        <p className="text-sm text-[var(--color-muted)]">Up to five active accounts. Disabled users cannot sign in.</p>
      </header>

      {error ? <p className="text-sm text-[var(--color-maroon)]">{error}</p> : null}

      <form onSubmit={handleCreate} className="max-w-md space-y-3 rounded-lg border border-[var(--color-border)] p-4">
        <h3 className="text-sm font-semibold">Add admin</h3>
        <input
          type="email"
          placeholder="Email"
          required
          className="w-full rounded border px-3 py-2 text-sm"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        <input
          type="text"
          placeholder="Display name (optional)"
          className="w-full rounded border px-3 py-2 text-sm"
          value={form.displayName}
          onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
        />
        <input
          type="password"
          placeholder="Temporary password"
          required
          minLength={12}
          className="w-full rounded border px-3 py-2 text-sm"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        />
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Create user
        </Button>
      </form>

      <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {users.map((u) => {
          const user = /** @type {{ id: string, email: string, displayName?: string, role: string, disabled: boolean }} */ (u)
          return (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <p className="font-medium">{user.email}</p>
                <p className="text-[var(--color-muted)]">
                  {user.role}
                  {user.disabled ? ' · disabled' : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="admin-link-button" disabled={busy} onClick={() => handleReset(user.id)}>
                  Reset password
                </button>
                {user.disabled ? (
                  <button type="button" className="admin-link-button" disabled={busy} onClick={() => handleEnable(user.id)}>
                    Enable
                  </button>
                ) : (
                  <button type="button" className="admin-link-button" disabled={busy} onClick={() => handleDisable(user.id)}>
                    Disable
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
