import {
  ADMIN_USER_CREATE_ROLES,
  canChangeSeasonMemberRoles,
  canCreateSeasonMemberWithRole,
  canGrantLocationMemberRole,
  canManageSeasonUsers,
} from './adminRoles.js'

/** Matches GET /api/admin/users (`requireSeasonRole` owner | super_admin). */
/** @param {unknown} seasonRole */
export function canViewAdminUsersPage(seasonRole) {
  return canManageSeasonUsers(seasonRole)
}

/** @param {unknown} seasonRole @param {boolean} isReadOnly */
export function canShowAdminUserCreateForm(seasonRole, isReadOnly) {
  return canManageSeasonUsers(seasonRole) && !isReadOnly
}

/** Owner-only membership mutations (role, disable, enable, reset). */
/** @param {unknown} seasonRole @param {boolean} isReadOnly */
export function canShowAdminUserOwnerActions(seasonRole, isReadOnly) {
  return canChangeSeasonMemberRoles(seasonRole) && !isReadOnly
}

/** @param {unknown} seasonRole */
export function creatableAdminUserRoles(seasonRole, locationModeEnabled = false) {
  if (locationModeEnabled) return ['admin', 'super_admin', 'owner'].filter(role => canGrantLocationMemberRole(seasonRole, role))
  return ADMIN_USER_CREATE_ROLES.filter((role) => canCreateSeasonMemberWithRole(seasonRole, role))
}

export function adminUserAssignmentPayload(form, locationModeEnabled, existingLogin) {
  if (!locationModeEnabled) return { ...form }
  return existingLogin ? { email: form.email, role: form.role, existingOnly: true } : { ...form, existingOnly: false }
}

/**
 * After self role change, leave Users page if season role no longer allows list access.
 * @param {unknown} nextSeasonRole
 */
export function shouldLeaveAdminUsersAfterSelfRoleChange(nextSeasonRole) {
  return !canViewAdminUsersPage(nextSeasonRole)
}
