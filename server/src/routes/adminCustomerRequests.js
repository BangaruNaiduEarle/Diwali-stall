import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import {
  isValidCustomerRequestId,
  parseAdminCustomerRequestListQuery,
  validateCustomerRequestStatusPatchBody,
} from '../lib/adminCustomerRequestValidation.js'
import { validateCustomerRequestAssignBody } from '../lib/adminCustomerRequestFinalization.js'
import {
  canAssignQuickBillCustomerRequests,
  canFinalizeQuickBillCustomerRequests,
  normalizeAdminRole,
} from '../lib/adminRoles.js'
import {
  filterCustomerRequestDetailForRole,
  filterQuotationForCustomerRequestDetail,
} from '../lib/adminQuotationResponse.js'
import {
  adjustPendingCustomerRequestBill,
  previewPendingCustomerRequestBillAdjust,
  validateAdjustBillBody,
} from '../services/adminCustomerRequestBillAdjust.js'
import {
  assignAdminCustomerRequest,
  finalizeAdminCustomerRequest,
  getAdminCustomerRequestById,
  recordPublicCustomerAgreementPendingFinalization,
  enrichAdminCustomerRequestListForRole,
  listAdminCustomerRequests,
  updateAdminCustomerRequestStatus,
} from '../services/adminCustomerRequests.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {URL} url
 * @param {{ email?: string, role?: unknown }} identity
 * @returns {Promise<Response | null>}
 */
export async function handleAdminCustomerRequestRoutes(request, env, url, identity) {
  const { pathname } = url
  const method = request.method
  const db = env.DB
  const adminRole = normalizeAdminRole(identity?.role)

  if (pathname === '/api/admin/customer-requests' && method === 'GET') {
    const parsed = parseAdminCustomerRequestListQuery(url.searchParams)
    if (!parsed.ok) return validationErrorResponse(parsed.errors)

    const { page, limit, offset, status, q, finalizationStatus, assignedToMe } = parsed.data
    const assignedToEmail =
      assignedToMe && identity?.email ? String(identity.email).trim().toLowerCase() : undefined
    const { requests, total } = await listAdminCustomerRequests(db, {
      limit,
      offset,
      status,
      q,
      finalizationStatus,
      assignedToEmail,
    })
    const requestsOut = await enrichAdminCustomerRequestListForRole(db, requests, adminRole)
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit)

    return Response.json(
      {
        requests: requestsOut,
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
    return Response.json(
      { request: await filterCustomerRequestDetailForRole(db, requestDetail, adminRole) },
      { headers: NO_STORE },
    )
  }

  const assignMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/assign\/?$/)
  if (assignMatch && method === 'PATCH') {
    if (!canAssignQuickBillCustomerRequests(adminRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Not allowed to assign stall bills.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const id = assignMatch[1]
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

    const body = validateCustomerRequestAssignBody(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)

    const result = await assignAdminCustomerRequest(db, id, body.data, {
      assignedByEmail: identity?.email ?? null,
    })
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json(
          { error: result.code, message: result.message },
          { status: 404, headers: NO_STORE },
        )
      }
      if (result.fields) return validationErrorResponse(result.fields)
      return Response.json(
        { error: result.code ?? 'bad_request', message: result.message ?? 'Assign failed.' },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }

    return Response.json(
      { request: await filterCustomerRequestDetailForRole(db, result.request, adminRole) },
      { headers: NO_STORE },
    )
  }

  const customerAgreedMatch = pathname.match(
    /^\/api\/admin\/customer-requests\/([^/]+)\/customer-agreed\/?$/,
  )
  if (customerAgreedMatch && method === 'PATCH') {
    if (!canFinalizeQuickBillCustomerRequests(adminRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Only Owner or Super Admin can record customer agreement.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const id = customerAgreedMatch[1]
    if (!isValidCustomerRequestId(id)) {
      return Response.json(
        { error: 'not_found', message: 'Customer request not found.' },
        { status: 404, headers: NO_STORE },
      )
    }

    const result = await recordPublicCustomerAgreementPendingFinalization(db, id)
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json(
          { error: result.code, message: result.message },
          { status: 404, headers: NO_STORE },
        )
      }
      if (result.fields) return validationErrorResponse(result.fields)
      return Response.json(
        {
          error: result.code ?? 'bad_request',
          message: result.message ?? 'Could not record customer agreement.',
        },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }

    return Response.json(
      { request: await filterCustomerRequestDetailForRole(db, result.request, adminRole) },
      { headers: NO_STORE },
    )
  }

  const adjustBillPreviewMatch = pathname.match(
    /^\/api\/admin\/customer-requests\/([^/]+)\/adjust-bill\/preview\/?$/,
  )
  if (adjustBillPreviewMatch && method === 'POST') {
    if (!canFinalizeQuickBillCustomerRequests(adminRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Only Owner or Super Admin can preview bill adjustments.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const id = adjustBillPreviewMatch[1]
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

    const body = validateAdjustBillBody(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)

    const result = await previewPendingCustomerRequestBillAdjust(db, id, body.data.items)
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json(
          { error: result.code, message: result.message },
          { status: 404, headers: NO_STORE },
        )
      }
      if (result.fields) return validationErrorResponse(result.fields)
      return Response.json(
        { error: result.code ?? 'bad_request', message: result.message ?? 'Preview failed.' },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }

    return Response.json({ preview: result.preview }, { headers: NO_STORE })
  }

  const adjustBillMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/adjust-bill\/?$/)
  if (adjustBillMatch && method === 'PATCH') {
    if (!canFinalizeQuickBillCustomerRequests(adminRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Only Owner or Super Admin can adjust bills before finalize.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const id = adjustBillMatch[1]
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

    const body = validateAdjustBillBody(parsed.value)
    if (!body.ok) return validationErrorResponse(body.errors)

    const result = await adjustPendingCustomerRequestBill(db, id, body.data.items, {
      adjustedByEmail: identity?.email ?? null,
      acceptedAmountProvided: body.data.acceptedAmountProvided,
      acceptedAmountPaise: body.data.acceptedAmountPaise,
    })
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json(
          { error: result.code, message: result.message },
          { status: 404, headers: NO_STORE },
        )
      }
      if (result.fields) return validationErrorResponse(result.fields)
      return Response.json(
        { error: result.code ?? 'bad_request', message: result.message ?? 'Adjust bill failed.' },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }

    return Response.json(
      {
        request: await filterCustomerRequestDetailForRole(db, result.request, adminRole),
        quotation: result.quotation
          ? await filterQuotationForCustomerRequestDetail(
              db,
              result.quotation,
              adminRole,
              result.request,
            )
          : null,
        clearedAcceptedAmount: Boolean(result.clearedAcceptedAmount),
        savedAcceptedAmount: Boolean(result.savedAcceptedAmount),
      },
      { headers: NO_STORE },
    )
  }

  const finalizeMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/finalize\/?$/)
  if (finalizeMatch && method === 'PATCH') {
    if (!canFinalizeQuickBillCustomerRequests(adminRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Only Owner or Super Admin can finalize requests.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const id = finalizeMatch[1]
    if (!isValidCustomerRequestId(id)) {
      return Response.json(
        { error: 'not_found', message: 'Customer request not found.' },
        { status: 404, headers: NO_STORE },
      )
    }

    const result = await finalizeAdminCustomerRequest(db, id, {
      actorEmail: identity?.email ?? null,
    })
    if (!result.ok) {
      if (result.status === 404) {
        return Response.json(
          { error: result.code, message: result.message },
          { status: 404, headers: NO_STORE },
        )
      }
      if (result.fields) return validationErrorResponse(result.fields)
      return Response.json(
        { error: result.code ?? 'bad_request', message: result.message ?? 'Finalize failed.' },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }

    return Response.json(
      { request: await filterCustomerRequestDetailForRole(db, result.request, adminRole) },
      { headers: NO_STORE },
    )
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

    const result = await updateAdminCustomerRequestStatus(db, id, body.data.status, {
      actorEmail: identity?.email ?? null,
    })
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

    return Response.json(
      { request: await filterCustomerRequestDetailForRole(db, result.request, adminRole) },
      { headers: NO_STORE },
    )
  }

  return null
}
