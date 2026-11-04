import { canManageSeasonUsers, strictParseAdminRole } from './adminRoles.js'

/** Session tuples have already been validated by parseAdminSessionPayload. Never expand them by business ID. */
export function ownedWorkspaceLocations(session) {
  if (!session.locationModeEnabled) return []
  return (session.authorizedLocations ?? []).filter(row => row.effectiveRole === 'owner' && row.capabilities?.read === true)
}

function legacyMembership(session) {
  return (session.memberships ?? []).find(row => row.seasonId === session.activeSeasonId && !row.membershipDisabled &&
    strictParseAdminRole(row.role) && row.role === session.seasonRole)
}

export function canAccessOwnerWorkspace(session) {
  return session.locationModeEnabled ? ownedWorkspaceLocations(session).length > 0 :
    legacyMembership(session)?.role === 'owner'
}

function activeLocation(session) {
  return (session.authorizedLocations ?? []).find(row => row.location.id === session.activeLocationId &&
    row.business.id === session.activeBusinessId && row.operatingSeason.id === session.activeSeasonId &&
    row.effectiveRole === session.effectiveRole && row.capabilities?.read === true)
}

/** Platform membership is intentionally irrelevant to operational capabilities. */
export function hasWorkspaceCapability(session, capability) {
  if (session.locationModeEnabled) {
    const active = activeLocation(session)
    if (!active || session.capabilities?.read !== true) return false
    // The backend allows archived owner/super-admin user-list reads; manageSeasonUsers controls mutations.
    if (capability === 'readUsers') return canManageSeasonUsers(active.effectiveRole)
    return active.capabilities[capability] === true && session.capabilities?.[capability] === true
  }
  const membership = legacyMembership(session)
  if (!membership) return false
  if (capability === 'read') return true
  if (capability === 'readUsers') return canManageSeasonUsers(membership.role)
  if (capability === 'write') return membership.status === 'active' && session.seasonStatus === 'active'
  return false
}

/** Strict allowlist for local destinations: reject external URLs, encoded paths and traversal. */
export function adminDestination(value) {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' ?
    `${value.pathname ?? ''}${value.search ?? ''}${value.hash ?? ''}` : ''
  if (!raw.startsWith('/admin') || /[\\\s]/.test(raw) || [...raw].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  const pathname = raw.split(/[?#]/)[0]
  if (pathname.includes('%') || pathname.split('/').some(part => part === '.' || part === '..')) return null
  const path = pathname.replace(/\/$/, '')
  if (!/^\/admin(?:\/(?:platform|business|context|product|products(?:\/(?:new|[^/]+\/edit))?|categories|family-packs(?:\/(?:new|[^/]+\/edit))?|quick-bill|customer-requests(?:\/[^/]+)?|users|settings|reports))?$/.test(path)) return null
  return { path, destination: raw }
}

export function adminRouteAccess(session, destination) {
  if (session.status !== 'authenticated') return { allowed: false, reason: 'auth_required' }
  const parsed = adminDestination(destination)
  if (!parsed) return { allowed: false, reason: 'unknown_route' }
  const { path } = parsed
  if (path === '/admin' || path === '/admin/context') return { allowed: true }
  if (path === '/admin/platform') return { allowed: Boolean(session.platformAdmin), reason: 'platform_admin_required' }
  if (path === '/admin/business') return { allowed: canAccessOwnerWorkspace(session), reason: 'owner_required' }
  if (session.seasonSwitching) return { allowed: false, reason: 'context_switching' }
  if (!hasWorkspaceCapability(session, 'read')) return { allowed: false, reason: 'context_required' }
  const capability = path === '/admin/users' ? 'readUsers' : /\/(new|edit)$/.test(path) ? 'write' : 'read'
  return { allowed: hasWorkspaceCapability(session, capability), reason: 'capability_required' }
}

export function resolveAdminLanding(session) {
  if (session.status !== 'authenticated') return '/admin/login'
  if (session.platformAdmin) return '/admin/platform'
  if (canAccessOwnerWorkspace(session)) return '/admin/business'
  return hasWorkspaceCapability(session, 'read') ? '/admin/quick-bill' : '/admin/context'
}

export function resolveAdminLoginDestination(session, requested) {
  const parsed = adminDestination(requested)
  // /admin itself is an entry point and must use the same role-based landing.
  return parsed && parsed.path !== '/admin' && adminRouteAccess(session, parsed.destination).allowed ?
    parsed.destination : resolveAdminLanding(session)
}
