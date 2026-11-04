import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import AdminFeedbackBanner from './AdminFeedbackBanner.jsx'
import {
  fetchPlatformBusinessSeasons,
  fetchPlatformPublicCatalogueSeasonSetting,
  updatePlatformPublicCatalogueSeasonSetting,
} from '../api/adminPlatformApi.js'
import {
  filterActivePlatformBusinessSeasons,
  findPlatformBusinessSeasonById,
  formatPublicCatalogueSeasonDisplay,
  publicCatalogueSeasonSaveConfirmMessage,
  publicCatalogueSelectionIsDirty,
  validatePublicCatalogueSeasonSelection,
} from '../lib/adminPlatformPublicCatalogue.js'

/** @typedef {import('../lib/adminPlatformSeasonList.js').PlatformBusinessSeason} PlatformBusinessSeason */

export default function PlatformPublicCatalogueSection() {
  const [allSeasons, setAllSeasons] = useState(/** @type {PlatformBusinessSeason[]} */ ([]))
  const [currentSeasonId, setCurrentSeasonId] = useState(/** @type {string | null} */ (null))
  const [settingLoadError, setSettingLoadError] = useState('')
  const [seasonsLoadError, setSeasonsLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selection, setSelection] = useState('')
  const [selectionError, setSelectionError] = useState('')

  const activeSeasons = useMemo(() => filterActivePlatformBusinessSeasons(allSeasons), [allSeasons])

  const currentSeason = useMemo(
    () => findPlatformBusinessSeasonById(allSeasons, currentSeasonId),
    [allSeasons, currentSeasonId],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSettingLoadError('')
    setSeasonsLoadError('')

    const [seasonsResult, settingResult] = await Promise.all([
      fetchPlatformBusinessSeasons(),
      fetchPlatformPublicCatalogueSeasonSetting(),
    ])

    if (!seasonsResult.ok) {
      setSeasonsLoadError(seasonsResult.message)
      setAllSeasons([])
    } else {
      setAllSeasons(seasonsResult.seasons)
    }

    if (settingResult.ok) {
      setCurrentSeasonId(settingResult.publicCatalogueSeasonId)
      setSelection(settingResult.publicCatalogueSeasonId)
      setSettingLoadError('')
    } else {
      setCurrentSeasonId(null)
      setSelection('')
      setSettingLoadError(settingResult.message)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const currentDisplay = formatPublicCatalogueSeasonDisplay(currentSeason, currentSeasonId)
  const currentIsNotActive = Boolean(currentSeasonId && currentSeason?.status === 'archived')
  const dirty = publicCatalogueSelectionIsDirty(currentSeasonId, selection)

  async function handleSave(e) {
    e.preventDefault()
    setSelectionError('')
    setSuccess('')
    setError('')

    const validated = validatePublicCatalogueSeasonSelection(selection, activeSeasons)
    if (!validated.ok) {
      setSelectionError(validated.message)
      return
    }

    if (!dirty) {
      setSuccess('No change to save.')
      return
    }

    const nextSeason = findPlatformBusinessSeasonById(activeSeasons, validated.publicCatalogueSeasonId)
    const confirmed = window.confirm(
      publicCatalogueSeasonSaveConfirmMessage({
        currentId: currentSeasonId,
        nextId: validated.publicCatalogueSeasonId,
        currentLabel: formatPublicCatalogueSeasonDisplay(currentSeason, currentSeasonId),
        nextLabel: formatPublicCatalogueSeasonDisplay(nextSeason, validated.publicCatalogueSeasonId),
      }),
    )
    if (!confirmed) return

    setSaving(true)
    const result = await updatePlatformPublicCatalogueSeasonSetting(validated.publicCatalogueSeasonId)
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }

    setCurrentSeasonId(result.publicCatalogueSeasonId)
    setSelection(result.publicCatalogueSeasonId)
    setSettingLoadError('')
    setSuccess('Public catalogue season updated.')
  }

  return (
    <section className="admin-panel mt-6" aria-labelledby="platform-public-catalogue-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="platform-public-catalogue-heading" className="text-sm font-semibold text-[var(--color-charcoal)]">
            Public catalogue
          </h2>
          <p className="admin-hint mt-1">
            The selected business season drives the public Products catalogue, Family Packs shown to customers,
            and new customer request submissions. Changing it here does not happen automatically when you create,
            archive, or reactivate seasons.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={load} disabled={loading || saving}>
          Refresh
        </Button>
      </div>

      <AdminFeedbackBanner variant="error" message={error} onDismiss={() => setError('')} className="mt-4" />
      <AdminFeedbackBanner variant="success" message={success} onDismiss={() => setSuccess('')} className="mt-4" />
      <AdminFeedbackBanner
        variant="error"
        message={seasonsLoadError}
        onDismiss={() => setSeasonsLoadError('')}
        className="mt-4"
      />

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading public catalogue setting…
        </p>
      ) : null}

      {!loading ? (
        <>
          <dl className="mt-6 grid gap-2 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-[var(--color-muted)]">Currently selected</dt>
              <dd>{currentDisplay}</dd>
            </div>
          </dl>

          {settingLoadError ? (
            <p className="admin-table__meta admin-table__meta--warn mt-2" role="status">
              Could not load current setting: {settingLoadError}. You can still choose an active season below and
              save.
            </p>
          ) : null}

          {currentIsNotActive ? (
            <p className="admin-table__meta admin-table__meta--warn mt-2" role="status">
              The configured season is archived. Select an active season and save to restore the public catalogue.
            </p>
          ) : null}

          <form className="mt-6 max-w-xl grid gap-4" onSubmit={handleSave}>
            <div>
              <label className="admin-label" htmlFor="platform-public-catalogue-season">
                Public catalogue season
              </label>
              <select
                id="platform-public-catalogue-season"
                className={`admin-input mt-1 w-full${selectionError ? ' admin-field__input--invalid' : ''}`}
                value={selection}
                onChange={(e) => {
                  setSelection(e.target.value)
                  setSelectionError('')
                }}
                disabled={saving || activeSeasons.length === 0}
                aria-invalid={selectionError ? 'true' : undefined}
              >
                <option value="">Select an active season…</option>
                {activeSeasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.label} ({season.code}) — {season.id}
                  </option>
                ))}
              </select>
              {selectionError ? <p className="admin-field__error mt-1">{selectionError}</p> : null}
              {activeSeasons.length === 0 && !seasonsLoadError ? (
                <p className="admin-hint mt-2">No active business seasons available. Create or reactivate a season first.</p>
              ) : null}
            </div>
            <div>
              <Button
                type="submit"
                variant="primary"
                loading={saving}
                disabled={saving || !dirty || activeSeasons.length === 0}
              >
                Save public catalogue season
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </section>
  )
}
