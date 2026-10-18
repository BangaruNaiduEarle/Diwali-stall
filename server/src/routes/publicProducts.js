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

  const products = await listPublicProducts(env.DB, {
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  })

  return Response.json(
    { products },
    {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': 'public, max-age=60',
      },
    },
  )
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

  const product = await getPublicProductById(env.DB, id)
  if (!product) {
    return Response.json(
      { error: 'not_found', message: 'Product not found.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return Response.json(
    { product },
    {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': 'public, max-age=60',
      },
    },
  )
}
