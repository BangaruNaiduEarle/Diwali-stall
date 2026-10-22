import { normalizeOrigin, parseCorsAllowedOrigins } from './cors.js'

export const ADMIN_SESSION_COOKIE = 'diwali_admin_session'

/** When set (local dev), loopback dev JWT auth is skipped until password login clears it. */
export const ADMIN_DEV_JWT_SUPPRESS_COOKIE = 'diwali_admin_dev_jwt_suppress'

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
 * @param {Request} request
 */
export function isDevJwtSuppressActive(request) {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${ADMIN_DEV_JWT_SUPPRESS_COOKIE}=([^;]+)`),
  )
  const value = match ? decodeURIComponent(match[1]).trim() : ''
  return value === '1'
}

/**
 * @param {string} sessionId
 * @param {number} maxAgeSeconds
 * @param {{ secure?: boolean, sameSite?: 'Lax' | 'None' | 'Strict' }} [opts]
 */
export function buildSessionSetCookie(sessionId, maxAgeSeconds, opts = {}) {
  const secure = opts.secure !== false
  const sameSite = opts.sameSite ?? (secure ? 'None' : 'Lax')
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) parts.push('Secure')
  parts.push(`SameSite=${sameSite}`)
  return parts.join('; ')
}

/**
 * @param {{ secure?: boolean, sameSite?: 'Lax' | 'None' | 'Strict' }} [opts]
 */
export function buildSessionClearCookie(opts = {}) {
  const secure = opts.secure !== false
  const sameSite = opts.sameSite ?? (secure ? 'None' : 'Lax')
  const parts = [`${ADMIN_SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'Max-Age=0']
  if (secure) parts.push('Secure')
  parts.push(`SameSite=${sameSite}`)
  return parts.join('; ')
}

/**
 * @param {number} maxAgeSeconds
 * @param {{ secure?: boolean, sameSite?: 'Lax' | 'None' | 'Strict' }} [opts]
 */
export function buildDevJwtSuppressSetCookie(maxAgeSeconds, opts = {}) {
  const secure = opts.secure !== false
  const sameSite = opts.sameSite ?? (secure ? 'None' : 'Lax')
  const parts = [
    `${ADMIN_DEV_JWT_SUPPRESS_COOKIE}=1`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) parts.push('Secure')
  parts.push(`SameSite=${sameSite}`)
  return parts.join('; ')
}

/**
 * @param {{ secure?: boolean, sameSite?: 'Lax' | 'None' | 'Strict' }} [opts]
 */
export function buildDevJwtSuppressClearCookie(opts = {}) {
  const secure = opts.secure !== false
  const sameSite = opts.sameSite ?? (secure ? 'None' : 'Lax')
  const parts = [`${ADMIN_DEV_JWT_SUPPRESS_COOKIE}=`, 'Path=/', 'HttpOnly', 'Max-Age=0']
  if (secure) parts.push('Secure')
  parts.push(`SameSite=${sameSite}`)
  return parts.join('; ')
}

/**
 * Same-origin frontend proxy (e.g. Vercel /api → Worker): first-party cookies use Lax.
 * Direct cross-origin browser → Worker keeps SameSite=None.
 *
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @returns {{ secure: boolean, sameSite: 'Lax' | 'None' }}
 */
export function resolveSessionCookieOptions(request, env) {
  const secure = requestIsSecure(request)
  const forwardedHost = request.headers.get('X-Forwarded-Host')?.split(',')[0]?.trim().toLowerCase()
  if (forwardedHost && secure) {
    const allowed = parseCorsAllowedOrigins(env)
    if (allowed) {
      for (const origin of allowed) {
        const normalized = normalizeOrigin(origin)
        if (!normalized) continue
        try {
          if (new URL(normalized).host.toLowerCase() === forwardedHost) {
            return { secure: true, sameSite: 'Lax' }
          }
        } catch {
          /* ignore malformed origin */
        }
      }
    }
  }
  if (secure) return { secure: true, sameSite: 'None' }
  return { secure: false, sameSite: 'Lax' }
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
