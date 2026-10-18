import {
  applyCorsToResponse,
  handleCorsPreflight,
  parseCorsAllowedOrigins,
} from '../lib/cors.js'

/**
 * Request wrapper: CORS preflight + response headers (Phase 6.2).
 * Does not authenticate; admin routes still use requireAdmin.
 *
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {() => Response | Promise<Response>} next
 */
export async function withRequestContext(request, env, next) {
  const allowed = parseCorsAllowedOrigins(env)

  const preflight = handleCorsPreflight(request, allowed)
  if (preflight) return preflight

  const response = await next()
  return applyCorsToResponse(response, request, allowed)
}
