import { strictParseAdminRole } from '../lib/adminRoles.js'
import { getAdminUserByEmail, getAdminUserById } from './adminUserStore.js'
import { getPlatformBusinessSeasonById } from './adminPlatformSeasons.js'
import { adminLocationMode } from '../middleware/requireAdmin.js'

// Correlated to the membership being changed. Each affected location must retain
// its own enabled owner; a season owner elsewhere cannot satisfy this predicate.
export const PLATFORM_EFFECTIVE_OWNER_GUARD_SQL = `
  (season_members.role != 'owner' OR season_members.disabled_at IS NOT NULL AND season_members.disabled_at != ''
   OR NOT EXISTS (SELECT 1 FROM admin_users target_user WHERE target_user.id = season_members.admin_user_id
     AND (target_user.disabled_at IS NULL OR target_user.disabled_at = ''))
   OR (EXISTS (SELECT 1 FROM season_members other_season_owner JOIN admin_users other_user ON other_user.id = other_season_owner.admin_user_id
     WHERE other_season_owner.season_id = season_members.season_id AND other_season_owner.admin_user_id != season_members.admin_user_id
       AND other_season_owner.role = 'owner' AND (other_season_owner.disabled_at IS NULL OR other_season_owner.disabled_at = '')
       AND (other_user.disabled_at IS NULL OR other_user.disabled_at = ''))
   AND NOT EXISTS (SELECT 1 FROM location_members affected
     JOIN location_seasons association ON association.location_id = affected.location_id AND association.season_id = affected.season_id
     JOIN business_locations location ON location.id = affected.location_id
     JOIN businesses business ON business.id = location.business_id
     WHERE affected.admin_user_id = season_members.admin_user_id AND affected.season_id = season_members.season_id
       AND affected.role = 'owner' AND (affected.disabled_at IS NULL OR affected.disabled_at = '')
       AND association.status IN ('active', 'archived') AND location.status IN ('active', 'archived') AND business.status IN ('active', 'archived')
       AND NOT EXISTS (SELECT 1 FROM location_members remaining
         JOIN season_members authority ON authority.season_id = remaining.season_id AND authority.admin_user_id = remaining.admin_user_id
         JOIN admin_users identity ON identity.id = remaining.admin_user_id
         WHERE remaining.location_id = affected.location_id AND remaining.season_id = affected.season_id
           AND remaining.admin_user_id != affected.admin_user_id AND remaining.role = 'owner' AND authority.role = 'owner'
           AND (remaining.disabled_at IS NULL OR remaining.disabled_at = '') AND (authority.disabled_at IS NULL OR authority.disabled_at = '')
           AND (identity.disabled_at IS NULL OR identity.disabled_at = '')))))`

async function guardedMemberUpdate(db, season, uid, membership, field, value, losesOwner) {
  const result = await db.prepare(`UPDATE season_members SET ${field} = ?
    WHERE season_id = ? AND admin_user_id = ? AND role = ? AND disabled_at IS ?
      AND EXISTS (SELECT 1 FROM business_seasons mutable_season WHERE mutable_season.id = season_members.season_id AND mutable_season.status = 'active')
      ${losesOwner ? `AND ${PLATFORM_EFFECTIVE_OWNER_GUARD_SQL}` : ''}`)
    .bind(value, season, uid, membership.role, membership.disabled_at ?? null).run()
  return result.meta?.changes ? null : { ok: false, status: 409, code: 'membership_changed',
    message: 'Membership changed or the last effective season/location owner would be removed.' }
}

/**
 * @typedef {{
 *   userId: string,
 *   email: string,
 *   displayName: string | null,
 *   role: import('../lib/adminRoles.js').AdminRole,
 *   membershipDisabled: boolean,
 *   userDisabled: boolean,
 *   createdAt: string,
 * }} PlatformSeasonMember
 */

const LIST_PLATFORM_SEASON_MEMBERS_SQL = `
  SELECT sm.admin_user_id, sm.role, sm.disabled_at, sm.created_at,
         au.email, au.display_name, au.disabled_at AS user_disabled_at
  FROM season_members sm
  INNER JOIN admin_users au ON au.id = sm.admin_user_id
  WHERE sm.season_id = ?
  ORDER BY sm.role DESC, au.email ASC
`.trim()

/**
 * @param {D1Database} db
 * @param {string} seasonId
 */
export async function listPlatformSeasonMembers(db, seasonId) {
  const seasonResult = await getPlatformBusinessSeasonById(db, seasonId)
  if (!seasonResult.ok) return seasonResult

  const result = await db.prepare(LIST_PLATFORM_SEASON_MEMBERS_SQL).bind(seasonResult.season.id).all()
  const members = (result.results ?? []).map(mapPlatformSeasonMemberRow)
  return { ok: true, season: seasonResult.season, members }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {{ email?: string, role?: string }} input
 */
export async function assignPlatformSeasonMember(db, seasonId, input) {
  const seasonResult = await requireMutablePlatformSeason(db, seasonId)
  if (!seasonResult.ok) return seasonResult

  const email = String(input.email ?? '').trim().toLowerCase()
  if (!email.includes('@')) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Valid email is required.' }
  }

  const role = strictParseAdminRole(input.role ?? 'admin')
  if (!role) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Role must be owner, super_admin, or admin.' }
  }

  const user = await getAdminUserByEmail(db, email)
  if (!user) {
    return { ok: false, status: 404, code: 'not_found', message: 'Admin user not found for this email.' }
  }

  const existing = await getSeasonMembershipRow(db, seasonResult.season.id, user.id)
  if (existing) {
    return {
      ok: false,
      status: 409,
      code: 'conflict',
      message: 'This user is already a member of the season.',
    }
  }

  await db
    .prepare(
      `INSERT INTO season_members (season_id, admin_user_id, role, disabled_at)
       VALUES (?, ?, ?, NULL)`,
    )
    .bind(seasonResult.season.id, user.id, role)
    .run()

  const member = await getPlatformSeasonMember(db, seasonResult.season.id, user.id)
  if (!member.ok) {
    return { ok: false, status: 500, code: 'internal_error', message: 'Membership was created but could not be loaded.' }
  }
  return { ok: true, member: member.member }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {string} userId
 * @param {unknown} roleInput
 */
export async function updatePlatformSeasonMemberRole(db, seasonId, userId, roleInput, env = {}) {
  const locationMode = adminLocationMode(env)
  if (locationMode === null) return { ok: false, status: 503, code: 'location_context_unavailable', message: 'Invalid location mode configuration.' }
  const seasonResult = await requireMutablePlatformSeason(db, seasonId)
  if (!seasonResult.ok) return seasonResult

  const newRole = strictParseAdminRole(roleInput)
  if (!newRole) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Role must be owner, super_admin, or admin.' }
  }

  const uid = String(userId ?? '').trim()
  const membership = await getSeasonMembershipRow(db, seasonResult.season.id, uid)
  if (!membership) {
    return { ok: false, status: 404, code: 'not_found', message: 'Season membership not found.' }
  }

  const currentRole = strictParseAdminRole(membership.role)
  if (!currentRole) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Invalid stored season role.' }
  }

  if (currentRole === newRole) {
    return getPlatformSeasonMember(db, seasonResult.season.id, uid)
  }

  if (currentRole === 'owner' && newRole !== 'owner') {
    const owners = await countActiveSeasonOwners(db, seasonResult.season.id, uid)
    if (owners === 0) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: 'At least one active season owner must remain.',
      }
    }
  }

  if (locationMode) {
    const failure = await guardedMemberUpdate(db, seasonResult.season.id, uid, membership, 'role', newRole, newRole !== 'owner')
    if (failure) return failure
    return getPlatformSeasonMember(db, seasonResult.season.id, uid)
  }

  await db
    .prepare(
      `UPDATE season_members SET role = ?
       WHERE season_id = ? AND admin_user_id = ?`,
    )
    .bind(newRole, seasonResult.season.id, uid)
    .run()

  return getPlatformSeasonMember(db, seasonResult.season.id, uid)
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {string} userId
 * @param {boolean} disabled
 */
export async function setPlatformSeasonMemberDisabled(db, seasonId, userId, disabled, env = {}) {
  const locationMode = adminLocationMode(env)
  if (locationMode === null) return { ok: false, status: 503, code: 'location_context_unavailable', message: 'Invalid location mode configuration.' }
  const seasonResult = await requireMutablePlatformSeason(db, seasonId)
  if (!seasonResult.ok) return seasonResult

  const uid = String(userId ?? '').trim()
  const membership = await getSeasonMembershipRow(db, seasonResult.season.id, uid)
  if (!membership) {
    return { ok: false, status: 404, code: 'not_found', message: 'Season membership not found.' }
  }

  const isDisabled =
    membership.disabled_at != null && String(membership.disabled_at).trim() !== ''
  if (disabled === isDisabled) {
    return getPlatformSeasonMember(db, seasonResult.season.id, uid)
  }

  if (disabled && strictParseAdminRole(membership.role) === 'owner') {
    const owners = await countActiveSeasonOwners(db, seasonResult.season.id, uid)
    if (owners === 0) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: 'At least one active season owner must remain.',
      }
    }
  }

  if (locationMode) {
    const failure = await guardedMemberUpdate(db, seasonResult.season.id, uid, membership, 'disabled_at', disabled ? new Date().toISOString() : null, disabled)
    if (failure) return failure
    return getPlatformSeasonMember(db, seasonResult.season.id, uid)
  }

  await db
    .prepare(
      `UPDATE season_members SET disabled_at = ?
       WHERE season_id = ? AND admin_user_id = ?`,
    )
    .bind(disabled ? new Date().toISOString() : null, seasonResult.season.id, uid)
    .run()

  return getPlatformSeasonMember(db, seasonResult.season.id, uid)
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {string} userId
 */
async function getPlatformSeasonMember(db, seasonId, userId) {
  const row = await db
    .prepare(
      `SELECT sm.admin_user_id, sm.role, sm.disabled_at, sm.created_at,
              au.email, au.display_name, au.disabled_at AS user_disabled_at
       FROM season_members sm
       INNER JOIN admin_users au ON au.id = sm.admin_user_id
       WHERE sm.season_id = ? AND sm.admin_user_id = ?
       LIMIT 1`,
    )
    .bind(seasonId, userId)
    .first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Season membership not found.' }
  }
  return { ok: true, member: mapPlatformSeasonMemberRow(row) }
}

/** @param {Record<string, unknown>} row */
function mapPlatformSeasonMemberRow(row) {
  const membershipDisabled = row.disabled_at != null && String(row.disabled_at).trim() !== ''
  const userDisabled = row.user_disabled_at != null && String(row.user_disabled_at).trim() !== ''
  return {
    userId: String(row.admin_user_id),
    email: String(row.email),
    displayName: row.display_name != null ? String(row.display_name) : null,
    role: strictParseAdminRole(row.role) ?? 'admin',
    membershipDisabled,
    userDisabled,
    createdAt: String(row.created_at),
  }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 */
async function requireMutablePlatformSeason(db, seasonId) {
  const seasonResult = await getPlatformBusinessSeasonById(db, seasonId)
  if (!seasonResult.ok) return seasonResult
  if (seasonResult.season.status === 'archived') {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Archived seasons cannot be modified.',
    }
  }
  return seasonResult
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {string} userId
 */
async function getSeasonMembershipRow(db, seasonId, userId) {
  return db
    .prepare(
      `SELECT role, disabled_at
       FROM season_members
       WHERE season_id = ? AND admin_user_id = ?
       LIMIT 1`,
    )
    .bind(seasonId, userId)
    .first()
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {string} [excludeUserId]
 */
async function countActiveSeasonOwners(db, seasonId, excludeUserId = '') {
  const exclude = String(excludeUserId ?? '').trim()
  const row = exclude
    ? await db
        .prepare(
          `SELECT COUNT(*) AS n FROM season_members
           WHERE season_id = ? AND role = 'owner' AND disabled_at IS NULL AND admin_user_id != ?`,
        )
        .bind(seasonId, exclude)
        .first()
    : await db
        .prepare(
          `SELECT COUNT(*) AS n FROM season_members
           WHERE season_id = ? AND role = 'owner' AND disabled_at IS NULL`,
        )
        .bind(seasonId)
        .first()
  return Number(row?.n ?? 0)
}
