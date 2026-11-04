import { useId, useState } from 'react'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { useOptionalStallSettings } from '../context/AdminStallSettingsContext.jsx'
import { adminRoleDisplayLabel } from '../lib/adminRoles.js'
import {
  describeActiveSeasonDisplay,
  formatSeasonMembershipOptionLabel,
  listSelectableSeasonMemberships,
} from '../lib/adminSeasonSelector.js'

/**
 * @param {{ className?: string }} props
 */
export default function AdminSeasonSelector({ className = '' }) {
  const settings = useOptionalStallSettings()?.displaySettings
  const {
    platformAdmin,
    memberships,
    activeSeasonId,
    seasonRole,
    seasonStatus,
    selectActiveSeason,
    seasonSwitching,
    locationModeEnabled,
    authorizedLocations,
    activeLocationId,
    location,
    business,
    effectiveRole,
    selectActiveLocation,
  } = useAdminSession()
  const selectId = useId()
  const [switchError, setSwitchError] = useState(/** @type {string | null} */ (null))

  if (platformAdmin && memberships.length === 0) {
    return (
      <div className={`admin-season-select admin-season-select--platform ${className}`.trim()}>
        <span className="admin-season-select__badge">Platform admin</span>
      </div>
    )
  }

  if (memberships.length === 0) {
    return null
  }

  const selectable = listSelectableSeasonMemberships(memberships).filter(membership => !locationModeEnabled ||
    authorizedLocations.some(row => row.operatingSeason.id === membership.seasonId))
  const stalls = authorizedLocations?.filter(row => row.operatingSeason.id === activeSeasonId) ?? []
  const display = describeActiveSeasonDisplay({
    activeSeasonId,
    seasonRole,
    seasonStatus,
    memberships,
  })

  async function handleChange(e) {
    const value = e.target.value
    setSwitchError(null)
    if (!value) return
    const result = await selectActiveSeason(value)
    if (!result.ok) {
      setSwitchError(result.message ?? 'Could not switch season.')
    }
  }

  const showSelect = selectable.length > 0
  const activeIsSelectable =
    activeSeasonId != null && selectable.some((m) => m.seasonId === activeSeasonId)
  const selectValue = activeIsSelectable ? activeSeasonId : ''

  return (
    <div className={`admin-season-select ${className}`.trim()}>
      <div className="admin-season-select__field">
        <label className="admin-season-select__label" htmlFor={selectId}>
          Season
        </label>
        <div className="admin-season-select__row">
          {!activeIsSelectable && display.label ? (
            <span className="admin-season-select__static">{display.label}</span>
          ) : null}
          {showSelect ? (
            <select
              id={selectId}
              className="admin-season-select__control"
              value={selectValue}
              disabled={seasonSwitching}
              aria-busy={seasonSwitching}
              onChange={handleChange}
            >
              {!activeSeasonId ? (
                <option value="" disabled>
                  Choose season…
                </option>
              ) : null}
              {selectable.map((m) => (
                <option key={m.seasonId} value={m.seasonId}>
                  {formatSeasonMembershipOptionLabel(m)}
                </option>
              ))}
            </select>
          ) : (
            <span className="admin-season-select__static">{display.label ?? 'Season unavailable'}</span>
          )}
          {display.roleLabel ? (
            <span className="admin-season-select__role" title="Season role">
              {display.roleLabel}
              {display.readOnly ? ' · read-only' : ''}
            </span>
          ) : null}
        </div>
      </div>
      {locationModeEnabled ? (
        <>
          <div className="admin-season-select__field">
            <label className="admin-season-select__label" htmlFor={`${selectId}-stall`}>Active stall</label>
            <select id={`${selectId}-stall`} className="admin-season-select__control" value={activeLocationId ?? ''}
              disabled={seasonSwitching || stalls.length === 0} aria-busy={seasonSwitching}
              onChange={async e => {
                setSwitchError(null)
                const result = await selectActiveLocation(e.target.value)
                if (!result.ok) setSwitchError(result.message ?? 'Could not switch stall.')
              }}>
              {!activeLocationId ? <option value="" disabled>Choose an authorized stall…</option> : null}
              {stalls.map(row => <option key={row.location.id} value={row.location.id}>
                {row.business.name} · {settings?.scope.locationId === row.location.id ? settings.profile.stallName : row.location.name}{row.capabilities.write ? '' : ' (read-only)'}
              </option>)}
            </select>
          </div>
          <p className="admin-season-select__active" role="status">
            {location ? `${business.name} · ${settings?.profile.stallName ?? location.name} · ${adminRoleDisplayLabel(effectiveRole)}` :
              stalls.length ? 'Select a stall to start billing.' : 'No authorized stalls in this season. Contact your owner.'}
          </p>
        </>
      ) : null}
      {switchError ? (
        <p className="admin-season-select__error" role="status">
          {switchError}
        </p>
      ) : null}
    </div>
  )
}
