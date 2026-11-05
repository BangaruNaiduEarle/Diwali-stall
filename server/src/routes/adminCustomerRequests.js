import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import { customerRequestDb } from '../lib/adminCustomerRequestScope.js'
import { bulkDeleteAdminCustomerRequests, validateCustomerRequestBulkDelete } from '../services/adminCustomerRequestBulkDelete.js'
import { adminServiceMode } from '../lib/adminServiceMode.js'
import { getRequestWorkflowHistory } from '../services/adminRequestWorkflowHistory.js'
import { attachPaymentSummaries } from '../services/adminPayments.js'
import { filterQuickBillPreviewForRole } from '../lib/quickBillBargain.js'
import { getAdminContext } from '../middleware/requireAdmin.js'
import {
  isValidCustomerRequestId,
  parseAdminCustomerRequestListQuery,
  validateCustomerRequestStatusPatchBody,
} from '../lib/adminCustomerRequestValidation.js'
import { validateCustomerRequestAssignBody } from '../lib/adminCustomerRequestFinalization.js'
import {
  canAssignQuickBillCustomerRequests,
  canFinalizeQuickBillCustomerRequests,
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
  updateRequestPaymentPreferences,
} from '../services/adminCustomerRequests.js'
import {
  requireActiveSeason,
  requireSeasonMembership,
  requireWritableSeason,
} from '../middleware/adminSeasonGuards.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

function billAdjustSeasonForbiddenResponse() {
  return Response.json(
    {
      error: 'forbidden',
      message: 'Active business season is required for bill adjustment.',
    },
    { status: 403, headers: NO_STORE },
  )
}

function adminCustomerRequestSeasonForbiddenResponse() {
  return Response.json(
    {
      error: 'forbidden',
      message: 'Active business season is required for admin customer request access.',
    },
    { status: 403, headers: NO_STORE },
  )
}

/** @param {{ ok: false, status: number, code: string, message: string }} guard */
function customerRequestGuardForbiddenResponse(guard) {
  return Response.json(
    { error: guard.code, message: guard.message },
    { status: guard.status, headers: NO_STORE },
  )
}

/**
 * @param {Request} request
 * @param {boolean} isRead
 * @returns
 *   | { ok: true, seasonId: string, seasonRole: import('../lib/adminRoles.js').AdminRole }
 *   | { ok: false, response: Response }
 */
function resolveAdminCustomerRequestSeasonAccess(request, isRead) {
  if (isRead) {
    const activeSeason = requireActiveSeason(request)
    if (!activeSeason.ok) {
      return { ok: false, response: customerRequestGuardForbiddenResponse(activeSeason) }
    }
    const membership = requireSeasonMembership(request)
    if (!membership.ok) {
      return { ok: false, response: customerRequestGuardForbiddenResponse(membership) }
    }
    return {
      ok: true,
      seasonId: membership.auth.activeSeasonId,
      seasonRole: membership.auth.seasonRole,
    }
  }
  const writable = requireWritableSeason(request)
  if (!writable.ok) {
    return { ok: false, response: customerRequestGuardForbiddenResponse(writable) }
  }
  return {
    ok: true,
    seasonId: writable.auth.activeSeasonId,
    seasonRole: writable.auth.seasonRole,
  }
}

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {URL} url
 * @param {{ email?: string, role?: unknown }} identity
 * @returns {Promise<Response | null>}
 */
export async function handleAdminCustomerRequestRoutes(request, env, url, identity) {
  try {
    return await handleScopedAdminCustomerRequestRoutes(request, env, url, identity)
  } catch (error) {
    if (!['request_ownership_mismatch', 'forbidden', 'location_context_unavailable', 'revision_conflict'].includes(error?.code)) throw error
    return Response.json({ error: error.code, message: error.code === 'revision_conflict' ? 'The request changed. Refresh before retrying.' : error.message }, { status: error.status, headers: NO_STORE })
  }
}

async function handleScopedAdminCustomerRequestRoutes(request, env, url, identity) {
  const { pathname } = url
  const method = request.method
  const context = getAdminContext(request)
  if (pathname === '/api/admin/customer-requests/bulk-delete' && method === 'POST') {
    const access = requireWritableSeason(request)
    if (!access.ok) return customerRequestGuardForbiddenResponse(access)
    if (!['owner', 'super_admin'].includes(access.auth.seasonRole)) {
      return Response.json({ error: 'forbidden', message: 'Owner or Super Admin access is required.' }, { status: 403, headers: NO_STORE })
    }
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return Response.json({ error: parsed.error, message: parsed.message }, { status: parsed.status, headers: NO_STORE })
    const valid = validateCustomerRequestBulkDelete(parsed.value)
    if (!valid.ok) return validationErrorResponse(valid.errors)
    const result = await bulkDeleteAdminCustomerRequests(env.DB, valid.ids, { seasonId: access.auth.activeSeasonId, context })
    return Response.json(result, { headers: NO_STORE })
  }
  let db = env.DB
  if (adminServiceMode(db) === true || context?.locationModeEnabled) {
    const access = resolveAdminCustomerRequestSeasonAccess(request, ['GET', 'HEAD', 'OPTIONS'].includes(method))
    if (!access.ok) return access.response
    db = customerRequestDb(db, access.seasonId, context, !['GET', 'HEAD', 'OPTIONS'].includes(method))
  }

  const historyMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/history\/?$/)
  if (historyMatch && method === 'GET') {
    const access = resolveAdminCustomerRequestSeasonAccess(request, true)
    if (!access.ok) return access.response
    if (!isValidCustomerRequestId(historyMatch[1])) return Response.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    const afterRevision = Number(url.searchParams.get('afterRevision') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 50)
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return validationErrorResponse({ pagination: 'Invalid revision cursor or limit.' })
    const result = await getRequestWorkflowHistory(db, historyMatch[1], { seasonId: access.seasonId, context, afterRevision, limit })
    return Response.json(result, { status: result.ok ? 200 : result.status, headers: NO_STORE })
  }

  if (pathname === '/api/admin/customer-requests' && method === 'GET') {
    const access = resolveAdminCustomerRequestSeasonAccess(request, true)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

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
      seasonId,
      context,
    })
    const enriched = await enrichAdminCustomerRequestListForRole(db, requests, seasonRole, seasonId, context)
    const requestsOut = await attachPaymentSummaries(env.DB, enriched, { seasonId, context, listView: true })
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
    const access = resolveAdminCustomerRequestSeasonAccess(request, true)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

    const id = detailMatch[1]
    if (!isValidCustomerRequestId(id)) {
      return Response.json(
        { error: 'not_found', message: 'Customer request not found.' },
        { status: 404, headers: NO_STORE },
      )
    }
    const requestDetail = await getAdminCustomerRequestById(db, id, seasonId, context)
    if (!requestDetail) {
      return Response.json(
        { error: 'not_found', message: 'Customer request not found.' },
        { status: 404, headers: NO_STORE },
      )
    }
    return Response.json(
      { request: (await attachPaymentSummaries(env.DB, [await filterCustomerRequestDetailForRole(db, requestDetail, seasonRole, seasonId)], { seasonId, context }))[0] },
      { headers: NO_STORE },
    )
  }

  const preferencesMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/payment-preferences\/?$/)
  if (preferencesMatch && method === 'PATCH') {
    const access = resolveAdminCustomerRequestSeasonAccess(request, false)
    if (!access.ok) return access.response
    if (!canFinalizeQuickBillCustomerRequests(access.seasonRole)) {
      return Response.json({ error: 'forbidden', message: 'Only Owner or Super Admin can edit payment preferences.' }, { status: 403, headers: NO_STORE })
    }
    if (!isValidCustomerRequestId(preferencesMatch[1])) return Response.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return Response.json({ error: parsed.error, message: parsed.message }, { status: parsed.status, headers: NO_STORE })
    const result = await updateRequestPaymentPreferences(db, preferencesMatch[1], parsed.value, {
      seasonId: access.seasonId, actorRole: access.seasonRole, context,
    })
    if (!result.ok) return Response.json({ error: result.code, message: result.message }, { status: result.status, headers: NO_STORE })
    return Response.json({ request: await filterCustomerRequestDetailForRole(db, result.request, access.seasonRole, access.seasonId) }, { headers: NO_STORE })
  }

  const assignMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/assign\/?$/)
  if (assignMatch && method === 'PATCH') {
    const access = resolveAdminCustomerRequestSeasonAccess(request, false)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

    if (!canAssignQuickBillCustomerRequests(seasonRole)) {
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
      requireRevision: Boolean(context?.locationModeEnabled),
      assignedByEmail: identity?.email ?? null,
      seasonId,
      context,
    })
    if (!result.ok) {
      if (result.status === 403) {
        return adminCustomerRequestSeasonForbiddenResponse()
      }
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
      {
        request: await filterCustomerRequestDetailForRole(db, result.request, seasonRole, seasonId),
      },
      { headers: NO_STORE },
    )
  }

  const customerAgreedMatch = pathname.match(
    /^\/api\/admin\/customer-requests\/([^/]+)\/customer-agreed\/?$/,
  )
  if (customerAgreedMatch && method === 'PATCH') {
    const access = resolveAdminCustomerRequestSeasonAccess(request, false)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

    if (!canFinalizeQuickBillCustomerRequests(seasonRole)) {
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

    const result = await recordPublicCustomerAgreementPendingFinalization(db, id, seasonId, context)
    if (!result.ok) {
      if (result.status === 403) {
        return adminCustomerRequestSeasonForbiddenResponse()
      }
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
      {
        request: await filterCustomerRequestDetailForRole(db, result.request, seasonRole, seasonId),
      },
      { headers: NO_STORE },
    )
  }

  const adjustBillPreviewMatch = pathname.match(
    /^\/api\/admin\/customer-requests\/([^/]+)\/adjust-bill\/preview\/?$/,
  )
  if (adjustBillPreviewMatch && method === 'POST') {
    const access = resolveAdminCustomerRequestSeasonAccess(request, false)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

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

    const body = validateAdjustBillBody(parsed.value, seasonRole)
    if (!body.ok) return body.errors ? validationErrorResponse(body.errors) : Response.json({ error: body.code, message: body.message }, { status: body.status, headers: NO_STORE })

    const result = await previewPendingCustomerRequestBillAdjust(db, id, body.data.items, seasonId, context, { ...body.data, actorRole: seasonRole })
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

    return Response.json({ preview: filterQuickBillPreviewForRole(result.preview, seasonRole) }, { headers: NO_STORE })
  }

  const adjustBillMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/adjust-bill\/?$/)
  if (adjustBillMatch && method === 'PATCH') {
    const access = resolveAdminCustomerRequestSeasonAccess(request, false)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

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

    const body = validateAdjustBillBody(parsed.value, seasonRole)
    if (!body.ok) return body.errors ? validationErrorResponse(body.errors) : Response.json({ error: body.code, message: body.message }, { status: body.status, headers: NO_STORE })

    const result = await adjustPendingCustomerRequestBill(db, id, body.data.items, {
      overrides: body.data.overrides,
      discountProvided: body.data.discountProvided,
      discountPaise: body.data.discountPaise,
      actorRole: seasonRole,
      requireRevision: Boolean(context?.locationModeEnabled),
      adjustedByEmail: identity?.email ?? null,
      acceptedAmountProvided: body.data.acceptedAmountProvided,
      acceptedAmountPaise: body.data.acceptedAmountPaise,
      seasonId,
      context,
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
        request: await filterCustomerRequestDetailForRole(db, result.request, seasonRole, seasonId),
        quotation: result.quotation
          ? await filterQuotationForCustomerRequestDetail(
              db,
              result.quotation,
              seasonRole,
              result.request,
              seasonId,
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
    const access = resolveAdminCustomerRequestSeasonAccess(request, false)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

    if (!canFinalizeQuickBillCustomerRequests(seasonRole)) {
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
      seasonId,
      context,
    })
    if (!result.ok) {
      if (result.status === 403) {
        return adminCustomerRequestSeasonForbiddenResponse()
      }
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
      {
        request: await filterCustomerRequestDetailForRole(db, result.request, seasonRole, seasonId),
      },
      { headers: NO_STORE },
    )
  }

  const statusMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/status\/?$/)
  if (statusMatch && method === 'PATCH') {
    const access = resolveAdminCustomerRequestSeasonAccess(request, false)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

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

    if (body.data.status === 'closed' && !canFinalizeQuickBillCustomerRequests(seasonRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Only Owner or Super Admin can close requests.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const result = await updateAdminCustomerRequestStatus(db, id, body.data.status, {
      actorEmail: identity?.email ?? null,
      seasonId,
      context,
    })
    if (!result.ok) {
      if (result.status === 403) {
        return adminCustomerRequestSeasonForbiddenResponse()
      }
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
      {
        request: await filterCustomerRequestDetailForRole(db, result.request, seasonRole, seasonId),
      },
      { headers: NO_STORE },
    )
  }

  return null
}
