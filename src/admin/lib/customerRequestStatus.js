/** @typedef {'received' | 'reviewing' | 'quoted' | 'closed' | 'void'} CustomerRequestStatus */

/** Matches server `CUSTOMER_REQUEST_STATUSES` (adminCustomerRequestValidation.js). */
export const CUSTOMER_REQUEST_STATUSES = Object.freeze([
  'received',
  'reviewing',
  'quoted',
  'closed',
  'void',
])

export const TERMINAL_CUSTOMER_REQUEST_STATUSES = Object.freeze(['closed', 'void'])

const STATUS_SET = new Set(CUSTOMER_REQUEST_STATUSES)
const TERMINAL_SET = new Set(TERMINAL_CUSTOMER_REQUEST_STATUSES)

/** @type {Record<CustomerRequestStatus, string>} */
export const CUSTOMER_REQUEST_STATUS_LABELS = {
  received: 'Received',
  reviewing: 'Reviewing',
  quoted: 'Quoted',
  closed: 'Closed',
  void: 'Void',
}

/** @param {unknown} status */
export function isValidCustomerRequestStatus(status) {
  return STATUS_SET.has(String(status ?? '').trim())
}

/** @param {unknown} status */
export function isTerminalCustomerRequestStatus(status) {
  return TERMINAL_SET.has(String(status ?? '').trim())
}

/** @param {unknown} status */
export function customerRequestStatusLabel(status) {
  const key = String(status ?? '').trim()
  if (key in CUSTOMER_REQUEST_STATUS_LABELS) {
    return CUSTOMER_REQUEST_STATUS_LABELS[/** @type {CustomerRequestStatus} */ (key)]
  }
  return key || '—'
}

/** @param {unknown} status */
export function customerRequestStatusBadgeClass(status) {
  const key = String(status ?? '').trim()
  if (key === 'closed' || key === 'void') return 'admin-badge admin-badge--muted'
  if (key === 'quoted') return 'admin-badge'
  if (key === 'reviewing') return 'admin-badge admin-badge--status-reviewing'
  return 'admin-badge admin-badge--status-received'
}
