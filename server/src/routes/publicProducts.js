import { withPublicCatalogueContext, publicCatalogueResponse } from './publicCatalogueResponse.js'
import { isValidProductId } from '../lib/validation.js'
import { getPublicProductById, listPublicProducts } from '../services/publicProducts.js'
import { JSON_HEADERS } from '../lib/http.js'

/**
 * @param {Request} request
 * @param {{ DB?: D1Database }} env
 */
export async function handlePublicProductsList(request, env) {
  if (!env.DB) {
    return Response.json(
      { error: 'database_unavailable', message: 'Database binding is not available.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const url = new URL(request.url)
  const limit = url.searchParams.get('limit')
  const offset = url.searchParams.get('offset')

  return withPublicCatalogueContext(request, env, async context => {
    const products = await listPublicProducts(env.DB, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    }, env, context)
    return publicCatalogueResponse(request, context, { products })
  })
}

/**
 * @param {Request} request
 * @param {{ DB?: D1Database }} env
 * @param {string} productId
 */
export async function handlePublicProductById(request, env, productId) {
  if (!env.DB) {
    return Response.json(
      { error: 'database_unavailable', message: 'Database binding is not available.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const id = String(productId ?? '').trim()
  if (!isValidProductId(id)) {
    return Response.json(
      { error: 'validation_error', message: 'Invalid product id.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return withPublicCatalogueContext(request, env, async context => {
    const product = await getPublicProductById(env.DB, id, env, context)
    if (!product) {
      return Response.json(
        { error: 'not_found', message: 'Product not found.' },
        { status: 404, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
      )
    }
    return publicCatalogueResponse(request, context, { product })
  })
}
