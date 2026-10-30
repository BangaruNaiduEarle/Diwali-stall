export const CUSTOMER_REQUEST_FINALIZATION_STATUSES = Object.freeze(['pending', 'finalized'])

const FINALIZATION_SET = new Set(CUSTOMER_REQUEST_FINALIZATION_STATUSES)

/** @param {unknown} value */
export function isValidCustomerRequestFinalizationStatus(value) {
  return FINALIZATION_SET.has(String(value ?? '').trim())
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, data: { assigneeUserId?: string, assigneeEmail?: string } } | { ok: false, errors: Record<string, string> }}
 */
export function validateCustomerRequestAssignBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }
  const record = /** @type {Record<string, unknown>} */ (body)
  const allowed = new Set(['assigneeUserId', 'assignee_user_id', 'assigneeEmail', 'assignee_email'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return { ok: false, errors: { [key]: 'Field is not allowed.' } }
    }
  }

  const userIdRaw = record.assigneeUserId ?? record.assignee_user_id
  const emailRaw = record.assigneeEmail ?? record.assignee_email
  const userId = userIdRaw != null ? String(userIdRaw).trim() : ''
  const email = emailRaw != null ? String(emailRaw).trim().toLowerCase() : ''

  if (!userId && !email) {
    return {
      ok: false,
      errors: { assigneeUserId: 'Assignee user id or email is required.' },
    }
  }
  if (userId && email) {
    return {
      ok: false,
      errors: { assigneeUserId: 'Provide either assignee user id or email, not both.' },
    }
  }

  if (userId) {
    return { ok: true, data: { assigneeUserId: userId } }
  }
  return { ok: true, data: { assigneeEmail: email } }
}
