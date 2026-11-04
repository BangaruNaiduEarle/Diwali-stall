import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import { parseJsonObject } from '../lib/validation.js'
import { getAdminContext } from '../middleware/requireAdmin.js'
import {
  requireActiveSeason,
  requireSeasonMembership,
  requireWritableSeason,
} from '../middleware/adminSeasonGuards.js'
import {
  createAdminFamilyPack,
  deleteAdminFamilyPack,
  getAdminFamilyPackById,
  listAdminFamilyPacks,
  setAdminFamilyPackActive,
  updateAdminFamilyPack,
} from '../services/adminFamilyPacks.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/** @param {string} pathname */
function isAdminFamilyPackPath(pathname) {
  return pathname === '/api/admin/family-packs' || pathname.startsWith('/api/admin/family-packs/')
}

/** @param {{ ok: false, status: number, code: string, message: string }} guard */
function familyPackGuardForbiddenResponse(guard) {
  return Response.json(
    { error: guard.code, message: guard.message },
    { status: guard.status, headers: NO_STORE },
  )
}

/** @param {{ status?: number, code?: string, message?: string }} result */
function familyPackSeasonForbiddenResponse(result = {}) {
  return Response.json(
    {
      error: result.code ?? 'forbidden',
      message: result.message ?? 'Active business season is required for family pack access.',
    },
    { status: result.status ?? 403, headers: NO_STORE },
  )
}

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {URL} url
 */
export async function handleAdminFamilyPackRoutes(request, env, url) {
  const { pathname } = url
  if (!isAdminFamilyPackPath(pathname)) {
    return null
  }

  const method = request.method
  const isRead = method === 'GET'

  /** @type {string} */
  let seasonId
  /** @type {import('../lib/adminRoles.js').AdminRole} */
  let seasonRole

  if (isRead) {
    const activeSeason = requireActiveSeason(request)
    if (!activeSeason.ok) {
      return familyPackGuardForbiddenResponse(activeSeason)
    }
    seasonId = activeSeason.activeSeasonId
    const membership = requireSeasonMembership(request)
    if (!membership.ok) {
      return familyPackGuardForbiddenResponse(membership)
    }
    seasonRole = membership.auth.seasonRole
  } else {
    const writable = requireWritableSeason(request)
    if (!writable.ok) {
      return familyPackGuardForbiddenResponse(writable)
    }
    seasonId = writable.auth.activeSeasonId
    seasonRole = writable.auth.seasonRole
  }

  void seasonRole
  const db = env.DB
  const context = getAdminContext(request)

  if (pathname === '/api/admin/family-packs' && method === 'GET') {
    const includeInactive = url.searchParams.get('includeInactive') !== '0'
    const q = url.searchParams.get('q') ?? ''
    const packs = await listAdminFamilyPacks(db, seasonId, { includeInactive, q, context })
    return Response.json({ familyPacks: packs }, { headers: NO_STORE })
  }

  if (pathname === '/api/admin/family-packs' && method === 'POST') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = parseJsonObject(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)
    const result = await createAdminFamilyPack(db, seasonId, body.data, context)
    if (!result.ok) {
      if (result.status === 403) {
        return familyPackSeasonForbiddenResponse()
      }
      if (result.errors) return validationErrorResponse(result.errors)
      return Response.json(
        { error: result.error, message: result.message },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }
    return Response.json({ familyPack: result.pack }, { status: 201, headers: NO_STORE })
  }

  const detailMatch = pathname.match(/^\/api\/admin\/family-packs\/(FP\d+)\/?$/)
  if (detailMatch && method === 'GET') {
    const pack = await getAdminFamilyPackById(db, detailMatch[1], seasonId, context)
    if (!pack) {
      return Response.json({ error: 'not_found', message: 'Family pack not found.' }, { status: 404, headers: NO_STORE })
    }
    return Response.json({ familyPack: pack }, { headers: NO_STORE })
  }

  if (detailMatch && method === 'DELETE') {
    const result = await deleteAdminFamilyPack(db, detailMatch[1], seasonId, context)
    if (!result.ok) {
      if (result.status === 403) {
        return familyPackSeasonForbiddenResponse()
      }
      if (result.errors) return validationErrorResponse(result.errors)
      return Response.json(
        { error: result.error, message: result.message, referenceCount: result.referenceCount },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }
    return Response.json({ ok: true, id: result.id, name: result.name }, { headers: NO_STORE })
  }

  if (detailMatch && method === 'PUT') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = parseJsonObject(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)
    const result = await updateAdminFamilyPack(db, detailMatch[1], seasonId, body.data, context)
    if (!result.ok) {
      if (result.status === 403) {
        return familyPackSeasonForbiddenResponse()
      }
      if (result.errors) return validationErrorResponse(result.errors)
      return Response.json(
        { error: result.error, message: result.message },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }
    return Response.json({ familyPack: result.pack }, { headers: NO_STORE })
  }

  const statusMatch = pathname.match(/^\/api\/admin\/family-packs\/(FP\d+)\/status\/?$/)
  if (statusMatch && method === 'PATCH') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = parseJsonObject(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)
    const active = body.data.active === true || body.data.active === 1
    const result = await setAdminFamilyPackActive(db, statusMatch[1], active, seasonId, context)
    if (!result.ok) {
      if (result.status === 403) {
        return familyPackSeasonForbiddenResponse()
      }
      if (result.errors) return validationErrorResponse(result.errors)
      return Response.json(
        { error: result.error, message: result.message },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }
    return Response.json({ familyPack: result.pack }, { headers: NO_STORE })
  }

  return null
}
