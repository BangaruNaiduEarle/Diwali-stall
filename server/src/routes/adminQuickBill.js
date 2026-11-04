import { customerRequestDb } from '../lib/adminCustomerRequestScope.js'
import { adminServiceMode } from '../lib/adminServiceMode.js'
import { getAdminContext } from '../middleware/requireAdmin.js'
import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import {
  validateQuickBillCheckoutBody,
  validateQuickBillPreviewBody,
} from '../lib/quickBillValidation.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { filterQuotationForRole } from '../lib/adminQuotationResponse.js'
import { filterQuickBillPreviewForRole } from '../lib/quickBillBargain.js'
import { checkoutQuickBill, previewQuickBill } from '../services/adminQuickBill.js'
import { requireWritableSeason } from '../middleware/adminSeasonGuards.js'

const NO_STORE = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

/** @param {{ ok: false, status: number, code: string, message: string }} guard */
function quickBillGuardForbiddenResponse(guard) {
  return Response.json(
    { error: guard.code, message: guard.message },
    { status: guard.status, headers: NO_STORE },
  )
}

/**
 * @param {Request} request
 * @param {{ DB: D1Database }} env
 * @param {{ email?: string }} identity
 * @returns {Promise<Response | null>}
 */
export async function handleAdminQuickBillRoutes(request, env, identity) {
  try {
    return await handleScopedAdminQuickBillRoutes(request, env, identity)
  } catch (error) {
    if (!['request_ownership_mismatch', 'forbidden', 'revision_conflict'].includes(error?.code)) throw error
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: NO_STORE })
  }
}

async function handleScopedAdminQuickBillRoutes(request, env, identity) {
  const { pathname } = new URL(request.url)
  const method = request.method
  let db = env.DB
  const context = getAdminContext(request)
  if (adminServiceMode(db) === true || context?.locationModeEnabled) {
    if (!['/api/admin/quick-bill/preview', '/api/admin/quick-bill/checkout'].includes(pathname)) return null
    const access = requireWritableSeason(request)
    if (!access.ok) return quickBillGuardForbiddenResponse(access)
    db = customerRequestDb(db, access.auth.activeSeasonId, context, true)
  }

  if (pathname === '/api/admin/quick-bill/preview' && method === 'POST') {
    const access = requireWritableSeason(request)
    if (!access.ok) {
      return quickBillGuardForbiddenResponse(access)
    }
    const { activeSeasonId: seasonId, seasonRole } = access.auth

    const parsedBody = await readJsonBody(request)
    if (!parsedBody.ok) {
      return Response.json(
        { error: parsedBody.error, message: parsedBody.message },
        { status: 400, headers: NO_STORE },
      )
    }

    const validated = validateQuickBillPreviewBody(parsedBody.value, seasonRole)
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
      seasonId,
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
      { preview: filterQuickBillPreviewForRole(result.preview, seasonRole) },
      { headers: NO_STORE },
    )
  }

  if (pathname === '/api/admin/quick-bill/checkout' && method === 'POST') {
    const access = requireWritableSeason(request)
    if (!access.ok) {
      return quickBillGuardForbiddenResponse(access)
    }
    const { activeSeasonId: seasonId, seasonRole } = access.auth

    const parsedBody = await readJsonBody(request)
    if (!parsedBody.ok) {
      return Response.json(
        { error: parsedBody.error, message: parsedBody.message },
        { status: 400, headers: NO_STORE },
      )
    }

    const validated = validateQuickBillCheckoutBody(parsedBody.value, seasonRole)
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
      adminRole: seasonRole,
      pricingMode: validated.data.pricingMode,
      acceptedAmountPaise: validated.data.acceptedAmountPaise,
      seasonId,
      idempotencyKey: request.headers.get('Idempotency-Key'),
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
        quotation: await filterQuotationForRole(db, result.quotation, seasonRole, seasonId),
        quotationCreated: result.quotationCreated,
        idempotentReplay: result.idempotentReplay,
        warnings: canViewSensitiveProductPricing(seasonRole) ? result.warnings : undefined,
      },
      { status: 201, headers: NO_STORE },
    )
  }

  return null
}
