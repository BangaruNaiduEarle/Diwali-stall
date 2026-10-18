/** @param {unknown} id */
export function formatShortRequestId(id) {
  const s = String(id ?? '').trim()
  if (s.length <= 14) return s
  return `${s.slice(0, 8)}…${s.slice(-4)}`
}

/** @param {unknown} raw */
export function formatRequestCreatedAt(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return '—'
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
