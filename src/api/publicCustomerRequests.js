import { resolveApiUrl } from './resolveApiUrl.js'

/**
 * @param {Response} res
 */
async function parseJsonBody(res) {
  const text = await res.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} idempotencyKey
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<
 *   | { ok: true, status: number, request: unknown, idempotentReplay: boolean }
 *   | { ok: false, status: number, error: string, message: string, fields?: Record<string, string> }
 * >}
 */
export async function submitPublicCustomerRequest(body, idempotencyKey, fetchImpl = fetch) {
  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  }

  let res
  try {
    res = await fetchImpl(resolveApiUrl('/api/public/customer-requests'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      message: 'Could not reach the server. Check your connection and try again.',
    }
  }

  const data = await parseJsonBody(res)
  const payload = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}

  if (res.ok) {
    return {
      ok: true,
      status: res.status,
      request: payload.request,
      idempotentReplay: Boolean(payload.idempotentReplay),
    }
  }

  return {
    ok: false,
    status: res.status,
    error: String(payload.error ?? 'request_failed'),
    message: String(payload.message ?? (res.statusText || 'Could not save your request.')),
    fields:
      payload.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields)
        ? /** @type {Record<string, string>} */ (payload.fields)
        : undefined,
  }
}
