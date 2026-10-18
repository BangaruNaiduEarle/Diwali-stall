import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import {
  isValidCustomerRequestId,
  parseAdminCustomerRequestListQuery,
  validateCustomerRequestStatusPatchBody,
} from '../lib/adminCustomerRequestValidation.js'
import {
  getAdminCustomerRequestById,
  listAdminCustomerRequests,
  updateAdminCustomerRequestStatus,
} from '../services/adminCustomerRequests.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleAdminCustomerRequestRoutes(request, env, url) {
  const { pathname } = url
  const method = request.method
  const db = env.DB

  if (pathname === '/api/admin/customer-requests' && method === 'GET') {
    const parsed = parseAdminCustomerRequestListQuery(url.searchParams)
    if (!parsed.ok) return validationErrorResponse(parsed.errors)

    const { page, limit, offset, status } = parsed.data
    const { requests, total } = await listAdminCustomerRequests(db, { limit, offset, status })
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit)

    return Response.json(
      {
        requests,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      { headers: NO_STORE },
    )
  }

  const detailMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/?$/)
  if (detailMatch && method === 'GET') {
    const id = detailMatch[1]
    if (!isValidCustomerRequestId(id)) {
      return Response.json(
        { error: 'not_found', message: 'Customer request not found.' },
        { status: 404, headers: NO_STORE },
      )
    }
    const requestDetail = await getAdminCustomerRequestById(db, id)
    if (!requestDetail) {
      return Response.json(
        { error: 'not_found', message: 'Customer request not found.' },
        { status: 404, headers: NO_STORE },
      )
    }
    return Response.json({ request: requestDetail }, { headers: NO_STORE })
  }

  const statusMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/status\/?$/)
  if (statusMatch && method === 'PATCH') {
    const id = statusMatch[1]
    if (!isValidCustomerRequestId(id)) {
      return Response.json(
        { error: 'not_found', message: 'Customer request not found.' },
        { status: 404, headers: NO_STORE },
      )
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }

    const body = validateCustomerRequestStatusPatchBody(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)

    const result = await updateAdminCustomerRequestStatus(db, id, body.data.status)
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json(
          { error: result.code, message: result.message },
          { status: 404, headers: NO_STORE },
        )
      }
      if (result.fields) {
        return validationErrorResponse(result.fields)
      }
      return Response.json(
        { error: result.code ?? 'bad_request', message: result.message ?? 'Request failed.' },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }

    return Response.json({ request: result.request }, { headers: NO_STORE })
  }

  return null
}
