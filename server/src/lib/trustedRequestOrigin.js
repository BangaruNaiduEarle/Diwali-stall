import { normalizeOrigin } from './cors.js'

/** A single serialized HTTP(S) Origin, trusted independently of CORS responses.
 * Forwarded host/proto and Referer are not authorization inputs.
 */
export function trustedRequestOrigin(request, allowed) {
  const raw = request.headers.get('Origin')
  if (raw == null) return null
  const origin = normalizeOrigin(raw)
  if (!origin || raw.trim() !== origin) return null
  return origin === new URL(request.url).origin || allowed?.has(origin) ? origin : null
}
