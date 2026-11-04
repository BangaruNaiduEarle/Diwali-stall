import { normalizeAdminRole } from '../lib/adminRoles.js'
import { getAdminContext, adminLocationMode } from '../middleware/requireAdmin.js'
import { getAdminUserByEmail, getAdminUserById } from '../services/adminUserStore.js'
import { listAuthorizedAdminLocations, effectiveLocationMemberRole } from '../services/adminLocationMembers.js'
import { resolveAdminLocationContext } from '../services/adminLocationContext.js'

/**
 * Admin API stubs (Phase 2A) — protected by requireAdmin in index.js.
 */

/** @param {import('../services/adminSeasonContext.js').SeasonMembership[]} memberships */
function mapSessionMemberships(memberships) {
  return memberships.map((m) => ({
    seasonId: m.seasonId,
    code: m.code,
    label: m.label,
    status: m.status,
    role: m.role,
    membershipDisabled: m.disabled,
  }))
}

/**
 * @param {Request} request
 * @param {{ identity: { email: string, sub?: string, userId?: string, role?: string } }} context
 * @param {{ DB?: D1Database }} env
 */
export async function handleAdminSession(request, context, env) {
  let role = normalizeAdminRole(context.identity.role)
  let sessionUser = null
  if (env.DB) {
    const user =
      (context.identity.userId
        ? await getAdminUserById(env.DB, String(context.identity.userId))
        : null) ?? (await getAdminUserByEmail(env.DB, context.identity.email))
    sessionUser = user
    if (user?.role) role = normalizeAdminRole(user.role)
  }

  const adminContext = getAdminContext(request)
  const memberships = adminContext?.memberships ?? []
  const activeSeasonId = adminContext?.activeSeasonId ?? null
  const activeMembership =
    activeSeasonId != null ? memberships.find((m) => m.seasonId === activeSeasonId) : null

  let locationFields = {}
  const mode = adminLocationMode(env)
  if (mode !== false) {
    if (mode !== true || !env.DB || !adminContext?.userId || adminContext.userId !== context.identity.userId) {
      return Response.json({ error: 'location_context_unavailable', message: 'Admin location context is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    if (!sessionUser || sessionUser.id !== adminContext.userId || sessionUser.disabledAt) {
      return Response.json({ error: 'forbidden', message: 'Enabled admin identity is required.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
    }
    try {
      const authorizedLocations = await listAuthorizedAdminLocations(env.DB, adminContext.userId, memberships)
      const selection = activeSeasonId ? await resolveAdminLocationContext(env.DB, {
        userId: adminContext.userId, activeSeasonId, request, access: 'read',
      }) : null
      if (request.headers.has('X-Admin-Location-Id') && !selection?.ok) {
        return Response.json({ error: 'forbidden', message: 'Selected location and operating season are not authorized.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
      }
      locationFields = {
        locationModeEnabled: true, authorizedLocations,
        activeBusinessId: selection?.ok ? selection.businessId : null,
        activeLocationId: selection?.ok ? selection.activeLocationId : null,
        locationRole: selection?.ok ? selection.locationMembership.role : null,
        effectiveRole: selection?.ok ? effectiveLocationMemberRole(selection.seasonMembership.role, selection.locationMembership.role) : null,
        locationSelectionRequired: !selection?.ok,
      }
    } catch {
      return Response.json({ error: 'location_context_unavailable', message: 'Admin location context is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
  }

  return Response.json(
    {
      ok: true,
      email: context.identity.email,
      role,
      userId: context.identity.userId ?? null,
      platformAdmin: adminContext?.platformAdmin ?? false,
      activeSeasonId,
      seasonRole: adminContext?.seasonRole ?? null,
      seasonStatus: activeMembership?.status ?? null,
      memberships: mapSessionMemberships(mode === true ? memberships.filter(m => !m.disabled) : memberships),
      ...locationFields,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
