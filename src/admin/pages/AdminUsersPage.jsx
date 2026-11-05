import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import AdminFeedbackBanner from '../components/AdminFeedbackBanner.jsx'
import {fetchBillingPermissions,setBillingPermission} from '../api/adminOffline.js'
import {
  createAdminUser,
  disableAdminUser,
  enableAdminUser,
  fetchAdminUsers,
  resetAdminUserPassword,
  removeAdminLocationMember,
  updateAdminUserRole,
  updateAdminFinalRateAccess,
} from '../api/adminApi.js'
import { useAdminSeasonReadOnly } from '../hooks/useAdminSeasonReadOnly.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { preventArchivedSeasonFormSubmit } from '../lib/adminSeasonReadOnly.js'
import {
  ADMIN_USER_EDIT_ROLES,
  adminUserRoleSelectLabel,
  canChangeSeasonMemberRoles,
  normalizeAdminRole,
} from '../lib/adminRoles.js'
import {
  canShowAdminUserCreateForm,
  canShowAdminUserOwnerActions,
  canViewAdminUsersPage,
  creatableAdminUserRoles,
  adminUserAssignmentPayload,
  shouldLeaveAdminUsersAfterSelfRoleChange,
} from '../lib/adminUsersSeasonAccess.js'

function PasswordInput({ value, onChange, ...props }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => { if (!value) setVisible(false) }, [value])
  return <div className="admin-password-field">
    <input {...props} type={visible ? 'text' : 'password'} value={value} onChange={onChange}
      className="admin-input admin-password-field__input" />
    <button type="button" className="admin-password-field__toggle" disabled={props.disabled}
      aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
      onClick={() => setVisible(previous => !previous)}>
      {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
    </button>
  </div>
}

export default function AdminUsersPage() {
  const { email: sessionEmail, permissionRole: seasonRole, refreshSession, seasonStatus, locationModeEnabled, location,contextKey } = useAdminSession()
  const { isReadOnly } = useAdminSeasonReadOnly()
  const createRoles = useMemo(() => creatableAdminUserRoles(seasonRole, locationModeEnabled), [seasonRole, locationModeEnabled])
  const showCreateForm = canShowAdminUserCreateForm(seasonRole, isReadOnly)
  const showOwnerActions = canShowAdminUserOwnerActions(seasonRole, isReadOnly)
  const navigate = useNavigate()
  const [users, setUsers] = useState(/** @type {unknown[]} */ ([]))
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [billingPermissions,setBillingPermissions]=useState(null)
  const [billingError,setBillingError]=useState('')
  const billingChange=useRef(null)
  const billingContext=useRef(contextKey)
  useLayoutEffect(()=>{billingContext.current=contextKey;return()=>{billingContext.current=null}},[contextKey])
  useEffect(()=>{
    setBillingPermissions(null);setBillingError('');billingChange.current=null
    let cancelled=false
    if(locationModeEnabled&&canViewAdminUsersPage(seasonRole))fetchBillingPermissions().then(result=>{
      if(cancelled)return
      if(result.ok)setBillingPermissions({contextKey,rows:result.permissions})
      else setBillingError(result.message)
    }).catch(()=>{if(!cancelled)setBillingError('Billing Finalization permissions could not be loaded.')})
    return ()=>{cancelled=true}
  },[contextKey,locationModeEnabled,seasonRole])
  const [existingLogin, setExistingLogin] = useState(true)
  const [form, setForm] = useState({ email: '', displayName: '', password: '', role: 'admin' })
  const [passwordFormVersion, setPasswordFormVersion] = useState(0)
  const [resetUserId, setResetUserId] = useState(null)
  const [resetPassword, setResetPassword] = useState('')
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
    if (canViewAdminUsersPage(seasonRole)) load()
  }, [seasonRole, load])

  const usersById = useMemo(() => {
    /** @type {Map<string, { id: string, email: string, displayName?: string, role: string, disabled: boolean }>} */
    const map = new Map()
    for (const u of users) {
      const user = /** @type {{ id: string, email: string, displayName?: string, role: string, disabled: boolean }} */ (u)
      map.set(user.id, user)
    }
    return map
  }, [users])

  if (!canViewAdminUsersPage(seasonRole)) {
    return <p className="text-sm text-[var(--color-muted)]">Owner or Super Admin access required for this season.</p>
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (busy || isReadOnly || preventArchivedSeasonFormSubmit(e, seasonStatus)) return
    setBusy(true)
    setSuccess('')
    const res = await createAdminUser(adminUserAssignmentPayload(form, locationModeEnabled, existingLogin))
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setError('')
    setSuccess(locationModeEnabled ? 'Member added to the selected stall.' : 'User created.')
    setForm({ email: '', displayName: '', password: '', role: 'admin' })
    setPasswordFormVersion(previous => previous + 1)
    load()
  }

  async function handleFinalRateAccess(id, enabled) {
    if (!locationModeEnabled || isReadOnly || busy) return
    setBusy(true)
    setError('')
    setSuccess('')
    const result = await updateAdminFinalRateAccess(id, enabled)
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setSuccess(`Final Rate visibility ${enabled ? 'enabled' : 'disabled'} for this stall. The Admin must refresh their session or sign in again.`)
    await load()
  }
  async function handleBillingAccess(userId,enabled){
    if(!locationModeEnabled||isReadOnly||busy||billingPermissions?.contextKey!==contextKey)return
    const capturedContext=contextKey
    const identity=JSON.stringify([contextKey,userId,enabled])
    if(!billingChange.current||billingChange.current.identity!==identity)billingChange.current={identity,operationId:crypto.randomUUID()}
    setBusy(true);setError('');setSuccess('')
    try{
      const result=await setBillingPermission({userId,enabled,operationId:billingChange.current.operationId})
      if(billingContext.current!==capturedContext)return
      if(!result.ok)throw Error(result.message)
      billingChange.current=null
      const refreshed=await fetchBillingPermissions()
      if(billingContext.current!==capturedContext)return
      if(!refreshed.ok)throw Error(refreshed.message)
      setBillingPermissions({contextKey,rows:refreshed.permissions})
      setSuccess(`Billing Finalization ${enabled?'enabled':'revoked'} for this Admin in this stall and season. Refresh signed authorization online on each device. Existing independent Phase 2 device grants are unchanged.`)
    }catch(reason){if(billingContext.current===capturedContext)setError(reason.message)}finally{setBusy(false)}
  }

  async function handleDisable(id) {
    if (isReadOnly || busy) return
    setBusy(true)
    setSuccess('')
    const result = await disableAdminUser(id)
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setSuccess(locationModeEnabled ? 'Membership disabled for the selected stall.' : 'Membership disabled.')
    load()
  }

  async function handleEnable(id) {
    if (isReadOnly || busy) return
    setBusy(true)
    setSuccess('')
    const result = await enableAdminUser(id)
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setSuccess(locationModeEnabled ? 'Membership enabled for the selected stall.' : 'Membership enabled.')
    load()
  }

  async function handleRemove(user) {
    if (!locationModeEnabled || !showOwnerActions || busy) return
    if (!window.confirm(`Remove ${user.email} from ${location?.name ?? 'the selected stall'}? Their login and memberships in other stalls will remain.`)) return
    setBusy(true)
    setSuccess('')
    const result = await removeAdminLocationMember(user.id)
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setSuccess('Member removed from the selected stall.')
    await load()
  }

  async function handleReset(event) {
    event.preventDefault()
    if (busy || isReadOnly || locationModeEnabled || !resetUserId || !resetPassword) return
    setBusy(true)
    setSuccess('')
    const res = await resetAdminUserPassword(resetUserId, resetPassword)
    setBusy(false)
    if (!res.ok) setError(res.message)
    else {
      setError('')
      setSuccess('Password reset.')
      setResetUserId(null)
      setResetPassword('')
      load()
    }
  }

  async function handleSaveRole(userId) {
    if (!canChangeSeasonMemberRoles(seasonRole) || isReadOnly || busy) return
    const user = usersById.get(userId)
    if (!user) return
    const nextRole = normalizeAdminRole(roleDraft[userId])
    if (nextRole === normalizeAdminRole(user.role)) return
    if (locationModeEnabled && !window.confirm(`Change ${user.email} to ${adminUserRoleSelectLabel(nextRole)} in ${location?.name ?? 'the selected stall'}? Promote a successor before demoting the current Owner.`)) return

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
      if (shouldLeaveAdminUsersAfterSelfRoleChange(nextRole)) {
        navigate('/admin/products', { replace: true })
      }
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-lg font-semibold">{locationModeEnabled ? `Members · ${location?.name ?? 'Selected stall'}` : 'Admin users'}</h2>
        <p className="text-sm text-[var(--color-muted)]">{locationModeEnabled ? 'Manage access to this stall only. Logins are shared across stalls; each stall has its own membership and role.' : 'Up to five active accounts. Disabled users cannot sign in.'}</p>
        {locationModeEnabled?<p className="mt-2 text-sm text-[var(--color-muted)]">Billing Finalization starts off and is separate from Final Rate visibility. Existing Phase 2 device grants remain independent; revoke those separately in Offline Billing when required.</p>:null}
        {locationModeEnabled && showOwnerActions ? <p className="mt-2 text-sm text-[var(--color-muted)]">To replace an Owner, first add or promote the successor to Owner, then demote or remove the former Owner. At least one enabled Owner must remain.</p> : null}
      </header>

      <AdminFeedbackBanner variant="error" message={error} onDismiss={() => setError('')} />
      <AdminFeedbackBanner variant="success" message={success} onDismiss={() => setSuccess('')} />

      {showCreateForm ? (
      <form onSubmit={handleCreate} onReset={() => { setForm({ email: '', displayName: '', password: '', role: 'admin' }); setPasswordFormVersion(previous => previous + 1) }} className="max-w-md space-y-3 rounded-lg border border-[var(--color-border)] p-4">
        <h3 className="text-sm font-semibold">{locationModeEnabled ? 'Add stall member' : 'Add admin'}</h3>
        {locationModeEnabled ? <label className="block text-sm">
          <span className="mb-1 block text-[var(--color-muted)]">Account</span>
          <select className="w-full rounded border px-3 py-2 text-sm" value={existingLogin ? 'existing' : 'new'} disabled={busy}
            onChange={event => { setExistingLogin(event.target.value === 'existing'); setForm(previous => ({ ...previous, password: '' })) }}>
            <option value="existing">Existing login</option>
            <option value="new">New login</option>
          </select>
        </label> : null}
        <input
          type="email"
          placeholder="Email"
          required
          disabled={busy}
          className="w-full rounded border px-3 py-2 text-sm"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        {!locationModeEnabled || !existingLogin ? <input
          type="text"
          placeholder="Display name (optional)"
          className="w-full rounded border px-3 py-2 text-sm"
          value={form.displayName}
          onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
          disabled={busy}
        /> : null}
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--color-muted)]">Role</span>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={form.role}
            disabled={busy}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          >
            {createRoles.map((r) => (
              <option key={r} value={r}>
                {adminUserRoleSelectLabel(r)}
              </option>
            ))}
          </select>
        </label>
        {!locationModeEnabled || !existingLogin ? <PasswordInput
          key={passwordFormVersion}
          placeholder="Temporary password"
          required
          minLength={12}
          aria-label="Temporary password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          disabled={busy}
        /> : <p className="text-sm text-[var(--color-muted)]">Use the existing login email. Its password will stay unchanged.</p>}
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy || isReadOnly}>
          {locationModeEnabled ? existingLogin ? 'Add to stall' : 'Create user and add to stall' : 'Create user'}
        </Button>
      </form>
      ) : null}

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
              const self = user.email.toLowerCase() === String(sessionEmail ?? '').toLowerCase()
              return (
                <tr key={user.id}>
                  <td className="px-3 py-3 align-top">
                    <p className="font-medium">{user.email}</p>
                    {user.displayName ? (
                      <p className="text-xs text-[var(--color-muted)]">{user.displayName}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 align-top">
                    {locationModeEnabled && (user.effectiveRole ?? user.role) === 'admin' ? (
                      <label className="mb-3 flex items-center gap-2 text-sm">
                        <input type="checkbox" aria-label={`Final Rate for ${user.email}`}
                          checked={user.canViewFinalRate === true} disabled={busy || isReadOnly || user.disabled}
                          onChange={event => handleFinalRateAccess(user.id, event.target.checked)} />
                        Final Rate visibility
                      </label>
                    ) : null}
                    {locationModeEnabled && (user.effectiveRole ?? user.role)==='admin'?<label className="mb-3 flex items-center gap-2 text-sm">
                      <input type="checkbox" aria-label={`Billing Finalization for ${user.email}`}
                        checked={billingPermissions?.contextKey===contextKey&&Boolean(billingPermissions.rows.find(row=>row.userId===user.id))}
                        disabled={busy||isReadOnly||user.disabled||billingPermissions?.contextKey!==contextKey}
                        onChange={event=>handleBillingAccess(user.id,event.target.checked)} />
                      Billing Finalization
                    </label>:null}
                    {locationModeEnabled&&billingError?<p className="admin-field-error">{billingError}</p>:null}
                    {showOwnerActions ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="rounded border px-2 py-1.5 text-sm"
                          value={draft}
                          disabled={busy || (locationModeEnabled && (user.userDisabled || user.seasonMembershipDisabled))}
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
                          disabled={busy || !roleDirty || (locationModeEnabled && (user.userDisabled || user.seasonMembershipDisabled))}
                          onClick={() => handleSaveRole(user.id)}
                        >
                          Update role
                        </Button>
                      </div>
                    ) : (
                      <span>{adminUserRoleSelectLabel(user.role)}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top text-[var(--color-muted)]">
                    {user.disabled ? 'Disabled' : 'Active'}
                    {locationModeEnabled && user.userDisabled ? <p className="text-xs">Login disabled</p> : null}
                    {locationModeEnabled && user.seasonMembershipDisabled ? <p className="text-xs">Season membership disabled</p> : null}
                    {locationModeEnabled && user.effectiveRole && user.effectiveRole !== user.role ? <p className="text-xs">Effective role: {adminUserRoleSelectLabel(user.effectiveRole)}</p> : null}
                  </td>
                  <td className="px-3 py-3 align-top">
                    {showOwnerActions ? (
                      <div className="flex flex-wrap gap-2">
                        {!locationModeEnabled ? <button
                          type="button"
                          className="admin-link-button"
                          disabled={busy}
                          onClick={() => { setResetUserId(user.id); setResetPassword('') }}
                        >
                          Reset password
                        </button> : null}
                        {!locationModeEnabled && resetUserId === user.id ? (
                          <form aria-label={`Reset password for ${user.email}`} className="w-full space-y-2"
                            onSubmit={handleReset} onReset={() => { setResetUserId(null); setResetPassword('') }}>
                            <label className="admin-field">
                              <span className="admin-label">New password (min 12 characters)</span>
                              <PasswordInput value={resetPassword} onChange={event => setResetPassword(event.target.value)}
                                required minLength={12} autoComplete="new-password" disabled={busy} />
                            </label>
                            <button type="submit" className="admin-link-button" disabled={busy}>Change password</button>{' '}
                            <button type="reset" className="admin-link-button" disabled={busy}>Cancel</button>
                          </form>
                        ) : null}
                        {user.disabled ? (
                          <button
                            type="button"
                            className="admin-link-button"
                            disabled={busy || (locationModeEnabled && (user.userDisabled || user.seasonMembershipDisabled))}
                            onClick={() => handleEnable(user.id)}
                          >
                            Enable
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="admin-link-button"
                            disabled={busy || (locationModeEnabled && self)}
                            onClick={() => handleDisable(user.id)}
                          >
                            Disable
                          </button>
                        )}
                        {locationModeEnabled ? <button type="button" className="admin-link-button" disabled={busy || self} onClick={() => handleRemove(user)}>Remove member</button> : null}
                      </div>
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
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
