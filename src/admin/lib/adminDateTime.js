/** @typedef {'Asia/Kolkata'} AdminDisplayTimeZone */

export const ADMIN_DISPLAY_TIME_ZONE = 'Asia/Kolkata'

const SQLITE_UTC_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse API / D1 timestamps for display. SQLite `datetime('now')` values are treated as UTC.
 * @param {unknown} raw
 * @returns {Date | null}
 */
export function parseAdminTimestamp(raw) {
  if (raw == null || raw === '') return null
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const s = String(raw).trim()
  if (!s) return null

  if (/^\d+$/.test(s)) {
    const n = Number(s)
    if (!Number.isFinite(n)) return null
    const ms = n > 1e12 ? n : n * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }

  if (DATE_ONLY_RE.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`)
    return Number.isNaN(d.getTime()) ? null : d
  }

  if (SQLITE_UTC_DATETIME_RE.test(s)) {
    const d = new Date(`${s.replace(' ', 'T')}Z`)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * @param {Date} date
 */
function formatPartsInIST(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ADMIN_DISPLAY_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date)
}

/**
 * Example: `21 Oct 2026, 5:35 PM` (Asia/Kolkata).
 * @param {unknown} raw
 */
export function formatAdminDateTimeIST(raw) {
  const date = parseAdminTimestamp(raw)
  if (!date) return '—'

  const parts = formatPartsInIST(date)
  /** @type {Record<string, string>} */
  const map = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }

  const day = map.day ?? ''
  const month = map.month ?? ''
  const year = map.year ?? ''
  let hour = map.hour ?? ''
  const minute = map.minute ?? ''
  let dayPeriod = (map.dayPeriod ?? '').toUpperCase()
  const hourNum = Number(hour)
  if (Number.isFinite(hourNum) && hourNum === 0 && dayPeriod === 'AM') {
    hour = '12'
  }
  if (dayPeriod === 'AM' || dayPeriod === 'PM') {
    // already upper
  } else if (dayPeriod) {
    dayPeriod = dayPeriod.toUpperCase()
  }

  if (!day || !month || !year) return '—'

  const timeSegment =
    hour && minute && dayPeriod ? `${hour}:${minute} ${dayPeriod}` : hour && minute ? `${hour}:${minute}` : ''

  return timeSegment ? `${day} ${month} ${year}, ${timeSegment}` : `${day} ${month} ${year}`
}
