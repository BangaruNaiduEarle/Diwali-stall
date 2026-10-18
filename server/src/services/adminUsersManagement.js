import { hashPassword, MAX_USERS, validatePasswordPolicy } from './adminPasswordAuth.js'
import { countActiveAdminUsers, getAdminUserByEmail, getAdminUserById, listAdminUsers } from './adminUserStore.js'
import { randomBytesHex } from '../lib/passwordHash.js'

/**
 * @param {D1Database} db
 * @param {{ email: string, password: string, displayName?: string, role?: string }} input
 */
export async function createAdminUser(db, input) {
  if ((await countActiveAdminUsers(db)) >= MAX_USERS) {
    return {
      ok: false,
      status: 409,
      code: 'limit_reached',
      message: `At most ${MAX_USERS} active admin users are allowed.`,
    }
  }

  const email = String(input.email ?? '').trim().toLowerCase()
  const policyErr = validatePasswordPolicy(input.password)
  if (!email.includes('@')) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Valid email is required.' }
  }
  if (policyErr) {
    return { ok: false, status: 400, code: 'validation_error', message: policyErr }
  }

  if (String(input.role ?? '').trim().toLowerCase() === 'owner') {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Only the initial bootstrap can create the owner account.',
    }
  }

  const existing = await getAdminUserByEmail(db, email)
  if (existing) {
    return { ok: false, status: 409, code: 'conflict', message: 'An account with this email already exists.' }
  }

  const role = 'admin'
  const passwordHash = await hashPassword(String(input.password))
  const id = `admin-${randomBytesHex(8)}`
  const displayName = String(input.displayName ?? '').trim() || email

  await db
    .prepare(
      `INSERT INTO admin_users (id, email, display_name, role, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, email, displayName, role, passwordHash)
    .run()

  return { ok: true, user: { id, email, displayName, role, disabled: false } }
}

/**
 * @param {D1Database} db
 * @param {string} userId
 * @param {boolean} disabled
 * @param {string} actorUserId
 */
export async function setAdminUserDisabled(db, userId, disabled, actorUserId) {
  if (userId === actorUserId && disabled) {
    return { ok: false, status: 400, code: 'validation_error', message: 'You cannot disable your own account.' }
  }
  const user = await getAdminUserById(db, userId)
  if (!user) {
    return { ok: false, status: 404, code: 'not_found', message: 'User not found.' }
  }
  if (user.role === 'owner' && disabled) {
    const owners = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM admin_users WHERE role = 'owner' AND disabled_at IS NULL AND id != ?`,
      )
      .bind(userId)
      .first()
    if (Number(owners?.n ?? 0) === 0) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: 'At least one active owner must remain.',
      }
    }
  }

  await db
    .prepare(
      `UPDATE admin_users SET disabled_at = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(disabled ? new Date().toISOString() : null, userId)
    .run()

  if (disabled) {
    await db.prepare('DELETE FROM admin_sessions WHERE admin_user_id = ?').bind(userId).run()
  }

  return { ok: true }
}

/**
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} newPassword
 */
export async function resetAdminUserPassword(db, userId, newPassword) {
  const policyErr = validatePasswordPolicy(newPassword)
  if (policyErr) {
    return { ok: false, status: 400, code: 'validation_error', message: policyErr }
  }
  const user = await getAdminUserById(db, userId)
  if (!user) {
    return { ok: false, status: 404, code: 'not_found', message: 'User not found.' }
  }
  const passwordHash = await hashPassword(String(newPassword))
  await db
    .prepare(`UPDATE admin_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(passwordHash, userId)
    .run()
  await db.prepare('DELETE FROM admin_sessions WHERE admin_user_id = ?').bind(userId).run()
  return { ok: true }
}

export { listAdminUsers }
