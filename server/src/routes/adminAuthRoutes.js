import { readJsonBody, JSON_HEADERS } from '../lib/http.js'
import { bootstrapOwnerAccount, loginWithPassword, logoutSession } from '../services/adminPasswordAuth.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleAdminAuthRoutes(request, env) {
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method

  if (!env.DB) {
    return Response.json(
      { error: 'database_unavailable', message: 'Database binding is not available.' },
      { status: 503, headers: NO_STORE },
    )
  }

  if (method === 'POST' && pathname === '/api/admin/auth/login') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    const result = await loginWithPassword(request, env.DB, env, {
      email: String(body.email ?? ''),
      password: String(body.password ?? ''),
    })
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json(
      { ok: true, email: result.identity.email, role: result.identity.role },
      { status: 200, headers: { ...NO_STORE, 'Set-Cookie': result.setCookie } },
    )
  }

  if (method === 'POST' && pathname === '/api/admin/auth/logout') {
    const result = await logoutSession(request, env.DB)
    return Response.json(
      { ok: true },
      { status: 200, headers: { ...NO_STORE, 'Set-Cookie': result.clearCookie } },
    )
  }

  if (method === 'POST' && pathname === '/api/admin/auth/bootstrap-owner') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    const result = await bootstrapOwnerAccount(env.DB, env, {
      email: String(body.email ?? ''),
      password: String(body.password ?? ''),
      bootstrapSecret: String(body.bootstrapSecret ?? ''),
      displayName: body.displayName != null ? String(body.displayName) : undefined,
    })
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json(
      { ok: true, email: result.email, message: 'Owner password set. Sign in with POST /api/admin/auth/login.' },
      { status: 201, headers: NO_STORE },
    )
  }

  return null
}
