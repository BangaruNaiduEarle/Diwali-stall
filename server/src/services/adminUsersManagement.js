import { listLocationAdminUsers, grantLocationAdminUser, changeLocationAdminUser } from './adminLocationMembers.js'
import {
  canManageSeasonUsers,
  canUpdateAdminMemberRole,
  canCreateSeasonMemberWithRole,
  strictParseAdminRole,
} from '../lib/adminRoles.js'
import { hashPassword, MAX_USERS, validatePasswordPolicy } from './adminPasswordAuth.js'
import {
  countActiveAdminUsers,
  countActiveOwners,
  getAdminUserByEmail,
  getAdminUserById,
  listAdminUsers,
} from './adminUserStore.js'
import { randomBytesHex } from '../lib/passwordHash.js'

export const LIST_SEASON_ADMIN_USERS_SQL = `
  SELECT au.id, au.email, au.display_name, au.disabled_at AS user_disabled_at,
         sm.role, sm.disabled_at AS membership_disabled_at,
         sm.created_at AS membership_created_at, au.created_at, au.updated_at
  FROM season_members sm
  INNER JOIN admin_users au ON au.id = sm.admin_user_id
  WHERE sm.season_id = ?
  ORDER BY sm.role DESC, au.email ASC
`.trim()

export const LIST_SEASON_ASSIGNEES_SQL = `
  SELECT au.id, au.email, au.display_name, sm.role
  FROM season_members sm
  INNER JOIN admin_users au ON au.id = sm.admin_user_id
  INNER JOIN business_seasons bs ON bs.id = sm.season_id
  WHERE sm.season_id = ?
    AND bs.status = 'active'
    AND au.disabled_at IS NULL
    AND sm.disabled_at IS NULL
  ORDER BY sm.role DESC, au.email ASC
`.trim()

const SEASON_MEMBER_LOOKUP_SQL = `
  SELECT role, disabled_at
  FROM season_members
  WHERE season_id = ? AND admin_user_id = ?
  LIMIT 1
`.trim()

/**
 * @param {D1Database} db
 * @param {string} seasonId
 */
export async function listSeasonAdminUsers(db, seasonId, context) {
  if (context?.locationModeEnabled) return listLocationAdminUsers(db, seasonId, context)
  const season = String(seasonId ?? '').trim()
  const result = await db.prepare(LIST_SEASON_ADMIN_USERS_SQL).bind(season).all()
  return (result.results ?? []).map(mapSeasonAdminUserRow)
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 */
export async function listSeasonAssignees(db, seasonId, context) {
  if (context?.locationModeEnabled) return listLocationAdminUsers(db, seasonId, context, true)
  const season = String(seasonId ?? '').trim()
  const result = await db.prepare(LIST_SEASON_ASSIGNEES_SQL).bind(season).all()
  return (result.results ?? []).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    displayName: row.display_name != null ? String(row.display_name) : null,
    role: strictParseAdminRole(row.role) ?? 'admin',
  }))
}

/** @param {Record<string, unknown>} row */
function mapSeasonAdminUserRow(row) {
  const userDisabled = row.user_disabled_at != null && String(row.user_disabled_at).trim() !== ''
  const membershipDisabled =
    row.membership_disabled_at != null && String(row.membership_disabled_at).trim() !== ''
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: row.display_name != null ? String(row.display_name) : null,
    role: strictParseAdminRole(row.role) ?? 'admin',
    disabled: userDisabled || membershipDisabled,
    userDisabled,
    membershipDisabled,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    membershipCreatedAt: String(row.membership_created_at),
  }
}

/**
 * Invite or create a user for the active business season.
 * New accounts set `admin_users.role` for login/session compatibility only; season permissions come
 * exclusively from `season_members.role`.
 *
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {import('../lib/adminRoles.js').AdminRole} actorSeasonRole
 * @param {{ email: string, password: string, displayName?: string, role?: string }} input
 */
export async function createSeasonAdminUser(db, seasonId, actorSeasonRole, input, context) {
  if (context?.locationModeEnabled) return grantLocationAdminUser(db, seasonId, context, input)
  const season = String(seasonId ?? '').trim()
  if (!season) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Season is required.' }
  }

  const requestedRole = input.role != null && String(input.role).trim() !== '' ? input.role : 'admin'
  const targetRole = strictParseAdminRole(requestedRole)
  if (!targetRole) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Role must be owner, super_admin, or admin.' }
  }
  if (targetRole === 'owner') {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Owner membership cannot be created through this endpoint.',
    }
  }
  if (!canCreateSeasonMemberWithRole(actorSeasonRole, targetRole)) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Not allowed to create a user with this role for the active season.',
    }
  }

  const email = String(input.email ?? '').trim().toLowerCase()
  if (!email.includes('@')) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Valid email is required.' }
  }

  const existing = await getAdminUserByEmail(db, email)
  if (existing) {
    const membership = await db.prepare(SEASON_MEMBER_LOOKUP_SQL).bind(season, existing.id).first()
    if (membership) {
      return {
        ok: false,
        status: 409,
        code: 'conflict',
        message: 'This user is already a member of the active season.',
      }
    }
    await db
      .prepare(
        `INSERT INTO season_members (season_id, admin_user_id, role, disabled_at)
         VALUES (?, ?, ?, NULL)`,
      )
      .bind(season, existing.id, targetRole)
      .run()
    return {
      ok: true,
      user: {
        id: existing.id,
        email: existing.email,
        displayName: existing.displayName ?? email,
        role: targetRole,
        disabled: Boolean(existing.disabledAt),
      },
    }
  }

  if ((await countActiveAdminUsers(db)) >= MAX_USERS) {
    return {
      ok: false,
      status: 409,
      code: 'limit_reached',
      message: `At most ${MAX_USERS} active admin users are allowed.`,
    }
  }

  const policyErr = validatePasswordPolicy(input.password)
  if (policyErr) {
    return { ok: false, status: 400, code: 'validation_error', message: policyErr }
  }

  const passwordHash = await hashPassword(String(input.password))
  const id = `admin-${randomBytesHex(8)}`
  const displayName = String(input.displayName ?? '').trim() || email

  // admin_users.role mirrors invite role for session/login stub; authorization uses season_members.
  await db
    .prepare(
      `INSERT INTO admin_users (id, email, display_name, role, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, email, displayName, targetRole, passwordHash)
    .run()

  await db
    .prepare(
      `INSERT INTO season_members (season_id, admin_user_id, role, disabled_at)
       VALUES (?, ?, ?, NULL)`,
    )
    .bind(season, id, targetRole)
    .run()

  return { ok: true, user: { id, email, displayName, role: targetRole, disabled: false } }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {import('../lib/adminRoles.js').AdminRole} actorSeasonRole
 * @param {string} userId
 * @param {unknown} roleInput
 */
export async function updateSeasonMemberRole(db, seasonId, actorSeasonRole, userId, roleInput, context) {
  if (context?.locationModeEnabled) return changeLocationAdminUser(db, seasonId, context, userId, 'role', roleInput)
  if (!canManageSeasonUsers(actorSeasonRole)) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Owner or Super Admin access is required to change roles.',
    }
  }

  const season = String(seasonId ?? '').trim()
  const newRole = strictParseAdminRole(roleInput)
  if (!newRole) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Role must be owner, super_admin, or admin.' }
  }
  const user = await getAdminUserById(db, userId)
  if (!user) {
    return { ok: false, status: 404, code: 'not_found', message: 'User not found.' }
  }

  const membership = await db.prepare(SEASON_MEMBER_LOOKUP_SQL).bind(season, userId).first()
  if (!membership) {
    return {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'User is not a member of the active season.',
    }
  }

  const currentRole = strictParseAdminRole(membership.role)
  if (!currentRole) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Invalid stored season role.' }
  }

  if (!canUpdateAdminMemberRole(actorSeasonRole, currentRole, newRole)) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Not allowed to assign this role or manage this user.' }
  }
  if (context?.userId === userId && currentRole !== newRole) {
    return { ok: false, status: 400, code: 'validation_error', message: 'You cannot change your own role.' }
  }

  if (currentRole === newRole) {
    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: currentRole,
        disabled: Boolean(user.disabledAt),
      },
    }
  }

  if (currentRole === 'owner' && newRole !== 'owner') {
    const owners = await countActiveSeasonOwners(db, season, userId)
    if (owners === 0) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: 'At least one active season owner must remain.',
      }
    }
  }

  const updated = await db
    .prepare(
      `UPDATE season_members SET role = ?
       WHERE season_id = ? AND admin_user_id = ? AND role = ?
         AND (role != 'super_admin' OR ? = 'super_admin' OR (disabled_at IS NOT NULL AND disabled_at != '')
           OR EXISTS (SELECT 1 FROM admin_users target_au WHERE target_au.id = season_members.admin_user_id AND target_au.disabled_at IS NOT NULL AND target_au.disabled_at != '') OR EXISTS (
           SELECT 1 FROM season_members other_sm JOIN admin_users other_au ON other_au.id = other_sm.admin_user_id
           WHERE other_sm.season_id = season_members.season_id AND other_sm.admin_user_id != season_members.admin_user_id
             AND other_sm.role = 'super_admin' AND (other_sm.disabled_at IS NULL OR other_sm.disabled_at = '') AND (other_au.disabled_at IS NULL OR other_au.disabled_at = '')))
         AND (? IS NULL OR EXISTS (SELECT 1 FROM season_members actor_sm JOIN admin_users actor_au ON actor_au.id = actor_sm.admin_user_id
           JOIN business_seasons actor_season ON actor_season.id = actor_sm.season_id
           WHERE actor_sm.season_id = season_members.season_id AND actor_sm.admin_user_id = ? AND actor_sm.role = ?
             AND (actor_sm.disabled_at IS NULL OR actor_sm.disabled_at = '') AND (actor_au.disabled_at IS NULL OR actor_au.disabled_at = '') AND actor_season.status = 'active'))`,
    )
    .bind(newRole, season, userId, currentRole, newRole, context?.userId ?? null, context?.userId ?? null, actorSeasonRole)
    .run()

  if (updated.meta?.changes !== 1) return { ok: false, status: 409, code: 'membership_changed', message: 'Membership changed or the last active Super Admin would be lost. Refresh and retry.' }

  await db.prepare('DELETE FROM admin_sessions WHERE admin_user_id = ?').bind(userId).run()

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: newRole,
      disabled: Boolean(user.disabledAt),
    },
  }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {string} userId
 * @param {boolean} disabled
 */
export async function setSeasonMemberDisabled(db, seasonId, userId, disabled, context) {
  if (context?.locationModeEnabled) return changeLocationAdminUser(db, seasonId, context, userId, 'disabled', disabled)
  const season = String(seasonId ?? '').trim()
  const user = await getAdminUserById(db, userId)
  if (!user) {
    return { ok: false, status: 404, code: 'not_found', message: 'User not found.' }
  }

  const membership = await db.prepare(SEASON_MEMBER_LOOKUP_SQL).bind(season, userId).first()
  if (!membership) {
    return {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'User is not a member of the active season.',
    }
  }

  if (strictParseAdminRole(membership.role) === 'owner' && disabled) {
    const owners = await countActiveSeasonOwners(db, season, userId)
    if (owners === 0) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: 'At least one active season owner must remain.',
      }
    }
  }

  const updated = await db
    .prepare(
      `UPDATE season_members SET disabled_at = ?
       WHERE season_id = ? AND admin_user_id = ?
         AND (? = 0 OR role != 'super_admin' OR (disabled_at IS NOT NULL AND disabled_at != '')
           OR EXISTS (SELECT 1 FROM admin_users target_au WHERE target_au.id = season_members.admin_user_id AND target_au.disabled_at IS NOT NULL AND target_au.disabled_at != '') OR EXISTS (
           SELECT 1 FROM season_members other_sm JOIN admin_users other_au ON other_au.id = other_sm.admin_user_id
           WHERE other_sm.season_id = season_members.season_id AND other_sm.admin_user_id != season_members.admin_user_id
             AND other_sm.role = 'super_admin' AND (other_sm.disabled_at IS NULL OR other_sm.disabled_at = '') AND (other_au.disabled_at IS NULL OR other_au.disabled_at = '')))`,
    )
    .bind(disabled ? new Date().toISOString() : null, season, userId, disabled ? 1 : 0)
    .run()

  if (updated.meta?.changes !== 1) return { ok: false, status: 409, code: 'membership_changed', message: 'Membership changed or the last active Super Admin would be lost. Refresh and retry.' }

  if (disabled) {
    await db.prepare('DELETE FROM admin_sessions WHERE admin_user_id = ?').bind(userId).run()
  }

  return { ok: true }
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

/**
 * @deprecated Use `createSeasonAdminUser`. Mutates global `admin_users.role` only (no `season_members`).
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

  const requestedRole = input.role != null && String(input.role).trim() !== '' ? input.role : 'admin'
  const role = strictParseAdminRole(requestedRole)
  if (!role) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Role must be owner, super_admin, or admin.' }
  }
  if (role === 'owner') {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Only the initial bootstrap can create the owner account. Promote an existing user to owner instead.',
    }
  }

  const existing = await getAdminUserByEmail(db, email)
  if (existing) {
    return { ok: false, status: 409, code: 'conflict', message: 'An account with this email already exists.' }
  }
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
 * @deprecated Use `setSeasonMemberDisabled` via admin user routes. Global `admin_users.disabled_at` only.
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
 * @deprecated Use `updateSeasonMemberRole`. Updates global `admin_users.role` only.
 * @param {D1Database} db
 * @param {string} userId
 * @param {unknown} roleInput
 */
export async function updateAdminUserRole(db, userId, roleInput) {
  const newRole = strictParseAdminRole(roleInput)
  if (!newRole) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Role must be owner, super_admin, or admin.' }
  }

  const user = await getAdminUserById(db, userId)
  if (!user) {
    return { ok: false, status: 404, code: 'not_found', message: 'User not found.' }
  }

  if (user.role === newRole) {
    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        disabled: Boolean(user.disabledAt),
      },
    }
  }

  if (user.role === 'owner' && newRole !== 'owner') {
    const otherOwners = await countActiveOwners(db, userId)
    if (otherOwners === 0) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: 'At least one active owner must remain.',
      }
    }
  }

  await db
    .prepare(`UPDATE admin_users SET role = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(newRole, userId)
    .run()

  await db.prepare('DELETE FROM admin_sessions WHERE admin_user_id = ?').bind(userId).run()

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: newRole,
      disabled: Boolean(user.disabledAt),
    },
  }
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

/** Location-only removal; season memberships and global accounts are retained. */
export async function removeLocationMember(db, seasonId, userId, context) {
  if (!context?.locationModeEnabled) return { ok: false, status: 403, code: 'forbidden', message: 'Location context is required.' }
  return changeLocationAdminUser(db, seasonId, context, userId, 'remove')
}
