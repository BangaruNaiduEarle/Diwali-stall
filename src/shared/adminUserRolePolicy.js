/** Owner remains above Super Admin in the existing membership hierarchy.
 * Owners may not assign Super Admin; Super Admins cannot change Owner roles.
 * Self changes are rejected separately using the authenticated user ID.
 */
export function canUpdateAdminMemberRole(actor, current, next) {
  if (![actor, current, next].every(role => ['admin', 'super_admin', 'owner'].includes(role))) return false
  if (actor === 'owner') return next !== 'super_admin'
  return actor === 'super_admin' && current !== 'owner' && next !== 'owner'
}
