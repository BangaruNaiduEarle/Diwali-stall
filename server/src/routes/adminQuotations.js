import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import { buildWhatsAppSendUrl } from '../lib/quotationWhatsApp.js'
import { isValidCustomerRequestId } from '../lib/adminCustomerRequestValidation.js'
import {
  createOrGetQuotationForRequest,
  getActiveQuotationForRequest,
  getQuotationById,
  getQuotationWhatsAppPayload,
} from '../services/adminQuotations.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

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
      return Response.json({ quotation }, { headers: NO_STORE })
    }

    if (method === 'POST') {
      const result = await createOrGetQuotationForRequest(db, requestId, {
        createdByEmail: identity.email,
      })
      if (!result.ok) {
        if (result.status === 404) {
          return Response.json({ error: result.code, message: result.message }, { status: 404, headers: NO_STORE })
        }
        if (result.code === 'missing_private_rates') {
          return Response.json(
            {
              error: result.code,
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
        { quotation: result.quotation, created: result.created, regenerated: false },
        { status, headers: NO_STORE },
      )
    }
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
      if (result.code === 'missing_private_rates') {
        return Response.json(
          { error: result.code, message: result.message, missingProductIds: result.missingProductIds },
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
      { quotation: result.quotation, created: true, regenerated: true },
      { status: 201, headers: NO_STORE },
    )
  }

  const quoteDetailMatch = pathname.match(/^\/api\/admin\/quotations\/([^/]+)\/?$/)
  if (quoteDetailMatch && method === 'GET') {
    const quotation = await getQuotationById(db, quoteDetailMatch[1])
    if (!quotation) {
      return Response.json({ error: 'not_found', message: 'Quotation not found.' }, { status: 404, headers: NO_STORE })
    }
    return Response.json({ quotation }, { headers: NO_STORE })
  }

  const waMatch = pathname.match(/^\/api\/admin\/quotations\/([^/]+)\/whatsapp\/?$/)
  if (waMatch && method === 'GET') {
    const payload = await getQuotationWhatsAppPayload(db, waMatch[1])
    if (!payload.ok) {
      return Response.json({ error: payload.code, message: payload.message }, { status: payload.status ?? 404, headers: NO_STORE })
    }
    const urlOut = buildWhatsAppSendUrl(payload.message, payload.customerPhone)
    return Response.json(
      { message: payload.message, whatsAppUrl: urlOut, quotationId: payload.quotationId },
      { headers: NO_STORE },
    )
  }

  return null
}
