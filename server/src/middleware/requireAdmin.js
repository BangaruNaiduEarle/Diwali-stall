import { adminAuthErrorResponse, authenticateAdmin } from './adminAuth.js'

/**
 * Fail-closed gate for /api/admin/* — call before any private handler.
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function requireAdmin(request, env) {
  return authenticateAdmin(request, env)
}

export { adminAuthErrorResponse }
