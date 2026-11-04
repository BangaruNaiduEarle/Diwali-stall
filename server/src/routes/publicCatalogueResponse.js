import { resolvePublicCatalogueContext } from '../services/publicCatalogueSeason.js'
import { JSON_HEADERS } from '../lib/http.js'

/** Internal representation key; client tenant selectors never supply its scope. */
export function publicCatalogueCacheKey(request, context) {
  const scope = context.scope
  return scope ? JSON.stringify(['public-catalogue-v1', scope.businessId, scope.locationId, scope.seasonId, request.url]) : null
}

export async function publicCatalogueResponse(request, context, payload) {
  const key = publicCatalogueCacheKey(request, context)
  const headers = { ...JSON_HEADERS, 'Cache-Control': key ? 'no-store' : 'public, max-age=60' }
  if (key) {
    // No URL-only browser/shared cache in location mode. Keep entity identities
    // scope-specific too; never honor another scope's If-None-Match as a 304.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([key, payload])))
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    headers.ETag = `"pc-${hash}"`
  }
  return Response.json(payload, { headers })
}

export async function withPublicCatalogueContext(request, env, read) {
  let context
  try {
    context = await resolvePublicCatalogueContext(env.DB, env)
    return await read(context)
  } catch (error) {
    if (error?.code !== 'catalogue_unavailable' && !context?.scope) throw error
    return Response.json({
      error: 'catalogue_unavailable', message: 'The catalogue is temporarily unavailable. Please try again later.',
    }, { status: 503, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } })
  }
}
