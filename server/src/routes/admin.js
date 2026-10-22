import { normalizeAdminRole } from '../lib/adminRoles.js'
import { getAdminUserByEmail, getAdminUserById } from '../services/adminUserStore.js'

/**
 * Admin API stubs (Phase 2A) — protected by requireAdmin in index.js.
 */

/**
 * @param {Request} _request
 * @param {{ identity: { email: string, sub?: string, userId?: string, role?: string } }} context
 * @param {{ DB?: D1Database }} env
 */
export async function handleAdminSession(_request, context, env) {
  let role = normalizeAdminRole(context.identity.role)
  if (env.DB) {
    const user =
      (context.identity.userId
        ? await getAdminUserById(env.DB, String(context.identity.userId))
        : null) ?? (await getAdminUserByEmail(env.DB, context.identity.email))
    if (user?.role) role = normalizeAdminRole(user.role)
  }
  return Response.json(
    {
      ok: true,
      email: context.identity.email,
      role,
      userId: context.identity.userId ?? null,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
