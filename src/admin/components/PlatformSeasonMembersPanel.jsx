import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import AdminFeedbackBanner from './AdminFeedbackBanner.jsx'
import {
  assignPlatformSeasonMember,
  disablePlatformSeasonMember,
  enablePlatformSeasonMember,
  fetchPlatformSeasonMembers,
  updatePlatformSeasonMemberRole,
} from '../api/adminPlatformApi.js'
import { adminRoleDisplayLabel, adminUserRoleSelectLabel } from '../lib/adminRoles.js'
import { platformSeasonStatusDisplay } from '../lib/adminPlatformSeasonList.js'
import {
  mergePlatformSeasonMemberIntoList,
  PLATFORM_SEASON_MEMBER_ROLES,
  platformSeasonMemberMutationActions,
  platformSeasonMemberStatusSummary,
  validatePlatformSeasonMemberAssignForm,
} from '../lib/adminPlatformSeasonMembers.js'
import { loadPlatformSeasonMembersPanel } from './platformSeasonMembersPanelFetch.js'

/** @typedef {import('../lib/adminPlatformSeasonList.js').PlatformBusinessSeason} PlatformBusinessSeason */
/** @typedef {import('../lib/adminPlatformSeasonMembers.js').PlatformSeasonMember} PlatformSeasonMember */

/**
 * @param {{
 *   seasonId: string,
 *   onClose: () => void,
 *   onSeasonUpdated?: (season: PlatformBusinessSeason) => void,
 * }} props
 */
export default function PlatformSeasonMembersPanel({ seasonId, onClose, onSeasonUpdated }) {
  const [season, setSeason] = useState(/** @type {PlatformBusinessSeason | null} */ (null))
  const [members, setMembers] = useState(/** @type {PlatformSeasonMember[]} */ ([]))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [assignForm, setAssignForm] = useState({ email: '', role: 'owner' })
  const [assignFieldError, setAssignFieldError] = useState(/** @type {Record<string, string>} */ ({}))
  const [assigning, setAssigning] = useState(false)
  /** @type {[Record<string, string>, Function]} */
  const [roleDraft, setRoleDraft] = useState({})
  const [roleBusyId, setRoleBusyId] = useState(/** @type {string | null} */ (null))
  const [toggleBusyId, setToggleBusyId] = useState(/** @type {string | null} */ (null))

  const mutationActions = useMemo(
    () => platformSeasonMemberMutationActions(season?.status ?? 'active'),
    [season?.status],
  )

  const syncRoleDraft = useCallback((rows) => {
    setRoleDraft(Object.fromEntries(rows.map((m) => [m.userId, m.role])))
  }, [])

  const onSeasonUpdatedRef = useRef(onSeasonUpdated)
  useEffect(() => {
    onSeasonUpdatedRef.current = onSeasonUpdated
  }, [onSeasonUpdated])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await loadPlatformSeasonMembersPanel(seasonId, {
      fetchMembers: fetchPlatformSeasonMembers,
      syncRoleDraft,
      onSeasonUpdated: (season) => onSeasonUpdatedRef.current?.(season),
    })
    if (!result.ok) {
      setError(result.message)
      setSeason(null)
      setMembers([])
      setRoleDraft({})
      setLoading(false)
      return
    }
    setSeason(result.season)
    setMembers(result.members)
    setLoading(false)
  }, [seasonId, syncRoleDraft])

  useEffect(() => {
    load()
  }, [seasonId])

  const membersById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])

  function applyMemberMutation(member) {
    setMembers((prev) => mergePlatformSeasonMemberIntoList(prev, member))
    setRoleDraft((prev) => ({ ...prev, [member.userId]: member.role }))
  }

  async function handleAssign(e) {
    e.preventDefault()
    if (!mutationActions.canAssign) return
    setAssignFieldError({})
    setSuccess('')
    setError('')

    const validated = validatePlatformSeasonMemberAssignForm(assignForm)
    if (!validated.ok) {
      setAssignFieldError({ [validated.field ?? 'email']: validated.message })
      return
    }

    setAssigning(true)
    const result = await assignPlatformSeasonMember(seasonId, {
      email: validated.email,
      role: validated.role,
    })
    setAssigning(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    applyMemberMutation(result.member)
    setSuccess(`Added ${result.member.email} as ${adminRoleDisplayLabel(result.member.role)}.`)
    setAssignForm({ email: '', role: 'owner' })
  }

  async function handleSaveRole(userId) {
    if (!mutationActions.canChangeRole) return
    const member = membersById.get(userId)
    const draftRole = roleDraft[userId]
    if (!member || !draftRole) return
    if (draftRole === member.role) {
      setSuccess('No role change to save.')
      return
    }

    setRoleBusyId(userId)
    setSuccess('')
    setError('')
    const result = await updatePlatformSeasonMemberRole(seasonId, userId, draftRole)
    setRoleBusyId(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    applyMemberMutation(result.member)
    setSuccess(`Updated role for ${result.member.email}.`)
  }

  async function handleToggleMembership(userId, enable) {
    if (!mutationActions.canToggleMembership) return
    setToggleBusyId(userId)
    setSuccess('')
    setError('')
    const result = enable
      ? await enablePlatformSeasonMember(seasonId, userId)
      : await disablePlatformSeasonMember(seasonId, userId)
    setToggleBusyId(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    applyMemberMutation(result.member)
    setSuccess(
      enable
        ? `Re-enabled season membership for ${result.member.email}.`
        : `Disabled season membership for ${result.member.email} (login unchanged).`,
    )
  }

  return (
    <div className="admin-panel mt-4 border border-[var(--color-border)]" aria-labelledby="season-members-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="season-members-heading" className="text-sm font-semibold text-[var(--color-charcoal)]">
            Season members
          </h3>
          {season ? (
            <p className="admin-hint mt-1">
              <span className="admin-table__primary">{season.label}</span>{' '}
              <span className="admin-table__mono">({season.code})</span> ·{' '}
              {platformSeasonStatusDisplay(season.status)} ·{' '}
              <span className="admin-table__mono">{season.id}</span>
            </p>
          ) : (
            <p className="admin-hint mt-1 admin-table__mono">{seasonId}</p>
          )}
          {!mutationActions.canAssign ? (
            <p className="admin-table__meta admin-table__meta--warn mt-2">
              This season is archived. You can view members but cannot change membership.
            </p>
          ) : (
            <p className="admin-hint mt-2">
              Add an existing admin login by email. Multiple owners are allowed. Disable affects this season only,
              not the login globally.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <AdminFeedbackBanner variant="error" message={error} onDismiss={() => setError('')} className="mt-4" />
      <AdminFeedbackBanner variant="success" message={success} onDismiss={() => setSuccess('')} className="mt-4" />

      {mutationActions.canAssign ? (
        <form className="mt-6 grid gap-4 md:grid-cols-3" onSubmit={handleAssign} aria-labelledby="assign-member-heading">
          <h4 id="assign-member-heading" className="md:col-span-3 text-sm font-semibold text-[var(--color-charcoal)]">
            Add member
          </h4>
          <div className="md:col-span-2">
            <label className="admin-label" htmlFor={`assign-email-${seasonId}`}>
              Admin email
            </label>
            <input
              id={`assign-email-${seasonId}`}
              type="email"
              className={`admin-input mt-1 w-full${assignFieldError.email ? ' admin-field__input--invalid' : ''}`}
              value={assignForm.email}
              onChange={(e) => setAssignForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="owner@example.com"
              autoComplete="off"
              disabled={assigning}
            />
            {assignFieldError.email ? <p className="admin-field__error mt-1">{assignFieldError.email}</p> : null}
          </div>
          <div>
            <label className="admin-label" htmlFor={`assign-role-${seasonId}`}>
              Season role
            </label>
            <select
              id={`assign-role-${seasonId}`}
              className={`admin-input mt-1 w-full${assignFieldError.role ? ' admin-field__input--invalid' : ''}`}
              value={assignForm.role}
              onChange={(e) => setAssignForm((f) => ({ ...f, role: e.target.value }))}
              disabled={assigning}
            >
              {PLATFORM_SEASON_MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {adminUserRoleSelectLabel(r)}
                </option>
              ))}
            </select>
            {assignFieldError.role ? <p className="admin-field__error mt-1">{assignFieldError.role}</p> : null}
          </div>
          <div className="md:col-span-3">
            <Button type="submit" variant="primary" size="sm" loading={assigning} disabled={assigning}>
              Add to season
            </Button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading members…
        </p>
      ) : null}

      {!loading && members.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--color-muted)]">No members for this season yet.</p>
      ) : null}

      {!loading && members.length > 0 ? (
        <div className="admin-table-wrap mt-6">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col" className="admin-table__actions-col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((row) => {
                const draftRole = roleDraft[row.userId] ?? row.role
                const roleDirty = draftRole !== row.role
                const busy = roleBusyId === row.userId || toggleBusyId === row.userId
                const statusText = platformSeasonMemberStatusSummary(row)
                const statusWarn = row.membershipDisabled || row.userDisabled

                return (
                  <tr key={row.userId}>
                    <td>
                      <p className="admin-table__primary">{row.email}</p>
                      {row.displayName ? <p className="admin-table__meta">{row.displayName}</p> : null}
                      <p className="admin-table__mono admin-table__meta">{row.userId}</p>
                    </td>
                    <td>
                      <select
                        className="admin-input w-full max-w-[10rem]"
                        value={draftRole}
                        onChange={(e) =>
                          setRoleDraft((prev) => ({ ...prev, [row.userId]: e.target.value }))
                        }
                        disabled={!mutationActions.canChangeRole || busy}
                        aria-label={`Role for ${row.email}`}
                      >
                        {PLATFORM_SEASON_MEMBER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {adminUserRoleSelectLabel(r)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={statusWarn ? 'admin-table__meta admin-table__meta--warn' : 'admin-table__meta'}>
                        {statusText}
                      </span>
                    </td>
                    <td className="admin-table__actions-col">
                      <div className="admin-table__actions flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {mutationActions.canChangeRole ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={!roleDirty || busy}
                            loading={roleBusyId === row.userId}
                            onClick={() => handleSaveRole(row.userId)}
                          >
                            Save role
                          </Button>
                        ) : null}
                        {mutationActions.canToggleMembership && !row.membershipDisabled ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            loading={toggleBusyId === row.userId}
                            onClick={() => handleToggleMembership(row.userId, false)}
                          >
                            Disable membership
                          </Button>
                        ) : null}
                        {mutationActions.canToggleMembership && row.membershipDisabled ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            loading={toggleBusyId === row.userId}
                            onClick={() => handleToggleMembership(row.userId, true)}
                          >
                            Enable membership
                          </Button>
                        ) : null}
                      </div>
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
