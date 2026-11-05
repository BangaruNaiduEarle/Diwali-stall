import { getAdminContext } from '../middleware/requireAdmin.js'
import { setLocationFinalRateAccess } from '../services/adminLocationMembers.js'
import { readJsonBody, JSON_HEADERS } from '../lib/http.js'
import {
  canAssignQuickBillCustomerRequests,
  canFinalizeQuickBillCustomerRequests,
  canChangeSeasonMemberRoles,
  canManageSeasonUsers,
} from '../lib/adminRoles.js'
import {
  createSeasonAdminUser,
  listSeasonAdminUsers,
  listSeasonAssignees,
  resetAdminUserPassword,
  removeLocationMember,
  setSeasonMemberDisabled,
  updateSeasonMemberRole,
} from '../services/adminUsersManagement.js'
import {
  requireSeasonMembership,
  requireSeasonRole,
  requireWritableSeason,
} from '../middleware/adminSeasonGuards.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/** @param {{ ok: false, status: number, code: string, message: string }} guard */
function guardForbiddenResponse(guard) {
  return Response.json(
    { error: guard.code, message: guard.message },
    { status: guard.status, headers: NO_STORE },
  )
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {{ identity: { userId?: string, email: string, role?: string } }} auth
 */
export async function handleAdminUsersRoutes(request, env, auth) {
  try { return await handleScopedAdminUsersRoutes(request, env, auth) } catch (error) {
    if (!getAdminContext(request)?.locationModeEnabled) throw error
    if (/no such column: can_view_final_rate/i.test(String(error?.message))) {
      return Response.json({ error: 'final_rate_schema_required', message: 'Final Rate access requires prepared migration 0027. No schema changes were applied.' }, { status: 503, headers: NO_STORE })
    }
    const known = [400, 403, 404, 409].includes(error?.status)
    return Response.json({ error: known ? error.code : 'membership_unavailable', message: known ? error.message : 'Location membership management is unavailable.' }, { status: known ? error.status : 503, headers: NO_STORE })
  }
}

async function handleScopedAdminUsersRoutes(request, env, auth) {
  const context = getAdminContext(request)
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method

  if (method === 'GET' && pathname === '/api/admin/users/assignees') {
    const access = requireSeasonMembership(request)
    if (!access.ok) {
      return guardForbiddenResponse(access)
    }
    if (!canAssignQuickBillCustomerRequests(access.auth.seasonRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Not allowed to list assignees.' },
        { status: 403, headers: NO_STORE },
      )
    }
    const assignees = (await listSeasonAssignees(env.DB, access.auth.activeSeasonId, context)).filter((u) =>
      canFinalizeQuickBillCustomerRequests(u.role),
    )
    return Response.json({ users: assignees }, { status: 200, headers: NO_STORE })
  }

  const manageAccess = requireSeasonRole(request, ['owner', 'super_admin'])
  if (!manageAccess.ok) {
    return guardForbiddenResponse(manageAccess)
  }
  const { activeSeasonId: seasonId, seasonRole: actorSeasonRole } = manageAccess.auth

  const finalRateMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/final-rate-access$/)
  if (method === 'POST' && finalRateMatch) {
    const writable = requireWritableSeason(request)
    if (!writable.ok) return guardForbiddenResponse(writable)
    if (!context?.locationModeEnabled) return Response.json({ error: 'forbidden', message: 'Select an authorized stall to manage Final Rate access.' }, { status: 403, headers: NO_STORE })
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return Response.json({ error: parsed.error, message: parsed.message }, { status: parsed.status, headers: NO_STORE })
    if (!parsed.value || Object.keys(parsed.value).some(key => key !== 'enabled') || typeof parsed.value.enabled !== 'boolean') {
      return Response.json({ error: 'validation_error', message: 'Provide only an enabled boolean.' }, { status: 400, headers: NO_STORE })
    }
    return Response.json(await setLocationFinalRateAccess(env.DB, seasonId, context, finalRateMatch[1], parsed.value.enabled), { headers: NO_STORE })
  }

  if (method === 'GET' && pathname === '/api/admin/users') {
    const users = await listSeasonAdminUsers(env.DB, seasonId, context)
    return Response.json({ users }, { status: 200, headers: NO_STORE })
  }

  if (method === 'POST' && pathname === '/api/admin/users') {
    const writeAccess = requireWritableSeason(request)
    if (!writeAccess.ok) {
      return guardForbiddenResponse(writeAccess)
    }
    if (!canManageSeasonUsers(actorSeasonRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Not allowed to manage users for this season.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    const result = await createSeasonAdminUser(env.DB, seasonId, actorSeasonRole, {
      email: String(body.email ?? ''),
      password: String(body.password ?? ''),
      displayName: body.displayName != null ? String(body.displayName) : undefined,
      role: body.role,
      ...(context?.locationModeEnabled ? { existingOnly: body.existingOnly } : {}),
    }, context)
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json({ user: result.user }, { status: 201, headers: NO_STORE })
  }

  const roleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/)
  if (method === 'POST' && roleMatch) {
    const writeAccess = requireWritableSeason(request)
    if (!writeAccess.ok) {
      return guardForbiddenResponse(writeAccess)
    }
    if (!canManageSeasonUsers(actorSeasonRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Owner or Super Admin access is required to change roles.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    if (!parsed.value || Array.isArray(parsed.value) || typeof parsed.value !== 'object' || Object.keys(body).some(key => key !== 'role') || typeof body.role !== 'string') {
      return Response.json({ error: 'validation_error', message: 'Provide only a valid role.' }, { status: 400, headers: NO_STORE })
    }
    const result = await updateSeasonMemberRole(
      env.DB,
      seasonId,
      actorSeasonRole,
      roleMatch[1],
      body.role,
      context,
    )
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json({ user: result.user }, { status: 200, headers: NO_STORE })
  }

  const disableMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/disable$/)
  if (method === 'POST' && disableMatch) {
    const writeAccess = requireWritableSeason(request)
    if (!writeAccess.ok) {
      return guardForbiddenResponse(writeAccess)
    }
    if (!canChangeSeasonMemberRoles(actorSeasonRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Season owner access is required.' },
        { status: 403, headers: NO_STORE },
      )
    }
    if (disableMatch[1] === auth.identity.userId) {
      return Response.json(
        { error: 'validation_error', message: 'You cannot disable your own account.' },
        { status: 400, headers: NO_STORE },
      )
    }
    const result = await setSeasonMemberDisabled(env.DB, seasonId, disableMatch[1], true, context)
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json({ ok: true }, { status: 200, headers: NO_STORE })
  }

  const enableMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/enable$/)
  if (method === 'POST' && enableMatch) {
    const writeAccess = requireWritableSeason(request)
    if (!writeAccess.ok) {
      return guardForbiddenResponse(writeAccess)
    }
    if (!canChangeSeasonMemberRoles(actorSeasonRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Season owner access is required.' },
        { status: 403, headers: NO_STORE },
      )
    }
    const result = await setSeasonMemberDisabled(env.DB, seasonId, enableMatch[1], false, context)
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json({ ok: true }, { status: 200, headers: NO_STORE })
  }

  const resetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/)
  if (method === 'POST' && resetMatch) {
    if (context?.locationModeEnabled) {
      return Response.json({ error: 'forbidden', message: 'Global credentials cannot be reset through location membership management.' }, { status: 403, headers: NO_STORE })
    }
    const writeAccess = requireWritableSeason(request)
    if (!writeAccess.ok) {
      return guardForbiddenResponse(writeAccess)
    }
    if (!canChangeSeasonMemberRoles(actorSeasonRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Season owner access is required.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    const result = await resetAdminUserPassword(env.DB, resetMatch[1], String(body.password ?? ''))
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status, headers: NO_STORE },
      )
    }
    return Response.json({ ok: true }, { status: 200, headers: NO_STORE })
  }

  const removeMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (context?.locationModeEnabled && method === 'DELETE' && removeMatch) {
    const writable = requireWritableSeason(request)
    if (!writable.ok) return guardForbiddenResponse(writable)
    const result = await removeLocationMember(env.DB, seasonId, removeMatch[1], context)
    return Response.json(result, { status: result.ok ? 200 : result.status, headers: NO_STORE })
  }
  return null
}
