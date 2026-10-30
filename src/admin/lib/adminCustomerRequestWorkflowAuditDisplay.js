import { formatRequestCreatedAt } from './adminCustomerRequestDisplay.js'

/** @param {unknown} value @returns {string | null} */
function trimmedEmail(value) {
  const s = String(value ?? '').trim()
  return s.length ? s : null
}

/**
 * Persisted workflow audit only — no inferred actors.
 *
 * @param {Record<string, unknown> | null | undefined} request
 * @returns {{ label: string, value: string }[]}
 */
export function customerRequestWorkflowAuditRows(request) {
  if (!request || typeof request !== 'object') return []

  /** @type {{ label: string, value: string }[]} */
  const rows = []

  const assignedTo = trimmedEmail(request.assignedToEmail)
  if (assignedTo) rows.push({ label: 'Assigned to', value: assignedTo })

  const assignedBy = trimmedEmail(request.assignedByEmail)
  if (assignedBy) rows.push({ label: 'Assigned by', value: assignedBy })

  const assignedAtRaw = request.assignedAt
  if (assignedBy && assignedAtRaw != null && String(assignedAtRaw).trim()) {
    rows.push({ label: 'Assigned at', value: formatRequestCreatedAt(assignedAtRaw) })
  }

  if (String(request.status ?? '') === 'closed') {
    const closedBy = trimmedEmail(request.closedByEmail)
    if (closedBy) rows.push({ label: 'Closed by', value: closedBy })

    const closedAtRaw = request.closedAt
    if (closedAtRaw != null && String(closedAtRaw).trim()) {
      rows.push({ label: 'Closed at', value: formatRequestCreatedAt(closedAtRaw) })
    }
  }

  return rows
}
