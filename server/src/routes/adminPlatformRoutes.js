import { readJsonBody, JSON_HEADERS } from '../lib/http.js'
import { requirePlatformAdmin } from '../middleware/adminSeasonGuards.js'
import { provisionPlatformSeasonalLocation } from '../services/adminPlatformLocations.js'
import {
  archivePlatformBusinessSeason,
  createPlatformBusinessSeason,
  getPlatformBusinessSeasonById,
  listPlatformBusinessSeasons,
  reactivatePlatformBusinessSeason,
  updatePlatformBusinessSeason,
} from '../services/adminPlatformSeasons.js'
import {
  assignPlatformSeasonMember,
  listPlatformSeasonMembers,
  setPlatformSeasonMemberDisabled,
  updatePlatformSeasonMemberRole,
} from '../services/adminPlatformSeasonMembers.js'
import {
  getPlatformPublicCatalogueSeasonSetting,
  updatePlatformPublicCatalogueSeasonSetting,
} from '../services/adminPlatformPublicCatalogue.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/** @param {{ ok: false, status: number, code: string, message: string }} guard */
function platformGuardForbiddenResponse(guard) {
  return Response.json(
    { error: guard.code, message: guard.message },
    { status: guard.status, headers: NO_STORE },
  )
}

/** @param {{ ok: false, status: number, code: string, message: string }} result */
function platformErrorResponse(result) {
  return Response.json(
    { error: result.code, message: result.message },
    { status: result.status, headers: NO_STORE },
  )
}

/**
 * Platform Admin API (`/api/admin/platform/*`). Season membership is not required.
 *
 * @param {Request} request
 * @param {URL} url
 * @param {{ identity: { userId?: string, email: string } }} auth
 * @param {{ DB: D1Database }} env
 * @returns {Promise<Response>}
 */
export async function handleAdminPlatformRoutes(request, url, auth, env) {
  const { pathname } = url
  const method = request.method

  const access = requirePlatformAdmin(request)
  if (!access.ok) {
    return platformGuardForbiddenResponse(access)
  }

  if (method === 'GET' && pathname === '/api/admin/platform/session') {
    const userId = String(auth.identity.userId ?? access.userId ?? '').trim() || null
    return Response.json(
      {
        ok: true,
        platformAdmin: true,
        userId,
        email: auth.identity.email,
      },
      { status: 200, headers: NO_STORE },
    )
  }

  const db = env.DB

  if (method === 'POST' && pathname === '/api/admin/platform/locations') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return Response.json({ error: parsed.error, message: parsed.message }, { status: parsed.status, headers: NO_STORE })
    const result = await provisionPlatformSeasonalLocation(db, access.userId, parsed.value)
    if (!result.ok) return platformErrorResponse(result)
    const { ok, ...provisioned } = result
    return Response.json(provisioned, { status: 201, headers: NO_STORE })
  }

  const publicCatalogueSettingPath = '/api/admin/platform/settings/public-catalogue-season'
  if (method === 'GET' && pathname === publicCatalogueSettingPath) {
    const result = await getPlatformPublicCatalogueSeasonSetting(db)
    if (!result.ok) return platformErrorResponse(result)
    return Response.json(
      { publicCatalogueSeasonId: result.publicCatalogueSeasonId },
      { status: 200, headers: NO_STORE },
    )
  }

  if (method === 'PATCH' && pathname === publicCatalogueSettingPath) {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    const result = await updatePlatformPublicCatalogueSeasonSetting(
      db,
      {
        publicCatalogueSeasonId:
          body.publicCatalogueSeasonId != null ? String(body.publicCatalogueSeasonId) : undefined,
      },
      auth.identity.email,
    )
    if (!result.ok) return platformErrorResponse(result)
    return Response.json(
      { publicCatalogueSeasonId: result.publicCatalogueSeasonId },
      { status: 200, headers: NO_STORE },
    )
  }

  if (method === 'GET' && pathname === '/api/admin/platform/seasons') {
    const seasons = await listPlatformBusinessSeasons(db)
    return Response.json({ seasons }, { status: 200, headers: NO_STORE })
  }

  if (method === 'POST' && pathname === '/api/admin/platform/seasons') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    const result = await createPlatformBusinessSeason(db, {
      id: body.id != null ? String(body.id) : undefined,
      code: body.code != null ? String(body.code) : undefined,
      label: body.label != null ? String(body.label) : undefined,
    })
    if (!result.ok) return platformErrorResponse(result)
    return Response.json({ season: result.season }, { status: 201, headers: NO_STORE })
  }

  const seasonDetailMatch = pathname.match(/^\/api\/admin\/platform\/seasons\/([^/]+)\/?$/)
  if (seasonDetailMatch) {
    const seasonId = decodeURIComponent(seasonDetailMatch[1])
    if (method === 'GET') {
      const result = await getPlatformBusinessSeasonById(db, seasonId)
      if (!result.ok) return platformErrorResponse(result)
      return Response.json({ season: result.season }, { status: 200, headers: NO_STORE })
    }
    if (method === 'PATCH') {
      const parsed = await readJsonBody(request)
      if (!parsed.ok) {
        return Response.json(
          { error: parsed.error, message: parsed.message },
          { status: parsed.status, headers: NO_STORE },
        )
      }
      const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
      const result = await updatePlatformBusinessSeason(db, seasonId, {
        code: body.code,
        label: body.label,
      })
      if (!result.ok) return platformErrorResponse(result)
      return Response.json({ season: result.season }, { status: 200, headers: NO_STORE })
    }
  }

  const membersCollectionMatch = pathname.match(/^\/api\/admin\/platform\/seasons\/([^/]+)\/members\/?$/)
  if (membersCollectionMatch) {
    const seasonId = decodeURIComponent(membersCollectionMatch[1])
    if (method === 'GET') {
      const result = await listPlatformSeasonMembers(db, seasonId)
      if (!result.ok) return platformErrorResponse(result)
      return Response.json(
        { season: result.season, members: result.members },
        { status: 200, headers: NO_STORE },
      )
    }
    if (method === 'POST') {
      const parsed = await readJsonBody(request)
      if (!parsed.ok) {
        return Response.json(
          { error: parsed.error, message: parsed.message },
          { status: parsed.status, headers: NO_STORE },
        )
      }
      const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
      const result = await assignPlatformSeasonMember(db, seasonId, {
        email: body.email != null ? String(body.email) : undefined,
        role: body.role,
      })
      if (!result.ok) return platformErrorResponse(result)
      return Response.json({ member: result.member }, { status: 201, headers: NO_STORE })
    }
  }

  const memberDisableMatch = pathname.match(
    /^\/api\/admin\/platform\/seasons\/([^/]+)\/members\/([^/]+)\/disable\/?$/,
  )
  if (memberDisableMatch && method === 'POST') {
    const result = await setPlatformSeasonMemberDisabled(
      db,
      decodeURIComponent(memberDisableMatch[1]),
      decodeURIComponent(memberDisableMatch[2]),
      true,
      env,
    )
    if (!result.ok) return platformErrorResponse(result)
    return Response.json({ member: result.member }, { status: 200, headers: NO_STORE })
  }

  const memberEnableMatch = pathname.match(
    /^\/api\/admin\/platform\/seasons\/([^/]+)\/members\/([^/]+)\/enable\/?$/,
  )
  if (memberEnableMatch && method === 'POST') {
    const result = await setPlatformSeasonMemberDisabled(
      db,
      decodeURIComponent(memberEnableMatch[1]),
      decodeURIComponent(memberEnableMatch[2]),
      false,
      env,
    )
    if (!result.ok) return platformErrorResponse(result)
    return Response.json({ member: result.member }, { status: 200, headers: NO_STORE })
  }

  const memberDetailMatch = pathname.match(/^\/api\/admin\/platform\/seasons\/([^/]+)\/members\/([^/]+)\/?$/)
  if (memberDetailMatch && method === 'PATCH') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }
    const body = /** @type {Record<string, unknown>} */ (parsed.value ?? {})
    const result = await updatePlatformSeasonMemberRole(
      db,
      decodeURIComponent(memberDetailMatch[1]),
      decodeURIComponent(memberDetailMatch[2]),
      body.role,
      env,
    )
    if (!result.ok) return platformErrorResponse(result)
    return Response.json({ member: result.member }, { status: 200, headers: NO_STORE })
  }

  const archiveMatch = pathname.match(/^\/api\/admin\/platform\/seasons\/([^/]+)\/archive\/?$/)
  if (archiveMatch && method === 'POST') {
    const result = await archivePlatformBusinessSeason(db, decodeURIComponent(archiveMatch[1]))
    if (!result.ok) return platformErrorResponse(result)
    return Response.json({ season: result.season }, { status: 200, headers: NO_STORE })
  }

  const reactivateMatch = pathname.match(/^\/api\/admin\/platform\/seasons\/([^/]+)\/reactivate\/?$/)
  if (reactivateMatch && method === 'POST') {
    const result = await reactivatePlatformBusinessSeason(db, decodeURIComponent(reactivateMatch[1]))
    if (!result.ok) return platformErrorResponse(result)
    return Response.json({ season: result.season }, { status: 200, headers: NO_STORE })
  }

  return Response.json(
    { error: 'not_found', message: 'Platform Admin route not found.' },
    { status: 404, headers: NO_STORE },
  )
}
