import { readJsonBody, JSON_HEADERS } from '../lib/http.js'
import {
  createAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  setAdminUserDisabled,
} from '../services/adminUsersManagement.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {{ identity: { userId?: string, email: string, role?: string } }} auth
 */
export async function handleAdminUsersRoutes(request, env, auth) {
  if (auth.identity.role !== 'owner') {
    return Response.json(
      { error: 'forbidden', message: 'Owner access required.' },
      { status: 403, headers: NO_STORE },
    )
  }

  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method

  if (method === 'GET' && pathname === '/api/admin/users') {
    const users = await listAdminUsers(env.DB)
    return Response.json({ users }, { status: 200, headers: NO_STORE })
  }

  if (method === 'POST' && pathname === '/api/admin/users') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    const result = await createAdminUser(env.DB, {
      email: String(body.email ?? ''),
      password: String(body.password ?? ''),
      displayName: body.displayName != null ? String(body.displayName) : undefined,
    })
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json({ user: result.user }, { status: 201, headers: NO_STORE })
  }

  const disableMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/disable$/)
  if (method === 'POST' && disableMatch) {
    const result = await setAdminUserDisabled(env.DB, disableMatch[1], true, auth.identity.userId ?? '')
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json({ ok: true }, { status: 200, headers: NO_STORE })
  }

  const enableMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/enable$/)
  if (method === 'POST' && enableMatch) {
    const result = await setAdminUserDisabled(env.DB, enableMatch[1], false, auth.identity.userId ?? '')
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json({ ok: true }, { status: 200, headers: NO_STORE })
  }

  const resetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/)
  if (method === 'POST' && resetMatch) {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    const result = await resetAdminUserPassword(env.DB, resetMatch[1], String(body.password ?? ''))
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json({ ok: true }, { status: 200, headers: NO_STORE })
  }

  return null
}
