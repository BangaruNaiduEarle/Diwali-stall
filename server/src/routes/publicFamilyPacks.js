import { withPublicCatalogueContext, publicCatalogueResponse } from './publicCatalogueResponse.js'
import { JSON_HEADERS } from '../lib/http.js'
import { getPublicFamilyPackBySlug, listPublicFamilyPacks } from '../services/publicFamilyPacks.js'


/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 */
export async function handlePublicFamilyPacksList(request, env) {
  return withPublicCatalogueContext(request, env, async context => {
    const packs = await listPublicFamilyPacks(env.DB, env, context)
    return publicCatalogueResponse(request, context, { familyPacks: packs })
  })
}

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {string} slug
 */
export async function handlePublicFamilyPackBySlug(request, env, slug) {
  return withPublicCatalogueContext(request, env, async context => {
    const pack = await getPublicFamilyPackBySlug(env.DB, slug, env, context)
    if (!pack) {
      return Response.json(
        { error: 'not_found', message: 'Family pack not found.' },
        { status: 404, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
      )
    }
    return publicCatalogueResponse(request, context, { familyPack: pack })
  })
}
