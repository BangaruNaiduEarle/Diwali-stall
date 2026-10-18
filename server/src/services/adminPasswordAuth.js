import { randomBytesHex } from '../lib/passwordHash.js'
import {
  buildSessionClearCookie,
  buildSessionSetCookie,
  readSessionIdFromRequest,
  readSessionTtlSeconds,
  requestIsSecure,
} from '../lib/adminSessionCookie.js'
import {
  hashPassword,
  needsPasswordRehash,
  validatePasswordPolicy,
  verifyPassword,
} from '../lib/passwordHash.js'
import { getAdminUserByEmail, getAdminUserById, isAdminUserActive } from './adminUserStore.js'

const MAX_USERS = 5
const LOGIN_WINDOW_MINUTES = 15
const MAX_FAILS_PER_EMAIL = 8
const MAX_FAILS_PER_IP = 30

/**
 * @param {string} ip
 * @param {Record<string, unknown>} env
 */
async function hashClientIp(ip, env) {
  const pepper = String(env?.ADMIN_SESSION_PEPPER ?? 'diwali-admin-session').trim()
  const data = new TextEncoder().encode(`${pepper}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {Request} request
 */
export function clientIpFromRequest(request) {
  const cf = request.headers.get('CF-Connecting-IP')
  if (cf) return cf.trim()
  const xff = request.headers.get('X-Forwarded-For')
  if (xff) return xff.split(',')[0].trim()
  return 'unknown'
}

/**
 * @param {D1Database} db
 * @param {string} emailNormalized
 * @param {string} ipHash
 */
async function isLoginRateLimited(db, emailNormalized, ipHash) {
  const cutoff = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString()
  const emailRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM admin_login_attempts
       WHERE email_normalized = ? AND success = 0 AND attempted_at >= ?`,
    )
    .bind(emailNormalized, cutoff)
    .first()
  if (Number(emailRow?.n ?? 0) >= MAX_FAILS_PER_EMAIL) return true

  const ipRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM admin_login_attempts
       WHERE ip_hash = ? AND success = 0 AND attempted_at >= ?`,
    )
    .bind(ipHash, cutoff)
    .first()
  return Number(ipRow?.n ?? 0) >= MAX_FAILS_PER_IP
}

/**
 * @param {D1Database} db
 * @param {{ emailNormalized: string, ipHash: string, success: boolean }} entry
 */
async function recordLoginAttempt(db, entry) {
  await db
    .prepare(
      `INSERT INTO admin_login_attempts (email_normalized, ip_hash, success)
       VALUES (?, ?, ?)`,
    )
    .bind(entry.emailNormalized, entry.ipHash, entry.success ? 1 : 0)
    .run()
}

/**
 * @param {D1Database} db
 * @param {string} userId
 * @param {number} ttlSeconds
 */
async function createSession(db, userId, ttlSeconds) {
  const sessionId = randomBytesHex(32)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  await db
    .prepare('INSERT INTO admin_sessions (id, admin_user_id, expires_at) VALUES (?, ?, ?)')
    .bind(sessionId, userId, expiresAt)
    .run()
  return sessionId
}

/**
 * @param {D1Database} db
 * @param {string} sessionId
 */
export async function resolveSessionIdentity(db, sessionId) {
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.role, u.disabled_at, u.password_hash
       FROM admin_sessions s
       INNER JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.id = ? LIMIT 1`,
    )
    .bind(sessionId)
    .first()
  if (!row) return null
  if (String(row.expires_at) <= new Date().toISOString()) {
    await db.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(sessionId).run()
    return null
  }
  if (row.disabled_at) return null
  await db
    .prepare(`UPDATE admin_sessions SET last_seen_at = datetime('now') WHERE id = ?`)
    .bind(sessionId)
    .run()
  return {
    userId: String(row.id),
    email: String(row.email),
    role: row.role === 'owner' ? 'owner' : 'admin',
    sub: String(row.session_id),
  }
}

/**
 * @param {Request} request
 * @param {D1Database} db
 */
export async function authenticateSessionFromRequest(request, db) {
  const sessionId = readSessionIdFromRequest(request)
  if (!sessionId) return null
  return resolveSessionIdentity(db, sessionId)
}

/**
 * @param {Request} request
 * @param {D1Database} db
 * @param {Record<string, unknown>} env
 * @param {{ email: string, password: string }} creds
 */
export async function loginWithPassword(request, db, env, creds) {
  const email = String(creds.email ?? '').trim().toLowerCase()
  const password = String(creds.password ?? '')
  const ipHash = await hashClientIp(clientIpFromRequest(request), env)

  if (!email || !password) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Email and password are required.' }
  }

  if (await isLoginRateLimited(db, email, ipHash)) {
    return {
      ok: false,
      status: 429,
      code: 'rate_limited',
      message: 'Too many login attempts. Try again later.',
    }
  }

  const user = await getAdminUserByEmail(db, email)
  const validUser = user && isAdminUserActive(user) && user.passwordHash
  let success = false
  if (validUser) {
    success = await verifyPassword(password, user.passwordHash)
  }

  await recordLoginAttempt(db, { emailNormalized: email, ipHash, success })

  if (!validUser || !success) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Invalid email or password.' }
  }

  if (needsPasswordRehash(user.passwordHash)) {
    const upgraded = await hashPassword(password)
    await db
      .prepare(`UPDATE admin_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(upgraded, user.id)
      .run()
  }

  const ttl = readSessionTtlSeconds(env)
  const sessionId = await createSession(db, user.id, ttl)
  const secure = requestIsSecure(request)
  return {
    ok: true,
    identity: { userId: user.id, email: user.email, role: user.role, sub: sessionId },
    setCookie: buildSessionSetCookie(sessionId, ttl, { secure }),
  }
}

/**
 * @param {Request} request
 * @param {D1Database} db
 */
export async function logoutSession(request, db) {
  const sessionId = readSessionIdFromRequest(request)
  if (sessionId) {
    await db.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(sessionId).run()
  }
  const secure = requestIsSecure(request)
  return { ok: true, clearCookie: buildSessionClearCookie({ secure }) }
}

/**
 * @param {D1Database} db
 */
export async function isOwnerBootstrapComplete(db) {
  try {
    const row = await db
      .prepare('SELECT singleton_id FROM admin_owner_bootstrap WHERE singleton_id = 1 LIMIT 1')
      .first()
    return Boolean(row)
  } catch {
    return false
  }
}

/**
 * @param {unknown} err
 */
export function mapBootstrapBatchError(err) {
  const message = String(err?.message ?? err ?? '')
  if (
    /UNIQUE constraint failed|SQLITE_CONSTRAINT|admin_owner_bootstrap|duplicate/i.test(message)
  ) {
    return {
      ok: false,
      status: 409,
      code: 'bootstrap_complete',
      message: 'Owner bootstrap already completed.',
    }
  }
  return {
    ok: false,
    status: 500,
    code: 'bootstrap_failed',
    message: 'Owner bootstrap failed.',
  }
}

/**
 * One-time owner password setup using ADMIN_BOOTSTRAP_SECRET (min 32 chars in env).
 * @param {D1Database} db
 * @param {Record<string, unknown>} env
 * @param {{ email: string, password: string, bootstrapSecret: string, displayName?: string }} body
 */
export async function bootstrapOwnerAccount(db, env, body) {
  const expected = String(env?.ADMIN_BOOTSTRAP_SECRET ?? '').trim()
  if (expected.length < 32) {
    return {
      ok: false,
      status: 503,
      code: 'bootstrap_unavailable',
      message: 'Owner bootstrap is not configured on the server.',
    }
  }
  if (String(body.bootstrapSecret ?? '').trim() !== expected) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Invalid bootstrap secret.' }
  }

  if (await isOwnerBootstrapComplete(db)) {
    return {
      ok: false,
      status: 409,
      code: 'bootstrap_complete',
      message: 'Owner bootstrap already completed.',
    }
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const policyErr = validatePasswordPolicy(body.password)
  if (!email || !email.includes('@')) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Valid email is required.' }
  }
  if (policyErr) {
    return { ok: false, status: 400, code: 'validation_error', message: policyErr }
  }

  const passwordHash = await hashPassword(String(body.password))
  const existing = await getAdminUserByEmail(db, email)
  const displayName = String(body.displayName ?? '').trim() || existing?.displayName || 'Owner'
  const userId = existing?.id ?? `admin-${randomBytesHex(8)}`

  /** @type {D1PreparedStatement[]} */
  const statements = [
    db
      .prepare('INSERT INTO admin_owner_bootstrap (singleton_id, owner_user_id) VALUES (1, ?)')
      .bind(userId),
  ]

  if (existing) {
    statements.push(
      db
        .prepare(
          `UPDATE admin_users
           SET role = 'owner', password_hash = ?, display_name = ?, disabled_at = NULL, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .bind(passwordHash, displayName, existing.id),
    )
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO admin_users (id, email, display_name, role, password_hash)
           VALUES (?, ?, ?, 'owner', ?)`,
        )
        .bind(userId, email, displayName, passwordHash),
    )
  }

  try {
    await db.batch(statements)
  } catch (err) {
    return mapBootstrapBatchError(err)
  }

  return { ok: true, userId, email }
}

export { MAX_USERS, hashPassword, validatePasswordPolicy }
