/**
 * Platform Admin UI access is gated on session.platformAdmin only (platform_admins registry).
 * Legacy admin_users.role (owner / super_admin) does not grant platform dashboard access.
 */

/**
 * @param {{ platformAdmin?: boolean }} session
 */
export function canAccessPlatformAdminDashboard(session) {
  return Boolean(session?.platformAdmin)
}

/**
 * @param {{ platformAdmin?: boolean }} session
 */
export function shouldShowPlatformAdminNav(session) {
  return canAccessPlatformAdminDashboard(session)
}

/**
 * @param {{ status?: string, platformAdmin?: boolean }} session
 * @returns {'auth_required' | 'platform_admin_required' | null}
 */
export function platformDashboardAccessBlockReason(session) {
  if (session?.status !== 'authenticated') return 'auth_required'
  if (!canAccessPlatformAdminDashboard(session)) return 'platform_admin_required'
  return null
}
