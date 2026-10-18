import { authenticateSessionFromRequest } from '../services/adminPasswordAuth.js'
import { getAdminUserByEmail, isAdminUserActive } from '../services/adminUserStore.js'
import { readAccessJwtFromRequest, verifyCloudflareAccessToken } from './accessJwt.js'
import {
  isCloudflareAccessConfigured,
  isLocalAdminDevAuthEnabled,
  verifyLocalDevAdminJwt,
} from './localAdminDevAuth.js'

/**
 * @typedef {{ email: string, sub?: string, userId?: string, role?: 'owner' | 'admin' }} AdminIdentity
 */

/**
 * Authenticate admin: session cookie → Cloudflare Access (optional) → loopback local dev JWT.
 * @param {Request} request
 * @param {{ DB?: D1Database, CF_ACCESS_TEAM_DOMAIN?: string, CF_ACCESS_AUD?: string }} env
 * @returns {Promise<
 *   | { ok: true, identity: AdminIdentity }
 *   | { ok: false, status: number, code: string, message: string }
 * >}
 */
export async function authenticateAdmin(request, env) {
  if (!env.DB) {
    return {
      ok: false,
      status: 503,
      code: 'database_unavailable',
      message: 'Database binding is not available.',
    }
  }

  const sessionIdentity = await authenticateSessionFromRequest(request, env.DB)
  if (sessionIdentity) {
    return { ok: true, identity: sessionIdentity }
  }

  const token = readAccessJwtFromRequest(request)
  const cfConfigured = isCloudflareAccessConfigured(env)

  if (cfConfigured) {
    if (!token) {
      return {
        ok: false,
        status: 401,
        code: 'unauthorized',
        message: 'Sign in required.',
      }
    }
    const verified = await verifyCloudflareAccessToken(token, env)
    if ('error' in verified) {
      return {
        ok: false,
        status: 401,
        code: 'unauthorized',
        message: 'Sign in required.',
      }
    }
    const user = await getAdminUserByEmail(env.DB, verified.email)
    if (!isAdminUserActive(user)) {
      return {
        ok: false,
        status: 403,
        code: 'forbidden',
        message: 'This account is not authorized for admin access.',
      }
    }
    return {
      ok: true,
      identity: {
        email: verified.email,
        sub: verified.sub,
        userId: user.id,
        role: user.role,
      },
    }
  }

  if (isLocalAdminDevAuthEnabled(env, request)) {
    if (!token) {
      return {
        ok: false,
        status: 401,
        code: 'unauthorized',
        message: 'Valid admin session required.',
      }
    }
    const localVerified = await verifyLocalDevAdminJwt(token, env)
    if ('error' in localVerified) {
      return {
        ok: false,
        status: 401,
        code: 'unauthorized',
        message: 'Valid admin session required.',
      }
    }
    const user = await getAdminUserByEmail(env.DB, localVerified.email)
    if (!isAdminUserActive(user)) {
      return {
        ok: false,
        status: 403,
        code: 'forbidden',
        message: 'This account is not authorized for admin access.',
      }
    }
    return {
      ok: true,
      identity: {
        email: localVerified.email,
        sub: localVerified.sub,
        userId: user?.id,
        role: user?.role ?? 'admin',
      },
    }
  }

  return {
    ok: false,
    status: 401,
    code: 'unauthorized',
    message: 'Sign in required.',
  }
}

/**
 * @param {{ status: number, code: string, message: string }} err
 */
export function adminAuthErrorResponse(err) {
  return Response.json(
    { error: err.code, message: err.message },
    {
      status: err.status,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
