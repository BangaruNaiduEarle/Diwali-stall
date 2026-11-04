import { getAdminContext } from '../middleware/requireAdmin.js'
import { requireSeasonMembership, requireWritableSeason } from '../middleware/adminSeasonGuards.js'
import { readJsonBody, JSON_HEADERS } from '../lib/http.js'
import { isValidCustomerRequestId } from '../lib/adminCustomerRequestValidation.js'
import { getRequestPayments, recordRequestPayment } from '../services/adminPayments.js'

const headers = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }

export async function handleAdminPaymentRoutes(request, env) {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)\/payments\/?$/)
  if (!match) return null
  try {
    if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'method_not_allowed' }, { status: 405, headers })
    const access = request.method === 'GET' ? requireSeasonMembership(request) : requireWritableSeason(request)
    if (!access.ok) return Response.json({ error: access.code, message: access.message }, { status: access.status, headers })
    if (!isValidCustomerRequestId(match[1])) return Response.json({ error: 'not_found', message: 'Request not found.' }, { status: 404, headers })
    const options = { seasonId: access.auth.activeSeasonId, context: getAdminContext(request) }
    if (request.method === 'GET') {
      const afterSequence = Number(url.searchParams.get('afterSequence') ?? 0), limit = Number(url.searchParams.get('limit') ?? 50)
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return Response.json({ error: 'validation_error', message: 'Invalid payment history cursor or limit.' }, { status: 400, headers })
      const result = await getRequestPayments(env.DB, match[1], { ...options, afterSequence, limit })
      return Response.json(result, { headers })
    }
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return Response.json({ error: parsed.error, message: parsed.message }, { status: parsed.status, headers })
    const result = await recordRequestPayment(env.DB, match[1], parsed.value, options)
    return Response.json(result, { status: result.ok ? result.idempotentReplay ? 200 : 201 : result.status, headers })
  } catch (error) {
    if (![400, 403, 404, 409, 428, 503].includes(error?.status)) throw error
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers })
  }
}
