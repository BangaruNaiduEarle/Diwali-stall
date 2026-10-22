import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import { parseJsonObject } from '../lib/validation.js'
import {
  createAdminFamilyPack,
  deleteAdminFamilyPack,
  getAdminFamilyPackById,
  listAdminFamilyPacks,
  setAdminFamilyPackActive,
  updateAdminFamilyPack,
} from '../services/adminFamilyPacks.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {URL} url
 */
export async function handleAdminFamilyPackRoutes(request, env, url) {
  const { pathname } = url
  const method = request.method
  const db = env.DB

  if (pathname === '/api/admin/family-packs' && method === 'GET') {
    const includeInactive = url.searchParams.get('includeInactive') !== '0'
    const q = url.searchParams.get('q') ?? ''
    const packs = await listAdminFamilyPacks(db, { includeInactive, q })
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
    const result = await createAdminFamilyPack(db, body.data)
    if (!result.ok) {
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
    const pack = await getAdminFamilyPackById(db, detailMatch[1])
    if (!pack) {
      return Response.json({ error: 'not_found', message: 'Family pack not found.' }, { status: 404, headers: NO_STORE })
    }
    return Response.json({ familyPack: pack }, { headers: NO_STORE })
  }

  if (detailMatch && method === 'DELETE') {
    const result = await deleteAdminFamilyPack(db, detailMatch[1])
    if (!result.ok) {
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
    const result = await updateAdminFamilyPack(db, detailMatch[1], body.data)
    if (!result.ok) {
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
    const result = await setAdminFamilyPackActive(db, statusMatch[1], active)
    if (!result.ok) {
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
