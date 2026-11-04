import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import AdminFeedbackBanner from './AdminFeedbackBanner.jsx'
import {
  archivePlatformBusinessSeason,
  createPlatformBusinessSeason,
  fetchPlatformBusinessSeasons,
  reactivatePlatformBusinessSeason,
  updatePlatformBusinessSeason,
} from '../api/adminPlatformApi.js'
import {
  archivePlatformSeasonConfirmMessage,
  mergePlatformSeasonIntoList,
  platformSeasonRowActions,
  platformSeasonStatusDisplay,
  reactivatePlatformSeasonConfirmMessage,
} from '../lib/adminPlatformSeasonList.js'
import {
  validatePlatformSeasonCreateForm,
  validatePlatformSeasonEditForm,
} from '../lib/adminPlatformSeasonFormValidation.js'
import PlatformSeasonMembersPanel from './PlatformSeasonMembersPanel.jsx'

/** @typedef {import('../lib/adminPlatformSeasonList.js').PlatformBusinessSeason} PlatformBusinessSeason */

export default function PlatformBusinessSeasonsSection() {
  const [seasons, setSeasons] = useState(/** @type {PlatformBusinessSeason[]} */ ([]))
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [success, setSuccess] = useState('')
  const [createForm, setCreateForm] = useState({ id: '', code: '', label: '' })
  const [createFieldError, setCreateFieldError] = useState(/** @type {Record<string, string>} */ ({}))
  const [creating, setCreating] = useState(false)
  /** @type {[Record<string, { code: string, label: string }>, Function]} */
  const [editDraft, setEditDraft] = useState({})
  const [editFieldError, setEditFieldError] = useState(/** @type {Record<string, string>} */ ({}))
  const [savingId, setSavingId] = useState(/** @type {string | null} */ (null))
  const [statusBusyId, setStatusBusyId] = useState(/** @type {string | null} */ (null))
  const [managingMembersSeasonId, setManagingMembersSeasonId] = useState(/** @type {string | null} */ (null))

  const syncEditDraft = useCallback((rows) => {
    setEditDraft(
      Object.fromEntries(rows.map((s) => [s.id, { code: s.code, label: s.label }])),
    )
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setListError('')
    const result = await fetchPlatformBusinessSeasons()
    if (!result.ok) {
      setListError(result.message)
      setSeasons([])
      setEditDraft({})
      setLoading(false)
      return
    }
    setSeasons(result.seasons)
    syncEditDraft(result.seasons)
    setLoading(false)
  }, [syncEditDraft])

  useEffect(() => {
    load()
  }, [load])

  const seasonsById = useMemo(() => new Map(seasons.map((s) => [s.id, s])), [seasons])

  function applySeasonMutation(season) {
    setSeasons((prev) => mergePlatformSeasonIntoList(prev, season))
    setEditDraft((prev) => ({
      ...prev,
      [season.id]: { code: season.code, label: season.label },
    }))
  }

  const handleMembersSeasonUpdated = useCallback((season) => {
    setSeasons((prev) => mergePlatformSeasonIntoList(prev, season))
    setEditDraft((prev) => ({
      ...prev,
      [season.id]: { code: season.code, label: season.label },
    }))
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setCreateFieldError({})
    setSuccess('')
    setListError('')

    const validated = validatePlatformSeasonCreateForm(createForm)
    if (!validated.ok) {
      setCreateFieldError({ [validated.field ?? 'id']: validated.message })
      return
    }

    setCreating(true)
    const result = await createPlatformBusinessSeason({
      id: validated.id,
      code: validated.code,
      label: validated.label,
    })
    setCreating(false)
    if (!result.ok) {
      setListError(result.message)
      return
    }
    applySeasonMutation(result.season)
    setSuccess(`Created ${result.season.label}.`)
    setCreateForm({ id: '', code: '', label: '' })
  }

  async function handleSaveEdit(seasonId) {
    const season = seasonsById.get(seasonId)
    const draft = editDraft[seasonId]
    if (!season || !draft) return

    setEditFieldError({})
    setSuccess('')
    setListError('')

    const validated = validatePlatformSeasonEditForm(draft)
    if (!validated.ok) {
      setEditFieldError({ [`${seasonId}.${validated.field ?? 'code'}`]: validated.message })
      return
    }

    if (validated.code === season.code && validated.label === season.label) {
      setSuccess('No changes to save.')
      return
    }

    setSavingId(seasonId)
    const result = await updatePlatformBusinessSeason(seasonId, {
      code: validated.code,
      label: validated.label,
    })
    setSavingId(null)
    if (!result.ok) {
      setListError(result.message)
      return
    }
    applySeasonMutation(result.season)
    setSuccess(`Updated ${result.season.label}.`)
  }

  async function handleArchive(seasonId) {
    const season = seasonsById.get(seasonId)
    if (!season || !platformSeasonRowActions(season.status).canArchive) return
    if (!window.confirm(archivePlatformSeasonConfirmMessage(season))) return

    setStatusBusyId(seasonId)
    setSuccess('')
    setListError('')
    const result = await archivePlatformBusinessSeason(seasonId)
    setStatusBusyId(null)
    if (!result.ok) {
      setListError(result.message)
      return
    }
    applySeasonMutation(result.season)
    setSuccess(`Archived ${result.season.label}.`)
  }

  async function handleReactivate(seasonId) {
    const season = seasonsById.get(seasonId)
    if (!season || !platformSeasonRowActions(season.status).canReactivate) return
    if (!window.confirm(reactivatePlatformSeasonConfirmMessage(season))) return

    setStatusBusyId(seasonId)
    setSuccess('')
    setListError('')
    const result = await reactivatePlatformBusinessSeason(seasonId)
    setStatusBusyId(null)
    if (!result.ok) {
      setListError(result.message)
      return
    }
    applySeasonMutation(result.season)
    setSuccess(`Reactivated ${result.season.label}.`)
  }

  function updateEditDraft(seasonId, patch) {
    setEditDraft((prev) => ({
      ...prev,
      [seasonId]: { ...prev[seasonId], ...patch },
    }))
  }

  return (
    <section className="admin-panel mt-6" aria-labelledby="platform-seasons-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="platform-seasons-heading" className="text-sm font-semibold text-[var(--color-charcoal)]">
            Business seasons
          </h2>
          <p className="admin-hint mt-1">
            Create and manage business seasons. Seasons are archived, not deleted. Public catalogue season
            is configured separately.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={load} disabled={loading || creating}>
          Refresh list
        </Button>
      </div>

      <AdminFeedbackBanner variant="error" message={listError} onDismiss={() => setListError('')} className="mt-4" />
      <AdminFeedbackBanner variant="success" message={success} onDismiss={() => setSuccess('')} className="mt-4" />

      <form className="mt-6 grid gap-4 md:grid-cols-3" onSubmit={handleCreate} aria-labelledby="create-season-heading">
        <h3 id="create-season-heading" className="md:col-span-3 text-sm font-semibold text-[var(--color-charcoal)]">
          Create season
        </h3>
        <div>
          <label className="admin-label" htmlFor="platform-season-id">
            Season id
          </label>
          <input
            id="platform-season-id"
            className={`admin-input mt-1 w-full${createFieldError.id ? ' admin-field__input--invalid' : ''}`}
            value={createForm.id}
            onChange={(e) => setCreateForm((f) => ({ ...f, id: e.target.value }))}
            placeholder="season-2030"
            autoComplete="off"
            disabled={creating}
            aria-invalid={createFieldError.id ? 'true' : undefined}
          />
          {createFieldError.id ? <p className="admin-field__error mt-1">{createFieldError.id}</p> : null}
        </div>
        <div>
          <label className="admin-label" htmlFor="platform-season-code">
            Code
          </label>
          <input
            id="platform-season-code"
            className={`admin-input mt-1 w-full${createFieldError.code ? ' admin-field__input--invalid' : ''}`}
            value={createForm.code}
            onChange={(e) => setCreateForm((f) => ({ ...f, code: e.target.value }))}
            placeholder="2030"
            autoComplete="off"
            disabled={creating}
            aria-invalid={createFieldError.code ? 'true' : undefined}
          />
          {createFieldError.code ? <p className="admin-field__error mt-1">{createFieldError.code}</p> : null}
        </div>
        <div>
          <label className="admin-label" htmlFor="platform-season-label">
            Label
          </label>
          <input
            id="platform-season-label"
            className={`admin-input mt-1 w-full${createFieldError.label ? ' admin-field__input--invalid' : ''}`}
            value={createForm.label}
            onChange={(e) => setCreateForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="Diwali 2030"
            disabled={creating}
            aria-invalid={createFieldError.label ? 'true' : undefined}
          />
          {createFieldError.label ? <p className="admin-field__error mt-1">{createFieldError.label}</p> : null}
        </div>
        <div className="md:col-span-3">
          <Button type="submit" variant="primary" loading={creating} disabled={creating}>
            Create season
          </Button>
        </div>
      </form>

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading seasons…
        </p>
      ) : null}

      {!loading && seasons.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--color-muted)]">No business seasons yet. Create one above.</p>
      ) : null}

      {!loading && seasons.length > 0 ? (
        <div className="admin-table-wrap mt-6">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Label</th>
                <th scope="col">Status</th>
                <th scope="col" className="admin-table__actions-col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((row) => {
                const draft = editDraft[row.id] ?? { code: row.code, label: row.label }
                const actions = platformSeasonRowActions(row.status)
                const dirty = draft.code.trim() !== row.code || draft.label.trim() !== row.label
                const codeErr = editFieldError[`${row.id}.code`]
                const labelErr = editFieldError[`${row.id}.label`]
                const statusClass =
                  row.status === 'archived' ? 'admin-table__meta admin-table__meta--warn' : 'admin-table__meta'

                return (
                  <tr key={row.id}>
                    <td>
                      <input
                        className={`admin-input w-full min-w-[5rem] max-w-[8rem]${codeErr ? ' admin-field__input--invalid' : ''}`}
                        value={draft.code}
                        onChange={(e) => updateEditDraft(row.id, { code: e.target.value })}
                        aria-label={`Code for ${row.id}`}
                        disabled={savingId === row.id || statusBusyId === row.id}
                      />
                      {codeErr ? <p className="admin-field__error mt-1">{codeErr}</p> : null}
                      <p className="admin-table__mono admin-table__meta mt-1">{row.id}</p>
                    </td>
                    <td>
                      <input
                        className={`admin-input w-full max-w-md${labelErr ? ' admin-field__input--invalid' : ''}`}
                        value={draft.label}
                        onChange={(e) => updateEditDraft(row.id, { label: e.target.value })}
                        aria-label={`Label for ${row.id}`}
                        disabled={savingId === row.id || statusBusyId === row.id}
                      />
                      {labelErr ? <p className="admin-field__error mt-1">{labelErr}</p> : null}
                    </td>
                    <td>
                      <span className={statusClass}>{platformSeasonStatusDisplay(row.status)}</span>
                    </td>
                    <td className="admin-table__actions-col">
                      <div className="admin-table__actions flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={!dirty || savingId === row.id || statusBusyId === row.id}
                          loading={savingId === row.id}
                          onClick={() => handleSaveEdit(row.id)}
                        >
                          Save
                        </Button>
                        {actions.canArchive ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={statusBusyId === row.id || savingId === row.id}
                            loading={statusBusyId === row.id}
                            onClick={() => handleArchive(row.id)}
                          >
                            Archive
                          </Button>
                        ) : null}
                        {actions.canReactivate ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={statusBusyId === row.id || savingId === row.id}
                            loading={statusBusyId === row.id}
                            onClick={() => handleReactivate(row.id)}
                          >
                            Reactivate
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={savingId === row.id || statusBusyId === row.id}
                          aria-expanded={managingMembersSeasonId === row.id}
                          onClick={() =>
                            setManagingMembersSeasonId((current) => (current === row.id ? null : row.id))
                          }
                        >
                          {managingMembersSeasonId === row.id ? 'Hide members' : 'Manage members'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {managingMembersSeasonId ? (
        <PlatformSeasonMembersPanel
          seasonId={managingMembersSeasonId}
          onClose={() => setManagingMembersSeasonId(null)}
          onSeasonUpdated={handleMembersSeasonUpdated}
        />
      ) : null}
    </section>
  )
}
