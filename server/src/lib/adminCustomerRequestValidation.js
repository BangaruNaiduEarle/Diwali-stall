/** Status values enforced by customer_requests.status CHECK constraint. */
export const CUSTOMER_REQUEST_STATUSES = Object.freeze([
  'received',
  'reviewing',
  'quoted',
  'closed',
  'void',
])

const STATUS_SET = new Set(CUSTOMER_REQUEST_STATUSES)

/** Terminal statuses — cannot transition to a different status. */
export const TERMINAL_CUSTOMER_REQUEST_STATUSES = Object.freeze(['closed', 'void'])

const TERMINAL_SET = new Set(TERMINAL_CUSTOMER_REQUEST_STATUSES)

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IDEMPOTENCY_ID_RE = /^cr-[0-9a-f]{32}$/

export const ADMIN_CUSTOMER_REQUEST_LIST_LIMITS = {
  defaultLimit: 25,
  maxLimit: 100,
  maxPage: 10_000,
  maxSearchLength: 80,
}

const FORBIDDEN_STATUS_PATCH_KEYS = new Set([
  'unitRatePaise',
  'unit_rate_paise',
  'price',
  'x4',
  'total',
  'subtotal',
  'customer',
  'items',
  'customer_name',
  'customerName',
])

/** @param {string} id */
export function isValidCustomerRequestId(id) {
  const s = String(id ?? '').trim()
  if (s.length > 64 || s.length < 3) return false
  if (UUID_RE.test(s)) return true
  if (IDEMPOTENCY_ID_RE.test(s)) return true
  return false
}

/** @param {string} status */
export function isValidCustomerRequestStatus(status) {
  return STATUS_SET.has(String(status ?? '').trim())
}

/**
 * @param {string} currentStatus
 * @param {string} nextStatus
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function validateCustomerRequestStatusTransition(currentStatus, nextStatus) {
  const current = String(currentStatus ?? '').trim()
  const next = String(nextStatus ?? '').trim()
  if (current === next) return { ok: true }
  if (TERMINAL_SET.has(current)) {
    return {
      ok: false,
      code: 'invalid_transition',
      message: `Cannot change status from terminal state "${current}".`,
    }
  }
  return { ok: true }
}

/**
 * @param {URLSearchParams} searchParams
 * @returns {{ ok: true, data: { page: number, limit: number, offset: number, status?: string, q: string } } | { ok: false, errors: Record<string, string> }}
 */
export function parseAdminCustomerRequestListQuery(searchParams) {
  const errors = {}
  const pageRaw = searchParams.get('page')
  const limitRaw = searchParams.get('limit')
  const statusRaw = searchParams.get('status')
  const qRaw = searchParams.get('q')

  let page = 1
  if (pageRaw !== null && pageRaw !== '') {
    const n = Number(pageRaw)
    if (!Number.isInteger(n) || n < 1 || n > ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.maxPage) {
      errors.page = 'Page must be a positive integer.'
    } else {
      page = n
    }
  }

  let limit = ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.defaultLimit
  if (limitRaw !== null && limitRaw !== '') {
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n < 1) {
      errors.limit = 'Limit must be a positive integer.'
    } else if (n > ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.maxLimit) {
      errors.limit = `Limit must not exceed ${ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.maxLimit}.`
    } else {
      limit = n
    }
  }

  /** @type {string | undefined} */
  let status
  if (statusRaw !== null && statusRaw !== '') {
    const s = statusRaw.trim()
    if (!isValidCustomerRequestStatus(s)) {
      errors.status = 'Invalid status filter.'
    } else {
      status = s
    }
  }

  let q = ''
  if (qRaw !== null && qRaw.trim()) {
    q = qRaw.trim().slice(0, ADMIN_CUSTOMER_REQUEST_LIST_LIMITS.maxSearchLength)
  }

  if (Object.keys(errors).length) return { ok: false, errors }
  const offset = (page - 1) * limit
  return { ok: true, data: { page, limit, offset, status, q } }
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, data: { status: string } } | { ok: false, errors: Record<string, string> }}
 */
export function validateCustomerRequestStatusPatchBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }
  const record = /** @type {Record<string, unknown>} */ (body)
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_STATUS_PATCH_KEYS.has(key)) {
      return { ok: false, errors: { [key]: 'Field is not allowed.' } }
    }
  }
  if (!('status' in record)) {
    return { ok: false, errors: { status: 'Status is required.' } }
  }
  const status = String(record.status ?? '').trim()
  if (!status) {
    return { ok: false, errors: { status: 'Status is required.' } }
  }
  if (!isValidCustomerRequestStatus(status)) {
    return { ok: false, errors: { status: 'Unsupported status value.' } }
  }
  return { ok: true, data: { status } }
}
