/**
 * Admin API fetch wrapper. URLs from resolveApiUrl (VITE_API_BASE_URL or Vite /api proxy).
 * Sends cookies (session) on cross-origin requests when CORS allows credentials.
 */

import { resolveApiUrl } from '../../api/resolveApiUrl.js'
import { adminSeasonHeaderValueForPath, adminLocationHeaderValueForPath, getAdminRequestContext, isAdminOperationalApiPath } from './adminSeasonRequest.js'

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
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<{ ok: true, data: unknown, status: number } | { ok: false, status: number, error: string, message: string, fields?: Record<string, string> }>}
 */
export async function apiRequest(path, init = {}) {
  const context = getAdminRequestContext()
  const scoped = context.locationModeEnabled && isAdminOperationalApiPath(path)
  if (scoped && (context.switching || !context.activeSeasonId || !context.activeLocationId)) {
    return { ok: false, status: 409, error: 'location_context_required', message: 'Choose an authorized stall and wait for switching to finish.' }
  }
  const stale = () => scoped && context.generation !== getAdminRequestContext().generation
  const staleResponse = () => ({ ok: false, status: 409, error: 'stale_context', message: 'The active stall changed. Refresh this screen before continuing.' })
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const seasonHeader = adminSeasonHeaderValueForPath(path)
  if (seasonHeader && !headers.has('X-Admin-Season-Id')) {
    headers.set('X-Admin-Season-Id', seasonHeader)
  }
  // Location selection comes only from the confirmed/requested session context.
  headers.delete('X-Admin-Location-Id')
  const locationHeader = adminLocationHeaderValueForPath(path)
  if (locationHeader) headers.set('X-Admin-Location-Id', locationHeader)

  let res
  try {
    res = await fetch(resolveApiUrl(path), {
      ...init,
      headers,
      credentials: 'include',
    })
  } catch {
    if (stale()) return staleResponse()
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      message: 'Could not reach the admin API. Check VITE_API_BASE_URL and that the Worker is running.',
    }
  }

  const data = await parseJsonBody(res)
  if (stale()) return staleResponse()

  if (res.ok) {
    return { ok: true, data, status: res.status }
  }

  const body = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}
  return {
    ok: false,
    status: res.status,
    error: String(body.error ?? 'request_failed'),
    message: String(body.message ?? (res.statusText || 'Request failed.')),
    fields:
      body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
        ? /** @type {Record<string, string>} */ (body.fields)
        : undefined,
    missingProductIds: Array.isArray(body.missingProductIds)
      ? body.missingProductIds.map(String)
      : undefined,
    requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
  }
}
