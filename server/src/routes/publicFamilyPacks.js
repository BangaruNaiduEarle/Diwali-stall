import { JSON_HEADERS } from '../lib/http.js'
import { getPublicFamilyPackBySlug, listPublicFamilyPacks } from '../services/publicFamilyPacks.js'

const PUBLIC_CACHE = { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=60' }

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 */
export async function handlePublicFamilyPacksList(request, env) {
  const packs = await listPublicFamilyPacks(env.DB)
  return Response.json({ familyPacks: packs }, { headers: PUBLIC_CACHE })
}

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {string} slug
 */
export async function handlePublicFamilyPackBySlug(request, env, slug) {
  const pack = await getPublicFamilyPackBySlug(env.DB, slug)
  if (!pack) {
    return Response.json(
      { error: 'not_found', message: 'Family pack not found.' },
      { status: 404, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
    )
  }
  return Response.json({ familyPack: pack }, { headers: PUBLIC_CACHE })
}
