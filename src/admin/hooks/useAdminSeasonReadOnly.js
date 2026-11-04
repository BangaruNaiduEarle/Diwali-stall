import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { ARCHIVED_SEASON_BANNER_TEXT, isArchivedSeasonReadOnly } from '../lib/adminSeasonReadOnly.js'

export function useAdminSeasonReadOnly() {
  const { seasonStatus, locationModeEnabled, capabilities, seasonSwitching } = useAdminSession()
  const isReadOnly = isArchivedSeasonReadOnly(seasonStatus) || Boolean(locationModeEnabled && (!capabilities.write || seasonSwitching))
  return {
    isReadOnly,
    seasonStatus,
    bannerText: isReadOnly ? (isArchivedSeasonReadOnly(seasonStatus) ? ARCHIVED_SEASON_BANNER_TEXT : 'Selected stall — Read only') : null,
  }
}
