export const ADMIN_SESSION_COOKIE = 'diwali_admin_session'

export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60

/**
 * @param {Record<string, unknown>} env
 */
export function readSessionTtlSeconds(env) {
  const raw = Number(env?.ADMIN_SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL_SECONDS)
  if (!Number.isFinite(raw) || raw < 300 || raw > 86400) return DEFAULT_SESSION_TTL_SECONDS
  return Math.floor(raw)
}

/**
 * @param {Request} request
 */
export function readSessionIdFromRequest(request) {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${ADMIN_SESSION_COOKIE}=([^;]+)`))
  return match ? decodeURIComponent(match[1]).trim() : null
}

/**
 * @param {string} sessionId
 * @param {number} maxAgeSeconds
 * @param {{ secure?: boolean }} [opts]
 */
export function buildSessionSetCookie(sessionId, maxAgeSeconds, opts = {}) {
  const secure = opts.secure !== false
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) {
    parts.push('Secure', 'SameSite=None')
  } else {
    parts.push('SameSite=Lax')
  }
  return parts.join('; ')
}

/**
 * @param {{ secure?: boolean }} [opts]
 */
export function buildSessionClearCookie(opts = {}) {
  const secure = opts.secure !== false
  const parts = [`${ADMIN_SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'Max-Age=0']
  if (secure) parts.push('Secure', 'SameSite=None')
  else parts.push('SameSite=Lax')
  return parts.join('; ')
}

/**
 * @param {Request} request
 */
export function requestIsSecure(request) {
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}
