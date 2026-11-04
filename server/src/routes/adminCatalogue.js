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
import { canDeleteAdminProducts, canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { filterAdminProductForRole, filterAdminProductsForRole } from '../lib/adminProductResponse.js'
import {
  requireActiveSeason,
  requireSeasonMembership,
  requireWritableSeason,
} from '../middleware/adminSeasonGuards.js'
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
import { getAdminContext } from '../middleware/requireAdmin.js'

/** @param {unknown} role */
function sensitivePricingForbiddenResponse(role) {
  if (canViewSensitiveProductPricing(role)) return null
  return Response.json(
    { error: 'forbidden', message: 'Not allowed for this role.' },
    { status: 403, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
  )
}

/** @param {string} pathname */
function isAdminCataloguePath(pathname) {
  return (
    pathname === '/api/admin/categories' ||
    pathname.startsWith('/api/admin/categories/') ||
    pathname === '/api/admin/products' ||
    pathname.startsWith('/api/admin/products/')
  )
}

/** @param {{ ok: false, status: number, code: string, message: string }} guard */
function catalogueGuardForbiddenResponse(guard) {
  return Response.json(
    { error: guard.code, message: guard.message },
    { status: guard.status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
  )
}

/** @param {unknown} role */
function productDeleteForbiddenResponse(role) {
  if (canDeleteAdminProducts(role)) return null
  return Response.json(
    { error: 'forbidden', message: 'Not allowed for this role.' },
    { status: 403, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
  )
}

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {URL} url
 * @param {{ role?: string }} [_identity]
 */
export async function handleAdminCatalogueRoutes(request, env, url, _identity = {}) {
  const { pathname } = url
  if (!isAdminCataloguePath(pathname)) {
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
      return catalogueGuardForbiddenResponse(activeSeason)
    }
    seasonId = activeSeason.activeSeasonId
    const membership = requireSeasonMembership(request)
    if (!membership.ok) {
      return catalogueGuardForbiddenResponse(membership)
    }
    seasonRole = membership.auth.seasonRole
  } else {
    const writable = requireWritableSeason(request)
    if (!writable.ok) {
      return catalogueGuardForbiddenResponse(writable)
    }
    seasonId = writable.auth.activeSeasonId
    seasonRole = writable.auth.seasonRole
  }

  void _identity
  const db = env.DB
  const catalogueContext = getAdminContext(request)
  const finalRateAllowed = catalogueContext?.locationModeEnabled === true && catalogueContext.locationContext?.capabilities?.viewFinalRate === true

  if (pathname === '/api/admin/categories' && method === 'GET') {
    const rows = await listAdminCategories(db, seasonId, catalogueContext)
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
    const result = await createCategory(db, seasonId, {
      slug: String(body.data.slug ?? ''),
      label: String(body.data.label ?? ''),
      sort_order: body.data.sortOrder ?? body.data.sort_order,
    }, catalogueContext)
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
    const result = await updateCategory(db, seasonId, slug, {
      label: body.data.label,
      sort_order: body.data.sortOrder ?? body.data.sort_order,
    }, catalogueContext)
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
      const {
        page,
        limit,
        offset,
        q,
        categorySlug,
        activeFilter,
        missingRateOnly,
        missingPurchaseRateOnly,
        flexSearch,
      } = parsed.data
      const { products, total } = await listAdminProductsPage(db, {
        seasonId,
        context: catalogueContext,
        limit,
        offset,
        q,
        categorySlug,
        activeFilter,
        missingRateOnly,
        missingPurchaseRateOnly,
        flexSearch,
      })
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit)
      return Response.json(
        {
          products: filterAdminProductsForRole(products, seasonRole, finalRateAllowed),
          pagination: { page, limit, total, totalPages },
        },
        { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
      )
    }

    const includeArchived = url.searchParams.get('includeArchived') === '1'
    const limit = url.searchParams.get('limit')
    const offset = url.searchParams.get('offset')
    const products = await listAdminProducts(db, {
      seasonId,
      context: catalogueContext,
      includeArchived,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
    return Response.json(
      { products: filterAdminProductsForRole(products, seasonRole, finalRateAllowed) },
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
    if (['sellingPriceInr', 'selling_price_inr', 'finalPriceInr', 'final_price_inr'].some(key => Object.hasOwn(body.data, key))) {
      const denied = sensitivePricingForbiddenResponse(seasonRole)
      if (denied) return denied
    }
    const payload = normalizeProductBody(body.data, seasonRole)
    const result = await createAdminProduct(db, seasonId, payload, catalogueContext)
    if (!result.ok) return validationErrorResponse(result.errors)
    return Response.json(
      { product: filterAdminProductForRole(result.product, seasonRole, finalRateAllowed) },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const sellingRateMatch = pathname.match(
    /^\/api\/admin\/products\/(P\d+)\/(?:private-rate|x4-selling-rate)\/?$/,
  )
  if (sellingRateMatch) {
    const denied = sensitivePricingForbiddenResponse(seasonRole)
    if (denied) return denied
    const id = sellingRateMatch[1]
    // Validate the catalogue target as well as the rate service's product scope.
    if (catalogueContext?.locationModeEnabled && (method === 'PUT' || method === 'PATCH') &&
        !await getAdminProductById(db, seasonId, id, catalogueContext)) {
      return Response.json({ error: 'not_found', message: 'Product not found.' }, { status: 404 })
    }
    if (method === 'GET') {
      const product = await getAdminProductById(db, seasonId, id, catalogueContext)
      if (!product) {
        return Response.json({ error: 'not_found', message: 'Product not found.' }, { status: 404 })
      }
      let rate
      try {
        rate = await getCurrentPrivateRate(db, id, seasonId, catalogueContext)
      } catch (error) {
        if (error.code !== 'rate_ownership_mismatch') throw error
        return rateConflictResponse(error)
      }
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
      const result = await upsertCurrentPrivateRate(db, id, validated.paise, seasonId, undefined, catalogueContext)
      if (!result.ok) {
        if (result.status === 409) return rateConflictResponse(result)
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
    const denied = sensitivePricingForbiddenResponse(seasonRole)
    if (denied) return denied
    const id = purchaseRateMatch[1]
    if (catalogueContext?.locationModeEnabled && (method === 'PUT' || method === 'PATCH') &&
        !await getAdminProductById(db, seasonId, id, catalogueContext)) {
      return Response.json({ error: 'not_found', message: 'Product not found.' }, { status: 404 })
    }
    if (method === 'GET') {
      const product = await getAdminProductById(db, seasonId, id, catalogueContext)
      if (!product) {
        return Response.json({ error: 'not_found', message: 'Product not found.' }, { status: 404 })
      }
      let rate
      try {
        rate = await getCurrentPurchaseRate(db, id, seasonId, catalogueContext)
      } catch (error) {
        if (error.code !== 'rate_ownership_mismatch') throw error
        return rateConflictResponse(error)
      }
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
      const result = await upsertCurrentPurchaseRate(db, id, validated.paise, seasonId, undefined, catalogueContext)
      if (!result.ok) {
        if (result.status === 409) return rateConflictResponse(result)
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
    const result = await setAdminProductActive(db, seasonId, productStatusMatch[1], active, catalogueContext)
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json({ error: result.code, message: 'Product not found.' }, { status: 404 })
      }
      return validationErrorResponse(result.errors ?? {})
    }
    return Response.json(
      { product: filterAdminProductForRole(result.product, seasonRole, finalRateAllowed) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/(P\d+)\/?$/)
  if (productMatch) {
    const id = productMatch[1]
    if (method === 'DELETE') {
      const denied = productDeleteForbiddenResponse(seasonRole)
      if (denied) return denied
      const result = await deleteAdminProduct(db, seasonId, id, catalogueContext)
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
      const product = await getAdminProductById(db, seasonId, id, catalogueContext)
      if (!product) {
        return Response.json({ error: 'not_found', message: 'Product not found.' }, { status: 404 })
      }
      return Response.json(
        { product: filterAdminProductForRole(product, seasonRole, finalRateAllowed) },
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
      if (['sellingPriceInr', 'selling_price_inr', 'finalPriceInr', 'final_price_inr'].some(key => Object.hasOwn(body.data, key))) {
        const denied = sensitivePricingForbiddenResponse(seasonRole)
        if (denied) return denied
      }
      const result = await updateAdminProduct(db, seasonId, id, normalizeProductBody(body.data, seasonRole), catalogueContext)
      if (!result.ok) {
        if (result.status === 404) {
          return Response.json({ error: result.code, message: 'Product not found.' }, { status: 404 })
        }
        return validationErrorResponse(result.errors)
      }
      return Response.json(
        { product: filterAdminProductForRole(result.product, seasonRole, finalRateAllowed) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }

  const archiveMatch = pathname.match(/^\/api\/admin\/products\/(P\d+)\/archive$/)
  if (archiveMatch && method === 'POST') {
    const result = await archiveAdminProduct(db, seasonId, archiveMatch[1], catalogueContext)
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json({ error: result.code, message: 'Product not found.' }, { status: 404 })
      }
      return validationErrorResponse(result.errors)
    }
    return Response.json(
      { product: filterAdminProductForRole(result.product, seasonRole, finalRateAllowed) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const restoreMatch = pathname.match(/^\/api\/admin\/products\/(P\d+)\/restore$/)
  if (restoreMatch && method === 'POST') {
    const result = await restoreAdminProduct(db, seasonId, restoreMatch[1], catalogueContext)
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json({ error: result.code, message: 'Product not found.' }, { status: 404 })
      }
      return validationErrorResponse(result.errors)
    }
    return Response.json(
      { product: filterAdminProductForRole(result.product, seasonRole, finalRateAllowed) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return Response.json(
    { error: 'not_found', message: 'Admin catalogue route not found.' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  )
}

function rateConflictResponse(result) {
  return Response.json(
    { error: result.code, message: result.message },
    { status: 409, headers: { 'Cache-Control': 'no-store' } },
  )
}

/** @param {Record<string, unknown>} data @param {unknown} [role] */
function normalizeProductBody(data, role) {
  /** @type {Record<string, unknown>} */
  const body = {
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
    piecesPerPack: data.piecesPerPack ?? data.pieces_per_pack,
    allowLooseSale: parseAllowLooseSale(data.allowLooseSale ?? data.allow_loose_sale),
  }
  if (canViewSensitiveProductPricing(role)) {
    if (data.finalPriceInr !== undefined || data.final_price_inr !== undefined) {
      body.finalPriceInr = data.finalPriceInr ?? data.final_price_inr
    }
  }
  if (body.piecesPerPack === undefined) delete body.piecesPerPack
  if (body.allowLooseSale === undefined) delete body.allowLooseSale
  return body
}

/** @param {unknown} value */
function parseAllowLooseSale(value) {
  if (value === undefined) return undefined
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  return undefined
}
