import { normalizeAdminRole } from '../lib/adminRoles.js'

/** Default season for backfilled data (Migration 0018). */
export const DEFAULT_ADMIN_SEASON_ID = 'season-2026'

export const PLATFORM_ADMIN_EXISTS_SQL = `
  SELECT 1 AS ok FROM platform_admins WHERE admin_user_id = ?
`.trim()

/**
 * @typedef {{
 *   seasonId: string,
 *   code: string,
 *   label: string,
 *   status: string,
 *   role: import('../lib/adminRoles.js').AdminRole,
 *   disabled: boolean,
 *   createdAt: string,
 * }} SeasonMembership
 */

/**
 * @typedef {{
 *   userId: string,
 *   platformAdmin: boolean,
 *   activeSeasonId: string | null,
 *   seasonRole: import('../lib/adminRoles.js').AdminRole | null,
 *   memberships: SeasonMembership[],
 * }} AdminSeasonContext
 */

/**
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<SeasonMembership[]>}
 */
export async function loadSeasonMemberships(db, userId) {
  const id = String(userId ?? '').trim()
  if (!id) return []

  const result = await db
    .prepare(
      `SELECT sm.season_id, sm.role, sm.disabled_at, sm.created_at,
              bs.code, bs.label, bs.status
       FROM season_members sm
       INNER JOIN business_seasons bs ON bs.id = sm.season_id
       WHERE sm.admin_user_id = ?
       ORDER BY sm.created_at ASC, sm.season_id ASC`,
    )
    .bind(id)
    .all()

  return (result.results ?? []).map((row) => ({
    seasonId: String(row.season_id),
    code: String(row.code),
    label: String(row.label),
    status: String(row.status),
    role: normalizeAdminRole(row.role),
    disabled: row.disabled_at != null && String(row.disabled_at).trim() !== '',
    createdAt: String(row.created_at),
  }))
}

/**
 * @param {SeasonMembership[]} memberships
 * @param {string | null | undefined} requestedSeasonId
 */
export function pickActiveSeasonId(memberships, requestedSeasonId) {
  const active = memberships.filter((m) => !m.disabled)
  if (active.length === 0) return null

  const requested = String(requestedSeasonId ?? '').trim()
  if (requested) {
    const match = active.find((m) => m.seasonId === requested)
    return match ? match.seasonId : null
  }

  if (active.length === 1) {
    return active[0].seasonId
  }

  return null
}

/**
 * @param {D1Database} db
 * @param {string} userId
 */
export async function isPlatformAdminUser(db, userId) {
  const id = String(userId ?? '').trim()
  if (!id) return false
  const row = await db.prepare(PLATFORM_ADMIN_EXISTS_SQL).bind(id).first()
  return row != null
}

/**
 * Resolve season-scoped role from season_members (not admin_users.role).
 * @param {D1Database} db
 * @param {{ userId: string, activeSeasonId?: string | null }} input
 * @returns {Promise<AdminSeasonContext>}
 */
export async function resolveAdminSeasonContext(db, input) {
  const userId = String(input.userId ?? '').trim()
  const [memberships, platformAdmin] = await Promise.all([
    userId ? loadSeasonMemberships(db, userId) : [],
    isPlatformAdminUser(db, userId),
  ])
  const activeSeasonId = pickActiveSeasonId(memberships, input.activeSeasonId ?? null)
  const activeMembership =
    activeSeasonId != null ? memberships.find((m) => m.seasonId === activeSeasonId && !m.disabled) : null

  return {
    userId,
    platformAdmin,
    activeSeasonId,
    seasonRole: activeMembership?.role ?? null,
    memberships,
  }
}
