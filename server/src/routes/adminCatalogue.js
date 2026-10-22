import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import { parseJsonObject } from '../lib/validation.js'
import {
  createCategory,
  listAdminCategories,
  mapAdminCategoryRow,
  updateCategory,
} from '../services/adminCategories.js'
import { parseAdminProductListQuery } from '../lib/adminProductListValidation.js'
import {
  getCurrentPrivateRate,
  upsertCurrentPrivateRate,
  validatePrivateRateInr,
} from '../services/adminPrivateRates.js'
import {
  getCurrentPurchaseRate,
  upsertCurrentPurchaseRate,
  validatePurchaseRateInr,
} from '../services/adminPurchaseRates.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { filterAdminProductForRole, filterAdminProductsForRole } from '../lib/adminProductResponse.js'
import {
  archiveAdminProduct,
  deleteAdminProduct,
  setAdminProductActive,
  createAdminProduct,
  getAdminProductById,
  listAdminProducts,
  listAdminProductsPage,
  restoreAdminProduct,
  updateAdminProduct,
} from '../services/adminProducts.js'

/** @param {unknown} role */
function sensitivePricingForbiddenResponse(role) {
  if (canViewSensitiveProductPricing(role)) return null
  return Response.json(
    { error: 'forbidden', message: 'Not allowed for this role.' },
    { status: 403, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
  )
}

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {URL} url
 * @param {{ role?: string }} [identity]
 */
export async function handleAdminCatalogueRoutes(request, env, url, identity = {}) {
  const adminRole = identity.role
  const { pathname } = url
  const method = request.method
  const db = env.DB

  if (pathname === '/api/admin/categories' && method === 'GET') {
    const rows = await listAdminCategories(db)
    return Response.json(
      { categories: rows.map(mapAdminCategoryRow) },
      { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
    )
  }

  if (pathname === '/api/admin/categories' && method === 'POST') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const body = parseJsonObject(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)
    const result = await createCategory(db, {
      slug: String(body.data.slug ?? ''),
      label: String(body.data.label ?? ''),
      sort_order: body.data.sortOrder ?? body.data.sort_order,
    })
    if (!result.ok) return validationErrorResponse(result.errors)
    return Response.json(
      { category: mapAdminCategoryRow({ ...result.category, created_at: null, updated_at: null }) },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const categoryMatch = pathname.match(/^\/api\/admin\/categories\/([a-z0-9-]+)$/)
  if (categoryMatch && method === 'PATCH') {
    const slug = categoryMatch[1]
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const body = parseJsonObject(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)
    const result = await updateCategory(db, slug, {
      label: body.data.label,
      sort_order: body.data.sortOrder ?? body.data.sort_order,
    })
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json({ error: result.code, message: 'Category not found.' }, { status: 404 })
      }
      return validationErrorResponse(result.errors)
    }
    return Response.json({ category: mapAdminCategoryRow(result.category) }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (pathname === '/api/admin/products' && method === 'GET') {
    const usePageApi =
      url.searchParams.has('page') ||
      url.searchParams.has('q') ||
      url.searchParams.has('search') ||
      url.searchParams.has('missingRate') ||
      url.searchParams.has('missingPurchaseRate') ||
      url.searchParams.has('category')

    if (usePageApi) {
      const parsed = parseAdminProductListQuery(url.searchParams)
      if (!parsed.ok) return validationErrorResponse(parsed.errors)
      const { page, limit, offset, q, categorySlug, activeFilter, missingRateOnly, missingPurchaseRateOnly } =
        parsed.data
      const { products, total } = await listAdminProductsPage(db, {
        limit,
        offset,
        q,
        categorySlug,
        activeFilter,
        missingRateOnly,
        missingPurchaseRateOnly,
      })
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit)
      return Response.json(
        {
          products: filterAdminProductsForRole(products, adminRole),
          pagination: { page, limit, total, totalPages },
        },
        { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
      )
    }

    const includeArchived = url.searchParams.get('includeArchived') === '1'
    const limit = url.searchParams.get('limit')
    const offset = url.searchParams.get('offset')
    const products = await listAdminProducts(db, {
      includeArchived,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
    return Response.json(
      { products: filterAdminProductsForRole(products, adminRole) },
      { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
    )
  }

  if (pathname === '/api/admin/products' && method === 'POST') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const body = parseJsonObject(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)
    const payload = normalizeProductBody(body.data)
    const result = await createAdminProduct(db, payload)
    if (!result.ok) return validationErrorResponse(result.errors)
    return Response.json(
      { product: filterAdminProductForRole(result.product, adminRole) },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const sellingRateMatch = pathname.match(
    /^\/api\/admin\/products\/(P\d+)\/(?:private-rate|x4-selling-rate)\/?$/,
  )
  if (sellingRateMatch) {
    const denied = sensitivePricingForbiddenResponse(adminRole)
    if (denied) return denied
    const id = sellingRateMatch[1]
    if (method === 'GET') {
      const product = await getAdminProductById(db, id)
      if (!product) {
        return Response.json({ error: 'not_found', message: 'Product not found.' }, { status: 404 })
      }
      const rate = await getCurrentPrivateRate(db, id)
      return Response.json(
        { productId: id, rate, rateKind: 'x4_selling' },
        { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
      )
    }
    if (method === 'PUT' || method === 'PATCH') {
      const parsed = await readJsonBody(request)
      if (!parsed.ok) {
        return Response.json(
          { error: parsed.error, message: parsed.message },
          { status: parsed.status, headers: { 'Cache-Control': 'no-store' } },
        )
      }
      const body = parseJsonObject(parsed.value)
      if (!body.ok) return validationErrorResponse(body.errors)
      const inr =
        body.data.x4SellingPriceInr ??
        body.data.unitRateInr ??
        body.data.unit_rate_inr ??
        body.data.x4Inr
      const validated = validatePrivateRateInr(inr)
      if (!validated.ok) {
        return validationErrorResponse({ x4SellingPriceInr: validated.error })
      }
      const result = await upsertCurrentPrivateRate(db, id, validated.paise)
      if (!result.ok) {
        if (result.status === 404) {
          return Response.json({ error: result.code, message: result.message }, { status: 404 })
        }
        return validationErrorResponse(result.errors ?? {})
      }
      return Response.json({ rate: result.rate, rateKind: 'x4_selling' }, { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } })
    }
  }

  const purchaseRateMatch = pathname.match(/^\/api\/admin\/products\/(P\d+)\/purchase-rate\/?$/)
  if (purchaseRateMatch) {
    const denied = sensitivePricingForbiddenResponse(adminRole)
    if (denied) return denied
    const id = purchaseRateMatch[1]
    if (method === 'GET') {
      const product = await getAdminProductById(db, id)
      if (!product) {
        return Response.json({ error: 'not_found', message: 'Product not found.' }, { status: 404 })
      }
      const rate = await getCurrentPurchaseRate(db, id)
      return Response.json(
        { productId: id, rate, rateKind: 'purchase' },
        { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
      )
    }
    if (method === 'PUT' || method === 'PATCH') {
      const parsed = await readJsonBody(request)
      if (!parsed.ok) {
        return Response.json(
          { error: parsed.error, message: parsed.message },
          { status: parsed.status, headers: { 'Cache-Control': 'no-store' } },
        )
      }
      const body = parseJsonObject(parsed.value)
      if (!body.ok) return validationErrorResponse(body.errors)
      const inr = body.data.purchaseRateInr ?? body.data.unitRateInr ?? body.data.unit_rate_inr
      const validated = validatePurchaseRateInr(inr)
      if (!validated.ok) {
        return validationErrorResponse({ purchaseRateInr: validated.error })
      }
      const result = await upsertCurrentPurchaseRate(db, id, validated.paise)
      if (!result.ok) {
        if (result.status === 404) {
          return Response.json({ error: result.code, message: result.message }, { status: 404 })
        }
        return validationErrorResponse(result.errors ?? {})
      }
      return Response.json({ rate: result.rate, rateKind: 'purchase' }, { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } })
    }
  }

  const productStatusMatch = pathname.match(/^\/api\/admin\/products\/(P\d+)\/status\/?$/)
  if (productStatusMatch && method === 'PATCH') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const body = parseJsonObject(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)
    const active = body.data.active === true || body.data.active === 1
    const result = await setAdminProductActive(db, productStatusMatch[1], active)
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json({ error: result.code, message: 'Product not found.' }, { status: 404 })
      }
      return validationErrorResponse(result.errors ?? {})
    }
    return Response.json(
      { product: filterAdminProductForRole(result.product, adminRole) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/(P\d+)\/?$/)
  if (productMatch) {
    const id = productMatch[1]
    if (method === 'DELETE') {
      const result = await deleteAdminProduct(db, id)
      if (!result.ok) {
        if (result.errors) return validationErrorResponse(result.errors)
        return Response.json(
          { error: result.error, message: result.message, referenceCount: result.referenceCount },
          { status: result.status ?? 400, headers: { 'Cache-Control': 'no-store' } },
        )
      }
      return Response.json({ ok: true, id: result.id, name: result.name }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (method === 'GET') {
      const product = await getAdminProductById(db, id)
      if (!product) {
        return Response.json({ error: 'not_found', message: 'Product not found.' }, { status: 404 })
      }
      return Response.json(
        { product: filterAdminProductForRole(product, adminRole) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (method === 'PATCH') {
      const parsed = await readJsonBody(request)
      if (!parsed.ok) {
        return Response.json(
          { error: parsed.error, message: parsed.message },
          { status: parsed.status, headers: { 'Cache-Control': 'no-store' } },
        )
      }
      const body = parseJsonObject(parsed.value)
      if (!body.ok) return validationErrorResponse(body.errors)
      const result = await updateAdminProduct(db, id, normalizeProductBody(body.data))
      if (!result.ok) {
        if (result.status === 404) {
          return Response.json({ error: result.code, message: 'Product not found.' }, { status: 404 })
        }
        return validationErrorResponse(result.errors)
      }
      return Response.json(
        { product: filterAdminProductForRole(result.product, adminRole) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }

  const archiveMatch = pathname.match(/^\/api\/admin\/products\/(P\d+)\/archive$/)
  if (archiveMatch && method === 'POST') {
    const result = await archiveAdminProduct(db, archiveMatch[1])
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json({ error: result.code, message: 'Product not found.' }, { status: 404 })
      }
      return validationErrorResponse(result.errors)
    }
    return Response.json(
      { product: filterAdminProductForRole(result.product, adminRole) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const restoreMatch = pathname.match(/^\/api\/admin\/products\/(P\d+)\/restore$/)
  if (restoreMatch && method === 'POST') {
    const result = await restoreAdminProduct(db, restoreMatch[1])
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json({ error: result.code, message: 'Product not found.' }, { status: 404 })
      }
      return validationErrorResponse(result.errors)
    }
    return Response.json(
      { product: filterAdminProductForRole(result.product, adminRole) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return null
}

/** @param {Record<string, unknown>} data */
function normalizeProductBody(data) {
  return {
    id: data.id,
    categorySlug: data.categorySlug ?? data.category_slug,
    name: data.name,
    pack: data.pack,
    description: data.description,
    featured: data.featured,
    stockStatus: data.stockStatus ?? data.stock_status ?? 'available',
    active: data.active,
    sortOrder: data.sortOrder ?? data.sort_order,
    images: data.images,
    company: data.company,
    sellingPriceInr: data.sellingPriceInr ?? data.selling_price_inr,
  }
}
