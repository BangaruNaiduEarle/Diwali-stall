import { formatAdminDateTimeIST } from './adminDateTime.js'

/** @param {unknown} id */
export function formatShortRequestId(id) {
  const s = String(id ?? '').trim()
  if (s.length <= 14) return s
  return `${s.slice(0, 8)}…${s.slice(-4)}`
}

/** @param {unknown} publicReference */
export function formatAdminPublicReference(publicReference) {
  const s = String(publicReference ?? '').trim()
  return s || '—'
}

/** @param {unknown} raw */
export function formatRequestCreatedAt(raw) {
  return formatAdminDateTimeIST(raw)
}
