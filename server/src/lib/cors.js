/**
 * Explicit CORS for split hosting (e.g. Vercel SPA → Workers API).
 * When CORS_ALLOWED_ORIGINS is unset/empty, no CORS headers are added (same-origin / non-browser clients).
 */

export const CORS_ALLOW_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'

export const CORS_ALLOW_HEADERS = 'Content-Type, Idempotency-Key, Cf-Access-Jwt-Assertion, Cookie'

/**
 * @param {Record<string, unknown>} env
 * @returns {Set<string> | null} null when CORS is disabled
 */
export function parseCorsAllowedOrigins(env) {
  const raw = String(env?.CORS_ALLOWED_ORIGINS ?? '').trim()
  if (!raw) return null

  /** @type {Set<string>} */
  const allowed = new Set()
  for (const part of raw.split(',')) {
    const origin = normalizeOrigin(part)
    if (origin) allowed.add(origin)
  }
  return allowed.size ? allowed : null
}

/**
 * @param {string} value
 */
export function normalizeOrigin(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * @param {string | null} origin
 * @param {Set<string> | null} allowed
 */
export function isOriginAllowed(origin, allowed) {
  if (!allowed || !origin) return false
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  return allowed.has(normalized)
}

/**
 * @param {string} pathname
 */
export function isCorsApiPath(pathname) {
  return pathname === '/health' || pathname.startsWith('/api/')
}

/**
 * @param {Request} request
 * @param {Set<string> | null} allowed
 * @returns {Record<string, string> | null}
 */
export function corsHeadersForRequest(request, allowed) {
  const origin = request.headers.get('Origin')
  if (!origin || !isOriginAllowed(origin, allowed)) return null

  return {
    'Access-Control-Allow-Origin': normalizeOrigin(origin) ?? origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}

/**
 * @param {Request} request
 * @param {Set<string> | null} allowed
 * @returns {Response | null}
 */
export function handleCorsPreflight(request, allowed) {
  if (request.method !== 'OPTIONS') return null

  const url = new URL(request.url)
  if (!isCorsApiPath(url.pathname)) return null
  if (!allowed) return null

  const origin = request.headers.get('Origin')
  if (!origin || !isOriginAllowed(origin, allowed)) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } })
  }

  const requestMethod = request.headers.get('Access-Control-Request-Method')
  if (!requestMethod) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } })
  }

  const base = corsHeadersForRequest(request, allowed)
  if (!base) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } })
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...base,
      'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  })
}

/**
 * @param {Response} response
 * @param {Request} request
 * @param {Set<string> | null} allowed
 */
export function applyCorsToResponse(response, request, allowed) {
  const cors = corsHeadersForRequest(request, allowed)
  if (!cors) return response

  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
