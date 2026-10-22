import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import AdminFeedbackBanner from '../components/AdminFeedbackBanner.jsx'
import {
  createAdminUser,
  disableAdminUser,
  enableAdminUser,
  fetchAdminUsers,
  resetAdminUserPassword,
  updateAdminUserRole,
} from '../api/adminApi.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import {
  ADMIN_USER_CREATE_ROLES,
  ADMIN_USER_EDIT_ROLES,
  adminUserRoleSelectLabel,
  canManageAdminUsers,
  normalizeAdminRole,
} from '../lib/adminRoles.js'

export default function AdminUsersPage() {
  const { email: sessionEmail, role: sessionRole, refreshSession } = useAdminSession()
  const navigate = useNavigate()
  const [users, setUsers] = useState(/** @type {unknown[]} */ ([]))
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ email: '', displayName: '', password: '', role: 'admin' })
  /** @type {[Record<string, string>, (next: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void]} */
  const [roleDraft, setRoleDraft] = useState({})

  const load = useCallback(async () => {
    const res = await fetchAdminUsers()
    if (!res.ok) {
      setError(res.message)
      return
    }
    setUsers(res.users)
    setError('')
    const draft = /** @type {Record<string, string>} */ ({})
    for (const u of res.users) {
      const user = /** @type {{ id: string, role: string }} */ (u)
      draft[user.id] = normalizeAdminRole(user.role)
    }
    setRoleDraft(draft)
  }, [])

  useEffect(() => {
    if (canManageAdminUsers(sessionRole)) load()
  }, [sessionRole, load])

  const usersById = useMemo(() => {
    /** @type {Map<string, { id: string, email: string, displayName?: string, role: string, disabled: boolean }>} */
    const map = new Map()
    for (const u of users) {
      const user = /** @type {{ id: string, email: string, displayName?: string, role: string, disabled: boolean }} */ (u)
      map.set(user.id, user)
    }
    return map
  }, [users])

  if (!canManageAdminUsers(sessionRole)) {
    return <p className="text-sm text-[var(--color-muted)]">Owner access required.</p>
  }

  async function handleCreate(e) {
    e.preventDefault()
    setBusy(true)
    setSuccess('')
    const res = await createAdminUser(form)
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setError('')
    setSuccess('User created.')
    setForm({ email: '', displayName: '', password: '', role: 'admin' })
    load()
  }

  async function handleDisable(id) {
    setBusy(true)
    setSuccess('')
    await disableAdminUser(id)
    setBusy(false)
    load()
  }

  async function handleEnable(id) {
    setBusy(true)
    setSuccess('')
    await enableAdminUser(id)
    setBusy(false)
    load()
  }

  async function handleReset(id) {
    const password = window.prompt('New password (min 12 characters):')
    if (!password) return
    setBusy(true)
    setSuccess('')
    const res = await resetAdminUserPassword(id, password)
    setBusy(false)
    if (!res.ok) setError(res.message)
    else {
      setError('')
      setSuccess('Password reset.')
      load()
    }
  }

  async function handleSaveRole(userId) {
    const user = usersById.get(userId)
    if (!user) return
    const nextRole = normalizeAdminRole(roleDraft[userId])
    if (nextRole === normalizeAdminRole(user.role)) return

    setBusy(true)
    setSuccess('')
    const res = await updateAdminUserRole(userId, nextRole)
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setError('')
    setSuccess(`Role updated for ${user.email}.`)

    const selfChange =
      sessionEmail && user.email.toLowerCase() === String(sessionEmail).toLowerCase()
    await load()
    if (selfChange) {
      await refreshSession()
      if (!canManageAdminUsers(nextRole)) {
        navigate('/admin/products', { replace: true })
      }
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-lg font-semibold">Admin users</h2>
        <p className="text-sm text-[var(--color-muted)]">Up to five active accounts. Disabled users cannot sign in.</p>
      </header>

      <AdminFeedbackBanner variant="error" message={error} onDismiss={() => setError('')} />
      <AdminFeedbackBanner variant="success" message={success} onDismiss={() => setSuccess('')} />

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
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--color-muted)]">Role</span>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          >
            {ADMIN_USER_CREATE_ROLES.map((r) => (
              <option key={r} value={r}>
                {adminUserRoleSelectLabel(r)}
              </option>
            ))}
          </select>
        </label>
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

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-page)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Email</th>
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {users.map((u) => {
              const user = /** @type {{ id: string, email: string, displayName?: string, role: string, disabled: boolean }} */ (u)
              const draft = roleDraft[user.id] ?? normalizeAdminRole(user.role)
              const roleDirty = normalizeAdminRole(draft) !== normalizeAdminRole(user.role)
              return (
                <tr key={user.id}>
                  <td className="px-3 py-3 align-top">
                    <p className="font-medium">{user.email}</p>
                    {user.displayName ? (
                      <p className="text-xs text-[var(--color-muted)]">{user.displayName}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded border px-2 py-1.5 text-sm"
                        value={draft}
                        disabled={busy}
                        onChange={(e) =>
                          setRoleDraft((prev) => ({ ...prev, [user.id]: e.target.value }))
                        }
                        aria-label={`Role for ${user.email}`}
                      >
                        {ADMIN_USER_EDIT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {adminUserRoleSelectLabel(r)}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="secondary"
                        surface="light"
                        size="sm"
                        disabled={busy || !roleDirty}
                        onClick={() => handleSaveRole(user.id)}
                      >
                        Update role
                      </Button>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top text-[var(--color-muted)]">
                    {user.disabled ? 'Disabled' : 'Active'}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="admin-link-button"
                        disabled={busy}
                        onClick={() => handleReset(user.id)}
                      >
                        Reset password
                      </button>
                      {user.disabled ? (
                        <button
                          type="button"
                          className="admin-link-button"
                          disabled={busy}
                          onClick={() => handleEnable(user.id)}
                        >
                          Enable
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="admin-link-button"
                          disabled={busy}
                          onClick={() => handleDisable(user.id)}
                        >
                          Disable
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
