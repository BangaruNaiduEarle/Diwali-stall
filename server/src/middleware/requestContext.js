import {
  applyCorsToResponse,
  handleCorsPreflight,
  parseCorsAllowedOrigins,
} from '../lib/cors.js'
import { adminRequestSecurity } from './adminRequestSecurity.js'

/**
 * Request wrapper: preflight, unsafe-origin/media-type checks, response CORS.
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

  const blocked = adminRequestSecurity(request, allowed)
  if (blocked) return applyCorsToResponse(blocked, request, allowed)

  const response = await next()
  return applyCorsToResponse(response, request, allowed)
}
