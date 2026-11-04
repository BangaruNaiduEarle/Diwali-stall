import { ADMIN_SESSION_COOKIE } from '../lib/adminSessionCookie.js'
import { isJsonContentType, JSON_HEADERS } from '../lib/http.js'
import { trustedRequestOrigin } from '../lib/trustedRequestOrigin.js'

export const isUnsafeMethod = method => !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())

function deny(status, error, message) {
  return Response.json({ error, message }, { status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } })
}

/** Runs before authentication, session last-seen writes, and route execution.
 * Cookie presence is enough: never query D1 to decide whether CSRF checks apply.
 */
export function adminRequestSecurity(request, allowed) {
  if (!isUnsafeMethod(request.method)) return null
  const path = new URL(request.url).pathname
  if (path.startsWith('/api/admin')) {
    const hasOrigin = request.headers.has('Origin')
    const cookies = request.headers.get('Cookie') ?? ''
    const sessionCookie = cookies.split(';').some(part => part.trim().split('=')[0].trim() === ADMIN_SESSION_COOKIE)
    const browserSignalled = [...request.headers.keys()].some(name => name.startsWith('sec-fetch-'))
    if ((hasOrigin && !trustedRequestOrigin(request, allowed)) || (!hasOrigin && (sessionCookie || browserSignalled))) {
      return deny(403, 'untrusted_origin', 'A trusted request origin is required for this action.')
    }
  }
  // Current API request bodies use JSON. Bodyless POST/DELETE actions remain
  // valid; endpoints requiring JSON also enforce it in readJsonBody itself.
  if (path.startsWith('/api/') && request.body !== null && !isJsonContentType(request.headers.get('Content-Type'))) {
    return deny(415, 'unsupported_media_type', 'Content-Type must be application/json with an optional UTF-8 charset.')
  }
  return null
}
