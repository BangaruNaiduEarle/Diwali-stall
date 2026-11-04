import { strictParseAdminRole, canManageSeasonUsers, canGrantLocationMemberRole, canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { resolveLocationScopedAuthorizationFromContext } from '../middleware/adminLocationGuards.js'
import { ADMIN_LOCATION_CONTEXT_SQL, resolveAdminLocationContext } from './adminLocationContext.js'
import { getAdminUserByEmail, getAdminUserById } from './adminUserStore.js'
import { hashPassword, validatePasswordPolicy } from './adminPasswordAuth.js'
import { randomBytesHex } from '../lib/passwordHash.js'

const roles = ['admin', 'super_admin', 'owner']
// Location-mode teams share logins across stalls. Legacy single-stall limits stay unchanged.
export const MAX_LOCATION_ADMIN_USERS = 250
const enabled = value => value == null || value === ''
const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }) }
const effectiveRole = (season, location) => roles[Math.min(roles.indexOf(season), roles.indexOf(location))]

export function effectiveLocationMemberRole(seasonRole, locationRole) {
  const season = strictParseAdminRole(seasonRole), location = strictParseAdminRole(locationRole)
  return season && location ? effectiveRole(season, location) : null
}

/** Fresh membership validation supplements the middleware's request snapshot. */
async function authorize(db, seasonId, context, write = false, owner = false, assignees = false) {
  const attached = resolveLocationScopedAuthorizationFromContext(context)
  if (!attached.ok || attached.activeSeasonId !== seasonId) fail(403, 'forbidden', 'Validated location and season context is required.')
  const actor = await getAdminUserById(db, attached.userId)
  if (!actor || !enabled(actor.disabledAt)) fail(403, 'forbidden', 'Enabled admin identity is required.')
  const fresh = await resolveAdminLocationContext(db, {
    userId: attached.userId, activeSeasonId: seasonId, access: write ? 'write' : 'read',
    request: new Request('https://location.internal/', { headers: { 'X-Admin-Location-Id': attached.activeLocationId } }),
  })
  if (!fresh.ok || fresh.businessId !== attached.businessId) fail(403, 'forbidden', 'Enabled location and season memberships are required.')
  const role = effectiveRole(fresh.seasonMembership.role, fresh.locationMembership.role)
  if ((owner && role !== 'owner') || (!assignees && !canManageSeasonUsers(role))) fail(403, 'forbidden', 'Insufficient location membership authority.')
  return { ...fresh, effectiveRole: role }
}

// Recheck actor roles, enabled states, association and business within each write.
function writeGuard(auth) {
  return {
    sql: `EXISTS (SELECT 1 FROM location_members actor_lm
      JOIN season_members actor_sm ON actor_sm.season_id = actor_lm.season_id AND actor_sm.admin_user_id = actor_lm.admin_user_id
      JOIN admin_users actor_au ON actor_au.id = actor_lm.admin_user_id
      JOIN location_seasons ls ON ls.location_id = actor_lm.location_id AND ls.season_id = actor_lm.season_id
      JOIN business_locations bl ON bl.id = ls.location_id JOIN businesses b ON b.id = bl.business_id
      JOIN business_seasons bs ON bs.id = ls.season_id
      WHERE actor_lm.location_id = ? AND actor_lm.season_id = ? AND actor_lm.admin_user_id = ?
        AND actor_sm.role = ? AND actor_lm.role = ? AND b.id = ?
        AND (actor_sm.disabled_at IS NULL OR actor_sm.disabled_at = '')
        AND (actor_lm.disabled_at IS NULL OR actor_lm.disabled_at = '')
        AND (actor_au.disabled_at IS NULL OR actor_au.disabled_at = '')
        AND ls.status = 'active' AND bl.status = 'active' AND b.status = 'active' AND bs.status = 'active')`,
    values: [auth.activeLocationId, auth.activeSeasonId, auth.userId, auth.seasonMembership.role, auth.locationMembership.role, auth.businessId],
  }
}

const MEMBER_FROM = `FROM location_members lm
  JOIN season_members sm ON sm.season_id = lm.season_id AND sm.admin_user_id = lm.admin_user_id
  JOIN admin_users au ON au.id = lm.admin_user_id
  JOIN location_seasons ls ON ls.location_id = lm.location_id AND ls.season_id = lm.season_id
  JOIN business_locations bl ON bl.id = ls.location_id
  WHERE lm.location_id = ? AND lm.season_id = ? AND bl.business_id = ?`

export const LIST_LOCATION_MEMBERS_SQL = `SELECT lm.*, au.id, au.email, au.display_name, au.disabled_at AS user_disabled_at,
  sm.role AS season_role, sm.disabled_at AS season_disabled_at, lm.role AS location_role,
  lm.disabled_at AS location_disabled_at, lm.created_at AS membership_created_at, au.created_at, au.updated_at
  ${MEMBER_FROM} ORDER BY lm.role DESC, au.email ASC`

const MEMBER_SQL = `SELECT lm.role AS location_role, lm.disabled_at AS location_disabled_at,
  sm.role AS season_role, sm.disabled_at AS season_disabled_at, au.disabled_at AS user_disabled_at
  ${MEMBER_FROM} AND lm.admin_user_id = ?`

function mapMember(row) {
  const seasonRole = strictParseAdminRole(row.season_role), locationRole = strictParseAdminRole(row.location_role)
  if (!seasonRole || !locationRole) fail(409, 'membership_invalid', 'Invalid stored membership role.')
  const userDisabled = !enabled(row.user_disabled_at), seasonMembershipDisabled = !enabled(row.season_disabled_at)
  const membershipDisabled = !enabled(row.location_disabled_at)
  return {
    id: row.id, email: row.email, displayName: row.display_name ?? null,
    role: locationRole, seasonRole, effectiveRole: effectiveRole(seasonRole, locationRole),
    canViewFinalRate: canViewSensitiveProductPricing(effectiveRole(seasonRole, locationRole)) || row.can_view_final_rate === 1,
    disabled: userDisabled || seasonMembershipDisabled || membershipDisabled,
    userDisabled, seasonMembershipDisabled, membershipDisabled,
    createdAt: row.created_at, updatedAt: row.updated_at, membershipCreatedAt: row.membership_created_at,
  }
}

export async function setLocationFinalRateAccess(db, seasonId, context, userId, enabled) {
  if (typeof enabled !== 'boolean') fail(400, 'validation_error', 'Final Rate access must be true or false.')
  const auth = await authorize(db, seasonId, context, true)
  const target = await db.prepare(MEMBER_SQL).bind(auth.activeLocationId, seasonId, auth.businessId, userId).first()
  if (!target) fail(404, 'not_found', 'User is not a member of the selected stall.')
  if (effectiveLocationMemberRole(target.season_role, target.location_role) !== 'admin') {
    fail(400, 'validation_error', 'Owner and Super Admin Final Rate access is retained automatically.')
  }
  const guard = writeGuard(auth)
  // Actor authority and target membership are rechecked in this atomic scoped write.
  const result = await db.prepare(`UPDATE location_members SET can_view_final_rate = ?, updated_at = datetime('now')
    WHERE location_id = ? AND season_id = ? AND admin_user_id = ?
      AND (disabled_at IS NULL OR disabled_at = '')
      AND EXISTS (SELECT 1 FROM season_members target_sm JOIN admin_users target_au ON target_au.id = target_sm.admin_user_id
        WHERE target_sm.season_id = location_members.season_id AND target_sm.admin_user_id = location_members.admin_user_id
          AND (target_sm.disabled_at IS NULL OR target_sm.disabled_at = '')
          AND (target_au.disabled_at IS NULL OR target_au.disabled_at = '')
          AND target_sm.role IN ('admin','super_admin','owner') AND location_members.role IN ('admin','super_admin','owner')
          AND (target_sm.role = 'admin' OR location_members.role = 'admin'))
      AND ${guard.sql}`).bind(enabled ? 1 : 0, auth.activeLocationId, seasonId, userId, ...guard.values).run()
  if (result.meta?.changes !== 1) fail(409, 'membership_changed', 'Membership changed; refresh and try again.')
  return { ok: true, userId, canViewFinalRate: enabled }
}

export async function listLocationAdminUsers(db, seasonId, context, assignees = false) {
  const auth = await authorize(db, seasonId, context, false, false, assignees)
  if (assignees && !auth.capabilities.write) return []
  const result = await db.prepare(LIST_LOCATION_MEMBERS_SQL).bind(auth.activeLocationId, seasonId, auth.businessId).all()
  const users = (result.results ?? []).map(mapMember)
  return assignees ? users.filter(u => !u.disabled).map(u => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.effectiveRole })) : users
}

const SEASON_LOOKUP = `SELECT role, disabled_at FROM season_members WHERE season_id = ? AND admin_user_id = ? LIMIT 1`

/** A zero-row guarded write must roll back preceding statements in the D1 batch. */
function requireOneChange(db, batch, seasonId, userId) {
  batch.push(db.prepare(`INSERT INTO location_members (location_id, season_id, admin_user_id, role)
    SELECT NULL, ?, ?, 'admin' WHERE changes() != 1`).bind(seasonId, userId))
}

async function promoteSeasonAuthority(db, batch, auth, userId, membership, role) {
  const previousRole = strictParseAdminRole(membership.role)
  if (roles.indexOf(role) <= roles.indexOf(previousRole)) return
  if (auth.effectiveRole !== 'owner') fail(403, 'forbidden', 'Only a stall Owner may raise season authority for a stall role.')
  const siblings = await db.prepare(`SELECT location_id, role FROM location_members
    WHERE season_id = ? AND admin_user_id = ? AND location_id != ?`)
    .bind(auth.activeSeasonId, userId, auth.activeLocationId).all()
  const previousRank = roles.indexOf(previousRole)
  if ((siblings.results ?? []).some(row => !strictParseAdminRole(row.role) || roles.indexOf(row.role) > previousRank)) {
    fail(409, 'season_authority_conflict', 'This promotion would increase authority in another stall. Ask a Platform Admin to review the season role first.')
  }
  const guard = writeGuard(auth)
  batch.push(db.prepare(`UPDATE season_members SET role = ?
    WHERE season_id = ? AND admin_user_id = ? AND role = ? AND (disabled_at IS NULL OR disabled_at = '')
      AND ${guard.sql}
      AND EXISTS (SELECT 1 FROM admin_users target_user WHERE target_user.id = season_members.admin_user_id
        AND (target_user.disabled_at IS NULL OR target_user.disabled_at = ''))
      AND NOT EXISTS (SELECT 1 FROM location_members sibling
        WHERE sibling.season_id = season_members.season_id AND sibling.admin_user_id = season_members.admin_user_id
          AND sibling.location_id != ?
          AND CASE sibling.role WHEN 'admin' THEN 0 WHEN 'super_admin' THEN 1 WHEN 'owner' THEN 2 ELSE 99 END > ?)`)
    .bind(role, auth.activeSeasonId, userId, previousRole, ...guard.values, auth.activeLocationId, previousRank))
  requireOneChange(db, batch, auth.activeSeasonId, userId)
}

export async function grantLocationAdminUser(db, seasonId, context, input) {
  const auth = await authorize(db, seasonId, context, true)
  const role = strictParseAdminRole(input.role != null && String(input.role).trim() !== '' ? input.role : 'admin')
  if (!role) fail(400, 'validation_error', 'Role must be owner, super_admin, or admin.')
  if (!canGrantLocationMemberRole(auth.effectiveRole, role)) fail(403, 'forbidden', 'Not allowed to grant this location role.')
  if (input.existingOnly != null && typeof input.existingOnly !== 'boolean') fail(400, 'validation_error', 'Existing login selection must be a boolean.')
  const email = String(input.email ?? '').trim().toLowerCase()
  if (!email.includes('@')) fail(400, 'validation_error', 'Valid email is required.')
  let user = await getAdminUserByEmail(db, email)
  if (input.existingOnly && !user) fail(404, 'not_found', 'No existing login was found for this email. Choose New login to create one.')
  const membership = user ? await db.prepare(SEASON_LOOKUP).bind(seasonId, user.id).first() : null
  if (user && (!enabled(user.disabledAt) || (membership && (!enabled(membership.disabled_at) || !strictParseAdminRole(membership.role))))) {
    fail(403, 'forbidden', 'Enabled user and season membership are required.')
  }
  if (user && await db.prepare(MEMBER_SQL).bind(auth.activeLocationId, seasonId, auth.businessId, user.id).first()) fail(409, 'conflict', 'This user already has a location membership.')

  const guard = writeGuard(auth), batch = []
  if (!user) {
    const count = await db.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE disabled_at IS NULL OR disabled_at = ''").first()
    if (Number(count?.n ?? 0) >= MAX_LOCATION_ADMIN_USERS) fail(409, 'limit_reached', `At most ${MAX_LOCATION_ADMIN_USERS} active admin users are allowed.`)
    const policyError = validatePasswordPolicy(input.password)
    if (policyError) fail(400, 'validation_error', policyError)
    user = { id: `admin-${randomBytesHex(8)}`, email, displayName: String(input.displayName ?? '').trim() || email }
    const passwordHash = await hashPassword(String(input.password))
    batch.push(db.prepare(`INSERT INTO admin_users (id, email, display_name, role, password_hash)
      SELECT ?, ?, ?, ?, ? WHERE ${guard.sql} AND (SELECT COUNT(*) FROM admin_users WHERE disabled_at IS NULL OR disabled_at = '') < ?`)
      .bind(user.id, email, user.displayName, 'admin', passwordHash, ...guard.values, MAX_LOCATION_ADMIN_USERS))
    requireOneChange(db, batch, seasonId, user.id)
  }
  if (!membership) {
    // Disabled season memberships are never re-enabled by stall management.
    batch.push(db.prepare(`INSERT INTO season_members (season_id, admin_user_id, role, disabled_at)
      VALUES ((SELECT id FROM business_seasons WHERE id = ? AND ${guard.sql}), ?, ?, NULL)`)
      .bind(seasonId, ...guard.values, user.id, role))
    requireOneChange(db, batch, seasonId, user.id)
  } else {
    await promoteSeasonAuthority(db, batch, auth, user.id, membership, role)
  }
  const allowedSeasonRoles = roles.slice(roles.indexOf(role)).map(r => `'${r}'`).join(', ')
  batch.push(db.prepare(`INSERT INTO location_members (location_id, season_id, admin_user_id, role, disabled_at)
    VALUES ((SELECT location_id FROM location_seasons WHERE location_id = ? AND season_id = ? AND ${guard.sql}
      AND EXISTS (SELECT 1 FROM season_members target_sm JOIN admin_users target_au ON target_au.id = target_sm.admin_user_id
        WHERE target_sm.season_id = ? AND target_sm.admin_user_id = ? AND target_sm.role IN (${allowedSeasonRoles})
        AND (target_sm.disabled_at IS NULL OR target_sm.disabled_at = '') AND (target_au.disabled_at IS NULL OR target_au.disabled_at = ''))), ?, ?, ?, NULL)`)
    .bind(auth.activeLocationId, seasonId, ...guard.values, seasonId, user.id, seasonId, user.id, role))
  requireOneChange(db, batch, seasonId, user.id)
  await runMembershipBatch(db, batch)
  return { ok: true, user: { id: user.id, email: user.email, displayName: user.displayName, role, disabled: false } }
}

/** Owner-only changes affect a single location/season and never global sessions. */
export async function changeLocationAdminUser(db, seasonId, context, userId, action, value) {
  const auth = await authorize(db, seasonId, context, true, true)
  if (!['role', 'disabled', 'remove'].includes(action)) fail(400, 'validation_error', 'Invalid membership operation.')
  if (userId === auth.userId && (action === 'remove' || (action === 'disabled' && value))) fail(400, 'validation_error', 'You cannot disable or remove your own membership.')
  const target = await db.prepare(MEMBER_SQL).bind(auth.activeLocationId, seasonId, auth.businessId, userId).first()
  if (!target) fail(404, 'not_found', 'User is not a member of the active location and season.')
  const currentRole = strictParseAdminRole(target.location_role), seasonRole = strictParseAdminRole(target.season_role)
  if (!currentRole || !seasonRole) fail(409, 'membership_invalid', 'Invalid stored membership role.')
  const role = action === 'role' ? strictParseAdminRole(value) : currentRole
  if (!role) fail(400, 'validation_error', 'Role must be owner, super_admin, or admin.')
  const grantsAccess = action === 'role' || (action === 'disabled' && !value)
  if (grantsAccess && (!enabled(target.season_disabled_at) || !enabled(target.user_disabled_at))) fail(403, 'forbidden', 'Location role requires an enabled user and season membership.')
  const batch = []
  if (grantsAccess) await promoteSeasonAuthority(db, batch, auth, userId, { role: seasonRole }, role)
  const guard = writeGuard(auth)
  // Atomic last-owner check. A disabled or season-limited owner cannot satisfy it.
  const remainingOwner = `EXISTS (SELECT 1 FROM location_members other_lm
    JOIN season_members other_sm ON other_sm.season_id = other_lm.season_id AND other_sm.admin_user_id = other_lm.admin_user_id
    JOIN admin_users other_au ON other_au.id = other_lm.admin_user_id
    WHERE other_lm.location_id = location_members.location_id AND other_lm.season_id = location_members.season_id
      AND other_lm.admin_user_id != location_members.admin_user_id AND other_lm.role = 'owner' AND other_sm.role = 'owner'
      AND (other_lm.disabled_at IS NULL OR other_lm.disabled_at = '') AND (other_sm.disabled_at IS NULL OR other_sm.disabled_at = '')
      AND (other_au.disabled_at IS NULL OR other_au.disabled_at = ''))`
  const losesOwner = action === 'remove' || (action === 'role' && role !== 'owner') || (action === 'disabled' && value)
  const ownerGuard = losesOwner ? ` AND (role != 'owner' OR (disabled_at IS NOT NULL AND disabled_at != '') OR ${remainingOwner})` : ''
  const sufficientSeason = grantsAccess ? ` AND EXISTS (SELECT 1 FROM season_members target_sm JOIN admin_users target_au ON target_au.id = target_sm.admin_user_id
    WHERE target_sm.season_id = location_members.season_id AND target_sm.admin_user_id = location_members.admin_user_id
      AND target_sm.role IN (${roles.slice(roles.indexOf(role)).map(r => `'${r}'`).join(', ')})
      AND (target_sm.disabled_at IS NULL OR target_sm.disabled_at = '') AND (target_au.disabled_at IS NULL OR target_au.disabled_at = ''))` : ''
  const mutation = action === 'remove' ? 'DELETE FROM location_members' :
    action === 'role' ? "UPDATE location_members SET role = ?, updated_at = datetime('now')" : "UPDATE location_members SET disabled_at = ?, updated_at = datetime('now')"
  const values = action === 'remove' ? [] : [action === 'role' ? role : value ? new Date().toISOString() : null]
  batch.push(db.prepare(`${mutation} WHERE location_id = ? AND season_id = ? AND admin_user_id = ?
    AND role = ? AND ${guard.sql}${sufficientSeason}${ownerGuard}`)
    .bind(...values, auth.activeLocationId, seasonId, userId, currentRole, ...guard.values))
  requireOneChange(db, batch, seasonId, userId)
  await runMembershipBatch(db, batch)
  return { ok: true, ...(action === 'role' ? { user: { id: userId, role } } : {}) }
}

async function runMembershipBatch(db, statements) {
  try { return await db.batch(statements) } catch (error) {
    if (/constraint failed/i.test(String(error?.message ?? error))) fail(409, 'membership_changed', 'Membership changed or the last valid stall Owner would be lost. No change was applied. Refresh and retry.')
    throw error
  }
}

/** Only enabled memberships with a resolvable association are advertised. */
export async function listAuthorizedAdminLocations(db, userId, memberships) {
  const result = []
  for (const membership of memberships.filter(m => !m.disabled)) {
    const rows = (await db.prepare(ADMIN_LOCATION_CONTEXT_SQL).bind(userId, membership.seasonId).all()).results ?? []
    for (const id of [...new Set(rows.map(r => r.member_location_id).filter(Boolean))]) {
      const context = await resolveAdminLocationContext(db, {
        userId, activeSeasonId: membership.seasonId, access: 'read',
        request: new Request('https://location.internal/', { headers: { 'X-Admin-Location-Id': id } }),
      })
      if (context.ok) result.push({
        business: context.business, location: context.location, operatingSeason: context.operatingSeason,
        association: context.association, seasonRole: context.seasonMembership.role,
        locationRole: context.locationMembership.role,
        effectiveRole: effectiveRole(context.seasonMembership.role, context.locationMembership.role), capabilities: context.capabilities,
      })
    }
  }
  return result
}
