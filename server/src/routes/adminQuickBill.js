import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import {
  validateQuickBillCheckoutBody,
  validateQuickBillPreviewBody,
} from '../lib/quickBillValidation.js'
import { canViewSensitiveProductPricing, normalizeAdminRole } from '../lib/adminRoles.js'
import { filterQuotationForRole } from '../lib/adminQuotationResponse.js'
import { filterQuickBillPreviewForRole } from '../lib/quickBillBargain.js'
import { checkoutQuickBill, previewQuickBill } from '../services/adminQuickBill.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {{ email?: string }} identity
 * @returns {Promise<Response | null>}
 */
export async function handleAdminQuickBillRoutes(request, env, identity) {
  const { pathname } = new URL(request.url)
  const method = request.method
  const db = env.DB

  if (pathname === '/api/admin/quick-bill/preview' && method === 'POST') {
    const parsedBody = await readJsonBody(request)
    if (!parsedBody.ok) {
      return Response.json(
        { error: parsedBody.error, message: parsedBody.message },
        { status: 400, headers: NO_STORE },
      )
    }

    const adminRole = normalizeAdminRole(identity.role)
    const validated = validateQuickBillPreviewBody(parsedBody.value, adminRole)
    if (!validated.ok) {
      if (validated.errors) {
        return validationErrorResponse(validated.errors)
      }
      return Response.json(
        { error: validated.code ?? 'forbidden', message: validated.message ?? 'Not allowed.' },
        { status: validated.status ?? 403, headers: NO_STORE },
      )
    }

    const result = await previewQuickBill(db, validated.data.items, {
      pricingMode: validated.data.pricingMode,
    })
    if (!result.ok) {
      const status = result.status ?? 400
      return Response.json(
        {
          error: result.code ?? result.error ?? 'preview_failed',
          message: result.message ?? 'Could not preview bill.',
          fields: result.fields,
          missingProductIds: result.missingProductIds,
        },
        { status, headers: NO_STORE },
      )
    }

    return Response.json(
      { preview: filterQuickBillPreviewForRole(result.preview, adminRole) },
      { headers: NO_STORE },
    )
  }

  if (pathname === '/api/admin/quick-bill/checkout' && method === 'POST') {
    const parsedBody = await readJsonBody(request)
    if (!parsedBody.ok) {
      return Response.json(
        { error: parsedBody.error, message: parsedBody.message },
        { status: 400, headers: NO_STORE },
      )
    }

    const adminRole = normalizeAdminRole(identity.role)
    const validated = validateQuickBillCheckoutBody(parsedBody.value, adminRole)
    if (!validated.ok) {
      if (validated.errors) {
        return validationErrorResponse(validated.errors)
      }
      return Response.json(
        { error: validated.code ?? 'forbidden', message: validated.message ?? 'Not allowed.' },
        { status: validated.status ?? 403, headers: NO_STORE },
      )
    }

    const result = await checkoutQuickBill(db, validated.data, {
      createdByEmail: identity.email ?? null,
      adminRole,
      pricingMode: validated.data.pricingMode,
      acceptedAmountPaise: validated.data.acceptedAmountPaise,
    })
    if (!result.ok) {
      const status = result.status ?? 400
      return Response.json(
        {
          error: result.code ?? result.error ?? 'checkout_failed',
          message: result.message ?? 'Could not complete quick bill.',
          fields: result.fields,
          missingProductIds: result.missingProductIds,
          request: result.request ?? undefined,
          requestId: result.requestId ?? undefined,
        },
        { status, headers: NO_STORE },
      )
    }

    return Response.json(
      {
        request: result.request,
        quotation: await filterQuotationForRole(db, result.quotation, adminRole),
        quotationCreated: result.quotationCreated,
        warnings: canViewSensitiveProductPricing(adminRole) ? result.warnings : undefined,
      },
      { status: 201, headers: NO_STORE },
    )
  }

  return null
}
