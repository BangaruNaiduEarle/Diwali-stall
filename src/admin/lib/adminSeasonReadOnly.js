/**
 * @param {string | null | undefined} seasonStatus
 */
export function isArchivedSeasonReadOnly(seasonStatus) {
  return String(seasonStatus ?? '').trim().toLowerCase() === 'archived'
}

export const ARCHIVED_SEASON_BANNER_TEXT = 'Archived season — Read only'

/**
 * @param {string | null | undefined} seasonStatus
 */
export function shouldBlockArchivedSeasonMutation(seasonStatus) {
  return isArchivedSeasonReadOnly(seasonStatus)
}

/**
 * @param {Event | { preventDefault?: () => void }} event
 * @param {string | null | undefined} seasonStatus
 */
export function preventArchivedSeasonFormSubmit(event, seasonStatus) {
  if (!shouldBlockArchivedSeasonMutation(seasonStatus)) return false
  event.preventDefault?.()
  return true
}
