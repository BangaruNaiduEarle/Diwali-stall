import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import { buildWhatsAppSendUrl } from '../lib/quotationWhatsApp.js'
import { isValidCustomerRequestId } from '../lib/adminCustomerRequestValidation.js'
import { parseCustomerAgreedAmountInrPaise } from '../lib/quickBillBargain.js'
import { canViewSensitiveProductPricing, normalizeAdminRole } from '../lib/adminRoles.js'
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

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {Record<string, unknown>} quotation
 * @param {unknown} adminRole
 */
async function quotationJsonForCustomerRequestDetail(db, requestId, quotation, adminRole) {
  const request = await getAdminCustomerRequestById(db, requestId)
  return filterQuotationForCustomerRequestDetail(db, quotation, adminRole, request)
}

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/**
 * WhatsApp prepare responses are customer-facing only (catalogue selling totals).
 * Restricted admins receive the same safe payload — no audit or internal rate fields.
 *
 * @param {Record<string, unknown>} payload
 * @param {unknown} adminRole
 */
function jsonWhatsAppPreparePayload(payload, adminRole) {
  if (canViewSensitiveProductPricing(adminRole)) {
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
  const { pathname } = url
  const method = request.method
  const db = env.DB
  const adminRole = normalizeAdminRole(identity.role)

  const requestQuoteMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/quotation\/?$/)
  if (requestQuoteMatch) {
    const requestId = requestQuoteMatch[1]
    if (!isValidCustomerRequestId(requestId)) {
      return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
    }

    if (method === 'GET') {
      const quotation = await getActiveQuotationForRequest(db, requestId)
      if (!quotation) {
        return Response.json({ error: 'not_found', message: 'No quotation for this request.' }, { status: 404, headers: NO_STORE })
      }
      return Response.json(
        { quotation: await quotationJsonForCustomerRequestDetail(db, requestId, quotation, adminRole) },
        { headers: NO_STORE },
      )
    }

    if (method === 'POST') {
      const result = await createOrGetQuotationForRequest(db, requestId, {
        createdByEmail: identity.email,
      })
      if (!result.ok) {
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
          quotation: await quotationJsonForCustomerRequestDetail(db, requestId, result.quotation, adminRole),
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
    if (!canViewSensitiveProductPricing(adminRole)) {
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

    const result = await patchActiveQuotationCustomerAgreedAmount(
      db,
      requestId,
      amount.acceptedAmountPaise,
    )
    if (!result.ok) {
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
          adminRole,
        ),
      },
      { headers: NO_STORE },
    )
  }

  const regenerateMatch = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/quotation\/regenerate\/?$/)
  if (regenerateMatch && method === 'POST') {
    const requestId = regenerateMatch[1]
    if (!isValidCustomerRequestId(requestId)) {
      return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
    }
    const result = await createOrGetQuotationForRequest(db, requestId, {
      regenerate: true,
      createdByEmail: identity.email,
    })
    if (!result.ok) {
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
        quotation: await quotationJsonForCustomerRequestDetail(db, requestId, result.quotation, adminRole),
        created: true,
        regenerated: true,
      },
      { status: 201, headers: NO_STORE },
    )
  }

  const quoteDetailMatch = pathname.match(/^\/api\/admin\/quotations\/([^/]+)\/?$/)
  if (quoteDetailMatch && method === 'GET') {
    const quotation = await getQuotationById(db, quoteDetailMatch[1])
    if (!quotation) {
      return Response.json({ error: 'not_found', message: 'Quotation not found.' }, { status: 404, headers: NO_STORE })
    }
    return Response.json(
      { quotation: await filterQuotationForRole(db, quotation, adminRole) },
      { headers: NO_STORE },
    )
  }

  const orderConfirmMatch = pathname.match(
    /^\/api\/admin\/customer-requests\/([^/]+)\/order-confirmation\/whatsapp\/?$/,
  )
  if (orderConfirmMatch && method === 'GET') {
    const requestId = orderConfirmMatch[1]
    if (!isValidCustomerRequestId(requestId)) {
      return Response.json({ error: 'not_found', message: 'Customer request not found.' }, { status: 404, headers: NO_STORE })
    }
    const payload = await getOrderConfirmationWhatsAppPayload(db, requestId)
    if (!payload.ok) {
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
        adminRole,
      ),
      { headers: NO_STORE },
    )
  }

  const waMatch = pathname.match(/^\/api\/admin\/quotations\/([^/]+)\/whatsapp\/?$/)
  if (waMatch && method === 'GET') {
    const payload = await getQuotationWhatsAppPayload(db, waMatch[1])
    if (!payload.ok) {
      return Response.json({ error: payload.code, message: payload.message }, { status: payload.status ?? 404, headers: NO_STORE })
    }
    const urlOut = buildWhatsAppSendUrl(payload.message, payload.customerPhone)
    return Response.json(
      jsonWhatsAppPreparePayload(
        { message: payload.message, whatsAppUrl: urlOut, quotationId: payload.quotationId },
        adminRole,
      ),
      { headers: NO_STORE },
    )
  }

  return null
}
