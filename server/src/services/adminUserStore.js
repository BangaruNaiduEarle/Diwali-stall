import { normalizeAdminRole } from '../lib/adminRoles.js'

/**
 * @typedef {{ id: string, email: string, displayName: string | null, role: import('../lib/adminRoles.js').AdminRole, passwordHash: string | null, disabledAt: string | null }} AdminUserRow
 */

/**
 * @param {D1Database} db
 * @param {string} email
 */
export async function getAdminUserByEmail(db, email) {
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized) return null
  const row = await db
    .prepare(
      `SELECT id, email, display_name, role, password_hash, disabled_at
       FROM admin_users WHERE lower(email) = ? LIMIT 1`,
    )
    .bind(normalized)
    .first()
  if (!row) return null
  return mapAdminUserRow(row)
}

/**
 * @param {D1Database} db
 * @param {string} id
 */
export async function getAdminUserById(db, id) {
  const row = await db
    .prepare(
      `SELECT id, email, display_name, role, password_hash, disabled_at
       FROM admin_users WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first()
  if (!row) return null
  return mapAdminUserRow(row)
}

/** @param {Record<string, unknown>} row */
export function mapAdminUserRow(row) {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: row.display_name != null ? String(row.display_name) : null,
    role: normalizeAdminRole(row.role),
    passwordHash: row.password_hash != null ? String(row.password_hash) : null,
    disabledAt: row.disabled_at != null ? String(row.disabled_at) : null,
  }
}

/**
 * @param {AdminUserRow | null} user
 */
export function isAdminUserActive(user) {
  if (!user) return false
  if (user.disabledAt) return false
  return true
}

/**
 * @param {D1Database} db
 */
export async function countActiveAdminUsers(db) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM admin_users WHERE disabled_at IS NULL')
    .first()
  return Number(row?.n ?? 0)
}

/**
 * @param {D1Database} db
 */
export async function countOwnersWithPassword(db) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM admin_users
       WHERE role = 'owner' AND password_hash IS NOT NULL AND disabled_at IS NULL`,
    )
    .first()
  return Number(row?.n ?? 0)
}

/**
 * @param {D1Database} db
 * @param {string} [excludeUserId]
 */
export async function countActiveOwners(db, excludeUserId = '') {
  const exclude = String(excludeUserId ?? '').trim()
  const row = exclude
    ? await db
        .prepare(
          `SELECT COUNT(*) AS n FROM admin_users
           WHERE role = 'owner' AND disabled_at IS NULL AND id != ?`,
        )
        .bind(exclude)
        .first()
    : await db
        .prepare(
          `SELECT COUNT(*) AS n FROM admin_users WHERE role = 'owner' AND disabled_at IS NULL`,
        )
        .first()
  return Number(row?.n ?? 0)
}

/**
 * @param {D1Database} db
 */
export async function listAdminUsers(db) {
  const result = await db
    .prepare(
      `SELECT id, email, display_name, role, disabled_at, created_at, updated_at
       FROM admin_users ORDER BY role DESC, email ASC`,
    )
    .all()
  return (result.results ?? []).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    displayName: row.display_name != null ? String(row.display_name) : null,
    role: normalizeAdminRole(row.role),
    disabled: Boolean(row.disabled_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }))
}
