import { adminAuthErrorResponse, authenticateAdmin } from './adminAuth.js'
import { resolveAdminSeasonContext } from '../services/adminSeasonContext.js'
import { resolveAdminLocationContext } from '../services/adminLocationContext.js'
import { adminLocationMode, adminServiceMode, bindAdminServiceMode } from '../lib/adminServiceMode.js'
import { readWorkflowTransport } from '../lib/requestWorkflowAudit.js'
import { measureCustomerRequestList } from '../lib/customerRequestListTiming.js'
export { adminLocationMode } from '../lib/adminServiceMode.js'

/** @typedef {import('../services/adminSeasonContext.js').AdminSeasonContext} AdminSeasonContext */
/** @typedef {AdminSeasonContext & {
 * locationModeEnabled?: boolean,
 * locationContext?: Awaited<ReturnType<typeof resolveAdminLocationContext>> | null,
 * locationError?: { ok: false, status: number, code: string, message: string }
 * }} AdminRequestContext */

/** @type {WeakMap<Request, AdminRequestContext>} */
const adminContextByRequest = new WeakMap()

/**
 * Season context for the current admin request (set by requireAdmin after auth).
 * @param {Request} request
 * @returns {AdminRequestContext | null}
 */
export function getAdminContext(request) {
  return adminContextByRequest.get(request) ?? null
}

/** Validated location scope; null in legacy mode or after a denied resolution. */
export function getAdminLocationContext(request) {
  return getAdminContext(request)?.locationContext ?? null
}

/**
 * Attach request authorization after authentication, without changing identity or
 * session resolution. Session inspection and platform operations retain their
 * existing authorization; they do not require an operational location selection.
 * No location schema is queried while the gate is disabled.
 */
export async function attachAdminRequestContext(request, db, identity, env = {}) {
  adminContextByRequest.delete(request)
  bindAdminServiceMode(db, env)
  const adminContext = /** @type {AdminRequestContext} */ (await measureCustomerRequestList(request, 'season', () => attachAdminSeasonContext(request, db, identity)))
  const mode = adminLocationMode(env)
  if (mode === false) return { ok: true, adminContext }

  try { adminContext.workflowTransport = readWorkflowTransport(request) } catch (error) {
    return { ok: false, status: error.status, code: error.code, message: error.message }
  }

  adminContext.locationModeEnabled = true
  adminContext.locationContext = null
  if (mode === null) {
    const error = { ok: false, status: 503, code: 'location_context_unavailable', message: 'Admin location mode is not configured correctly.' }
    adminContext.locationError = error
    return error
  }

  const pathname = new URL(request.url).pathname
  if ((pathname === '/api/admin/session' && request.method === 'GET') ||
      pathname === '/api/admin/platform' || pathname.startsWith('/api/admin/platform/')) {
    return { ok: true, adminContext }
  }

  try {
    const location = await measureCustomerRequestList(request, 'location', () => resolveAdminLocationContext(db, {
      userId: adminContext.userId,
      activeSeasonId: adminContext.activeSeasonId,
      request,
      access: ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? 'read' : 'write',
    }))
    if (!location.ok) {
      adminContext.locationError = location
      return location
    }
    adminContext.locationContext = location
    return { ok: true, adminContext }
  } catch {
    const error = { ok: false, status: 503, code: 'location_context_unavailable', message: 'Admin location context is unavailable.' }
    adminContext.locationError = error
    return error
  }
}

/**
 * @param {Request} request
 * @param {D1Database} db
 * @param {{ userId?: string, email: string, role?: string }} identity
 * @returns {Promise<AdminSeasonContext>}
 */
export async function attachAdminSeasonContext(request, db, identity) {
  // Explicit legacy season-only callers initialize OFF. A previously configured
  // binding is never downgraded by this helper.
  if (adminServiceMode(db) === undefined) bindAdminServiceMode(db, {})
  const requestedSeasonId = request.headers.get('X-Admin-Season-Id')
  const adminContext = await resolveAdminSeasonContext(db, {
    userId: String(identity.userId ?? '').trim(),
    activeSeasonId: requestedSeasonId,
  })
  adminContextByRequest.set(request, adminContext)
  return adminContext
}

/**
 * Fail-closed gate for /api/admin/* — call before any private handler.
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @returns {Promise<
 *   | { ok: true, identity: import('./adminAuth.js').AdminIdentity, adminContext: AdminSeasonContext }
 *   | { ok: false, status: number, code: string, message: string }
 * >}
 */
export async function requireAdmin(request, env) {
  adminContextByRequest.delete(request)
  const auth = await measureCustomerRequestList(request, 'auth', () => authenticateAdmin(request, env))
  if (!auth.ok) {
    return auth
  }

  const attached = await attachAdminRequestContext(request, env.DB, auth.identity, env)
  if (!attached.ok) return attached
  const { adminContext } = attached

  return { ok: true, identity: auth.identity, adminContext }
}

export { adminAuthErrorResponse }
