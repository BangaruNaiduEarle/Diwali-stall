/**
 * Worker entry — public catalogue API, fail-closed admin boundary, signed Cloudinary upload (Phase 3B).
 */
import { handleAdminAuthRoutes } from './routes/adminAuthRoutes.js'
import { handleAdminSession } from './routes/admin.js'
import { handleAdminUsersRoutes } from './routes/adminUsersRoutes.js'
import { handleAdminCatalogueRoutes } from './routes/adminCatalogue.js'
import { handleAdminCustomerRequestRoutes } from './routes/adminCustomerRequests.js'
import { handleAdminQuotationRoutes } from './routes/adminQuotations.js'
import { handleAdminQuickBillRoutes } from './routes/adminQuickBill.js'
import { handleAdminUploadSign } from './routes/adminUploads.js'
import { notFound } from './routes/notFound.js'
import { handleHealth } from './routes/health.js'
import {
  handlePublicProductById,
  handlePublicProductsList,
} from './routes/publicProducts.js'
import { handlePublicCustomerRequestPost } from './routes/publicCustomerRequests.js'
import {
  handlePublicFamilyPackBySlug,
  handlePublicFamilyPacksList,
} from './routes/publicFamilyPacks.js'
import { handleAdminFamilyPackRoutes } from './routes/adminFamilyPacks.js'
import { adminAuthErrorResponse, requireAdmin } from './middleware/requireAdmin.js'
import { withRequestContext } from './middleware/requestContext.js'

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {{ waitUntil: (p: Promise<unknown>) => void }} ctx
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method

  if (method === 'GET' && pathname === '/health') {
    return handleHealth(request, env)
  }

  if (method === 'GET' && pathname === '/api/public/products') {
    return handlePublicProductsList(request, env)
  }

  const publicProductMatch = pathname.match(/^\/api\/public\/products\/(P\d+)\/?$/)
  if (method === 'GET' && publicProductMatch) {
    return handlePublicProductById(request, env, publicProductMatch[1])
  }

  if (method === 'POST' && pathname === '/api/public/customer-requests') {
    return handlePublicCustomerRequestPost(request, env)
  }

  if (method === 'GET' && pathname === '/api/public/family-packs') {
    return handlePublicFamilyPacksList(request, env)
  }

  const publicFamilyPackMatch = pathname.match(/^\/api\/public\/family-packs\/([a-z0-9-]+)\/?$/)
  if (method === 'GET' && publicFamilyPackMatch) {
    return handlePublicFamilyPackBySlug(request, env, publicFamilyPackMatch[1])
  }

  if (pathname.startsWith('/api/admin')) {
    const publicAuth = await handleAdminAuthRoutes(request, env)
    if (publicAuth) {
      return publicAuth
    }

    const auth = await requireAdmin(request, env)
    if (!auth.ok) {
      return adminAuthErrorResponse(auth)
    }

    if (method === 'GET' && pathname === '/api/admin/session') {
      return handleAdminSession(request, { identity: auth.identity }, env)
    }

    if (method === 'POST' && pathname === '/api/admin/uploads/sign') {
      return handleAdminUploadSign(request, env)
    }

    const adminResponse = await handleAdminCatalogueRoutes(request, env, url, auth.identity)
    if (adminResponse) {
      return adminResponse
    }

    const familyPackResponse = await handleAdminFamilyPackRoutes(request, env, url)
    if (familyPackResponse) {
      return familyPackResponse
    }

    const customerRequestResponse = await handleAdminCustomerRequestRoutes(request, env, url)
    if (customerRequestResponse) {
      return customerRequestResponse
    }

    const quotationResponse = await handleAdminQuotationRoutes(request, env, url, auth.identity)
    if (quotationResponse) {
      return quotationResponse
    }

    const quickBillResponse = await handleAdminQuickBillRoutes(request, env, auth.identity)
    if (quickBillResponse) {
      return quickBillResponse
    }

    const usersResponse = await handleAdminUsersRoutes(request, env, auth)
    if (usersResponse) {
      return usersResponse
    }

    return Response.json(
      { error: 'not_found', message: 'Admin route not found.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return notFound(request)
}

export default {
  fetch(request, env, ctx) {
    return withRequestContext(request, env, () => handleRequest(request, env, ctx))
  },
}
