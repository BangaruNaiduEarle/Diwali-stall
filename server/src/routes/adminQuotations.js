import { customerRequestDb } from '../lib/adminCustomerRequestScope.js'
import { adminServiceMode } from '../lib/adminServiceMode.js'
import { getAdminContext } from '../middleware/requireAdmin.js'
import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import { buildWhatsAppSendUrl } from '../lib/quotationWhatsApp.js'
import { isValidCustomerRequestId } from '../lib/adminCustomerRequestValidation.js'
import { parseCustomerAgreedAmountInrPaise } from '../lib/quickBillBargain.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import {
  filterQuotationForCustomerRequestDetail,
  filterQuotationForRole,
} from '../lib/adminQuotationResponse.js'
import { getAdminCustomerRequestById } from '../services/adminCustomerRequests.js'
import {
  createOrGetQuotationForRequest,
  getActiveQuotationForRequest,
  getQuotationById,
  getOrderConfirmationWhatsAppPayload,
  getQuotationWhatsAppPayload,
  patchActiveQuotationCustomerAgreedAmount,
} from '../services/adminQuotations.js'
import {
  requireActiveSeason,
  requireSeasonMembership,
  requireWritableSeason,
} from '../middleware/adminSeasonGuards.js'

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {Record<string, unknown>} quotation
 * @param {unknown} seasonRole
 * @param {string} seasonId
 */
async function quotationJsonForCustomerRequestDetail(db, requestId, quotation, seasonRole, seasonId) {
  const request = await getAdminCustomerRequestById(db, requestId, seasonId)
  return filterQuotationForCustomerRequestDetail(db, quotation, seasonRole, request, seasonId)
}

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

function adminQuotationSeasonForbiddenResponse() {
  return Response.json(
    {
      error: 'forbidden',
      message: 'Active business season is required for admin quotation access.',
    },
    { status: 403, headers: NO_STORE },
  )
}

/** @param {{ ok: false, status: number, code: string, message: string }} guard */
function quotationGuardForbiddenResponse(guard) {
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
function resolveAdminQuotationSeasonAccess(request, isRead) {
  if (isRead) {
    const activeSeason = requireActiveSeason(request)
    if (!activeSeason.ok) {
      return { ok: false, response: quotationGuardForbiddenResponse(activeSeason) }
    }
    const membership = requireSeasonMembership(request)
    if (!membership.ok) {
      return { ok: false, response: quotationGuardForbiddenResponse(membership) }
    }
    return {
      ok: true,
      seasonId: membership.auth.activeSeasonId,
      seasonRole: membership.auth.seasonRole,
    }
  }
  const writable = requireWritableSeason(request)
  if (!writable.ok) {
    return { ok: false, response: quotationGuardForbiddenResponse(writable) }
  }
  return {
    ok: true,
    seasonId: writable.auth.activeSeasonId,
    seasonRole: writable.auth.seasonRole,
  }
}

/**
 * @param {D1Database} db
 * @param {string} quotationId
 * @param {string} seasonId
 */
async function quotationBelongsToSeason(db, quotationId, seasonId) {
  const row = await db
    .prepare('SELECT season_id FROM quotations WHERE id = ?')
    .bind(quotationId)
    .first()
  if (!row) return false
  return String(row.season_id ?? '') === String(seasonId)
}

/**
 * WhatsApp prepare responses are customer-facing only (catalogue selling totals).
 * Restricted admins receive the same safe payload — no audit or internal rate fields.
 *
 * @param {Record<string, unknown>} payload
 * @param {unknown} seasonRole
 */
function jsonWhatsAppPreparePayload(payload, seasonRole) {
  if (canViewSensitiveProductPricing(seasonRole)) {
    return payload
  }
  return {
    message: payload.message,
    whatsAppUrl: payload.whatsAppUrl,
    quotationId: payload.quotationId,
    ...(payload.requestId != null ? { requestId: payload.requestId } : {}),
  }
}

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {URL} url
 * @param {{ email: string }} identity
 */
export async function handleAdminQuotationRoutes(request, env, url, identity) {
  try {
    return await handleScopedAdminQuotationRoutes(request, env, url, identity)
  } catch (error) {
    if (!['request_ownership_mismatch', 'forbidden', 'revision_conflict'].includes(error?.code)) throw error
    return Response.json({ error: error.code, message: error.code === 'revision_conflict' ? 'The request changed. Refresh before retrying.' : error.message }, { status: error.status, headers: NO_STORE })
  }
}

async function handleScopedAdminQuotationRoutes(request, env, url, identity) {
  const { pathname } = url
  const method = request.method
  let db = env.DB
  const context = getAdminContext(request)
  if (adminServiceMode(db) === true || context?.locationModeEnabled) {
    if (!/\/(?:quotation|quotations|order-confirmation)(?:\/|$)/.test(pathname)) return null
    const access = resolveAdminQuotationSeasonAccess(request, method === 'GET')
    if (!access.ok) return access.response
    db = customerRequestDb(db, access.seasonId, context, method !== 'GET')
  }

  const requestQuoteMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/quotation\/?$/)
  if (requestQuoteMatch) {
    const requestId = requestQuoteMatch[1]
    if (!isValidCustomerRequestId(requestId)) {
      return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
    }

    if (method === 'GET') {
      const access = resolveAdminQuotationSeasonAccess(request, true)
      if (!access.ok) return access.response
      const { seasonId, seasonRole } = access

      const requestRow = await getAdminCustomerRequestById(db, requestId, seasonId)
      if (!requestRow) {
        return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
      }

      const quotation = await getActiveQuotationForRequest(db, requestId, seasonId)
      if (!quotation) {
        return Response.json({ error: 'not_found', message: 'No quotation for this request.' }, { status: 404, headers: NO_STORE })
      }
      return Response.json(
        {
          quotation: await quotationJsonForCustomerRequestDetail(
            db,
            requestId,
            quotation,
            seasonRole,
            seasonId,
          ),
        },
        { headers: NO_STORE },
      )
    }

    if (method === 'POST') {
      const access = resolveAdminQuotationSeasonAccess(request, false)
      if (!access.ok) return access.response
      const { seasonId, seasonRole } = access

      const requestRow = await getAdminCustomerRequestById(db, requestId, seasonId)
      if (!requestRow) {
        return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
      }

      const result = await createOrGetQuotationForRequest(db, requestId, {
        createdByEmail: identity.email,
        seasonId,
      })
      if (!result.ok) {
        if (result.status === 403) {
          return adminQuotationSeasonForbiddenResponse()
        }
        if (result.status === 404) {
          return Response.json({ error: result.code, message: result.message }, { status: 404, headers: NO_STORE })
        }
        if (result.code === 'missing_selling_price' || result.code === 'missing_private_rates') {
          return Response.json(
            {
              error: result.code === 'missing_private_rates' ? 'missing_selling_price' : result.code,
              message: result.message,
              missingProductIds: result.missingProductIds,
            },
            { status: 400, headers: NO_STORE },
          )
        }
        if (result.fields) return validationErrorResponse(result.fields)
        return Response.json(
          { error: result.code ?? 'bad_request', message: result.message ?? 'Quotation failed.' },
          { status: result.status ?? 400, headers: NO_STORE },
        )
      }
      const status = result.created ? 201 : 200
      return Response.json(
        {
          quotation: await quotationJsonForCustomerRequestDetail(
            db,
            requestId,
            result.quotation,
            seasonRole,
            seasonId,
          ),
          created: result.created,
          regenerated: false,
        },
        { status, headers: NO_STORE },
      )
    }
  }

  const agreedAmountMatch = pathname.match(
    /^\/api\/admin\/customer-requests\/([^/]+)\/quotation\/customer-agreed-amount\/?$/,
  )
  if (agreedAmountMatch && method === 'PATCH') {
    const access = resolveAdminQuotationSeasonAccess(request, false)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

    if (!canViewSensitiveProductPricing(seasonRole)) {
      return Response.json(
        { error: 'forbidden', message: 'Not allowed to record customer-agreed amount.' },
        { status: 403, headers: NO_STORE },
      )
    }

    const requestId = agreedAmountMatch[1]
    if (!isValidCustomerRequestId(requestId)) {
      return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error, message: parsed.message },
        { status: parsed.status, headers: NO_STORE },
      )
    }

    const amount = parseCustomerAgreedAmountInrPaise(
      parsed.value && typeof parsed.value === 'object' ? parsed.value : {},
    )
    if (!amount.ok) return validationErrorResponse(amount.errors)

    const requestRow = await getAdminCustomerRequestById(db, requestId, seasonId)
    if (!requestRow) {
      return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
    }

    const result = await patchActiveQuotationCustomerAgreedAmount(
      db,
      requestId,
      amount.acceptedAmountPaise,
      seasonId,
    )
    if (!result.ok) {
      if (result.status === 403) {
        return adminQuotationSeasonForbiddenResponse()
      }
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }

    return Response.json(
      {
        quotation: await quotationJsonForCustomerRequestDetail(
          db,
          requestId,
          result.quotation,
          seasonRole,
          seasonId,
        ),
      },
      { headers: NO_STORE },
    )
  }

  const regenerateMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/quotation\/regenerate\/?$/)
  if (regenerateMatch && method === 'POST') {
    const access = resolveAdminQuotationSeasonAccess(request, false)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

    const requestId = regenerateMatch[1]
    if (!isValidCustomerRequestId(requestId)) {
      return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
    }

    const requestRow = await getAdminCustomerRequestById(db, requestId, seasonId)
    if (!requestRow) {
      return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
    }

    const result = await createOrGetQuotationForRequest(db, requestId, {
      regenerate: true,
      createdByEmail: identity.email,
      seasonId,
    })
    if (!result.ok) {
      if (result.status === 403) {
        return adminQuotationSeasonForbiddenResponse()
      }
      if (result.status === 404) {
        return Response.json({ error: result.code, message: result.message }, { status: 404, headers: NO_STORE })
      }
      if (result.code === 'missing_selling_price' || result.code === 'missing_private_rates') {
        return Response.json(
          {
            error: result.code === 'missing_private_rates' ? 'missing_selling_price' : result.code,
            message: result.message,
            missingProductIds: result.missingProductIds,
          },
          { status: 400, headers: NO_STORE },
        )
      }
      if (result.fields) return validationErrorResponse(result.fields)
      return Response.json(
        { error: result.code ?? 'bad_request', message: result.message ?? 'Quotation failed.' },
        { status: result.status ?? 400, headers: NO_STORE },
      )
    }
    return Response.json(
      {
        quotation: await quotationJsonForCustomerRequestDetail(
          db,
          requestId,
          result.quotation,
          seasonRole,
          seasonId,
        ),
        created: true,
        regenerated: true,
      },
      { status: 201, headers: NO_STORE },
    )
  }

  const quoteDetailMatch = pathname.match(/^\/api\/admin\/quotations\/([^/]+)\/?$/)
  if (quoteDetailMatch && method === 'GET') {
    const access = resolveAdminQuotationSeasonAccess(request, true)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

    const quotationId = quoteDetailMatch[1]
    const inSeason = await quotationBelongsToSeason(db, quotationId, seasonId)
    if (!inSeason) {
      return Response.json({ error: 'not_found', message: 'Quotation not found.' }, { status: 404, headers: NO_STORE })
    }

    const quotation = await getQuotationById(db, quotationId)
    if (!quotation) {
      return Response.json({ error: 'not_found', message: 'Quotation not found.' }, { status: 404, headers: NO_STORE })
    }
    return Response.json(
      { quotation: await filterQuotationForRole(db, quotation, seasonRole) },
      { headers: NO_STORE },
    )
  }

  const orderConfirmMatch = pathname.match(
    /^\/api\/admin\/customer-requests\/([^/]+)\/order-confirmation\/whatsapp\/?$/,
  )
  if (orderConfirmMatch && method === 'GET') {
    const access = resolveAdminQuotationSeasonAccess(request, true)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

    const requestId = orderConfirmMatch[1]
    if (!isValidCustomerRequestId(requestId)) {
      return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
    }
    const payload = await getOrderConfirmationWhatsAppPayload(db, requestId, seasonId)
    if (!payload.ok) {
      if (payload.status === 403) {
        return adminQuotationSeasonForbiddenResponse()
      }
      return Response.json(
        { error: payload.code, message: payload.message },
        { status: payload.status ?? 400, headers: NO_STORE },
      )
    }
    const urlOut = buildWhatsAppSendUrl(payload.message, payload.customerPhone)
    return Response.json(
      jsonWhatsAppPreparePayload(
        {
          message: payload.message,
          whatsAppUrl: urlOut,
          quotationId: payload.quotationId,
          requestId: payload.requestId,
        },
        seasonRole,
      ),
      { headers: NO_STORE },
    )
  }

  const waMatch = pathname.match(/^\/api\/admin\/quotations\/([^/]+)\/whatsapp\/?$/)
  if (waMatch && method === 'GET') {
    const access = resolveAdminQuotationSeasonAccess(request, true)
    if (!access.ok) return access.response
    const { seasonId, seasonRole } = access

    const payload = await getQuotationWhatsAppPayload(db, waMatch[1], seasonId)
    if (!payload.ok) {
      if (payload.status === 403) {
        return adminQuotationSeasonForbiddenResponse()
      }
      return Response.json({ error: payload.code, message: payload.message }, { status: payload.status ?? 404, headers: NO_STORE })
    }
    const urlOut = buildWhatsAppSendUrl(payload.message, payload.customerPhone)
    return Response.json(
      jsonWhatsAppPreparePayload(
        { message: payload.message, whatsAppUrl: urlOut, quotationId: payload.quotationId },
        seasonRole,
      ),
      { headers: NO_STORE },
    )
  }

  return null
}
