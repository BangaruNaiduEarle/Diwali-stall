import { normalizeAdminRole } from './adminRoles.js'

/** @typedef {import('./adminRoles.js').AdminRole} AdminRole */

/**
 * @typedef {{
 *   userId: string,
 *   email: string,
 *   displayName: string | null,
 *   role: AdminRole,
 *   membershipDisabled: boolean,
 *   userDisabled: boolean,
 *   createdAt: string,
 * }} PlatformSeasonMember
 */

export const PLATFORM_SEASON_MEMBER_ROLES = /** @type {const} */ (['owner', 'super_admin', 'admin'])

/** @param {unknown} raw */
export function parsePlatformSeasonMember(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const userId = String(o.userId ?? o.admin_user_id ?? '').trim()
  const email = String(o.email ?? '').trim()
  if (!userId || !email) return null
  return {
    userId,
    email,
    displayName: o.displayName != null ? String(o.displayName) : o.display_name != null ? String(o.display_name) : null,
    role: normalizeAdminRole(o.role),
    membershipDisabled: Boolean(o.membershipDisabled ?? o.membership_disabled),
    userDisabled: Boolean(o.userDisabled ?? o.user_disabled),
    createdAt: String(o.createdAt ?? o.created_at ?? ''),
  }
}

/** @param {PlatformSeasonMember[]} members */
export function sortPlatformSeasonMembers(members) {
  const rank = /** @type {Record<AdminRole, number>} */ ({ owner: 3, super_admin: 2, admin: 1 })
  return [...members].sort(
    (a, b) => rank[b.role] - rank[a.role] || a.email.localeCompare(b.email),
  )
}

/**
 * @param {PlatformSeasonMember[]} members
 * @param {PlatformSeasonMember} member
 */
export function mergePlatformSeasonMemberIntoList(members, member) {
  const idx = members.findIndex((m) => m.userId === member.userId)
  if (idx === -1) return sortPlatformSeasonMembers([...members, member])
  const next = members.slice()
  next[idx] = member
  return sortPlatformSeasonMembers(next)
}

/**
 * @param {'active' | 'archived'} seasonStatus
 */
export function canMutatePlatformSeasonMemberships(seasonStatus) {
  return seasonStatus !== 'archived'
}

/**
 * @param {'active' | 'archived'} seasonStatus
 */
export function platformSeasonMemberMutationActions(seasonStatus) {
  const mutable = canMutatePlatformSeasonMemberships(seasonStatus)
  return {
    canAssign: mutable,
    canChangeRole: mutable,
    canToggleMembership: mutable,
    canDisableLoginGlobally: false,
  }
}

/**
 * @param {{ email?: string, role?: string }} values
 */
export function validatePlatformSeasonMemberAssignForm(values) {
  const email = String(values.email ?? '').trim().toLowerCase()
  if (!email.includes('@')) {
    return { ok: false, message: 'Valid email is required.', field: /** @type {const} */ ('email') }
  }
  const role = normalizeAdminRole(values.role ?? 'owner')
  if (!PLATFORM_SEASON_MEMBER_ROLES.includes(role)) {
    return { ok: false, message: 'Role must be owner, super_admin, or admin.', field: /** @type {const} */ ('role') }
  }
  return { ok: true, email, role }
}

/** @param {string} message */
export function isDuplicatePlatformSeasonMembershipMessage(message) {
  return /already a member of the season/i.test(String(message ?? ''))
}

/** @param {string} message */
export function isLastActiveSeasonOwnerMessage(message) {
  return /active season owner must remain/i.test(String(message ?? ''))
}

/**
 * @param {PlatformSeasonMember} member
 */
export function platformSeasonMemberStatusSummary(member) {
  const parts = []
  if (member.membershipDisabled) parts.push('Membership disabled')
  if (member.userDisabled) parts.push('Login disabled globally')
  return parts.length ? parts.join(' · ') : 'Active membership'
}
