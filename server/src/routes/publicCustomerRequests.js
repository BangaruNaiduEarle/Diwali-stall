import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import {
  normalizeIdempotencyKey,
  validateCustomerRequestBody,
} from '../lib/customerRequestValidation.js'
import {
  createPublicCustomerRequest,
  deriveRequestIdFromIdempotencyKey,
  getPublicRequestSummary,
} from '../services/publicCustomerRequests.js'

const MAX_BODY_BYTES = 32768

/**
 * @param {Request} request
 * @param {{ DB?: D1Database }} env
 */
export async function handlePublicCustomerRequestPost(request, env) {
  if (!env.DB) {
    return Response.json(
      { error: 'database_unavailable', message: 'Database binding is not available.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (request.method !== 'POST') {
    return Response.json(
      { error: 'method_not_allowed', message: 'Method not allowed.' },
      { status: 405, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const parsed = await readJsonBody(request, MAX_BODY_BYTES)
  if (!parsed.ok) {
    return Response.json(
      { error: parsed.error, message: parsed.message },
      { status: parsed.status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
    )
  }

  const validated = validateCustomerRequestBody(parsed.value)
  if (!validated.ok) {
    return validationErrorResponse(validated.errors)
  }

  const idempotencyHeader = normalizeIdempotencyKey(request.headers.get('Idempotency-Key'))
  if (request.headers.get('Idempotency-Key') && !idempotencyHeader) {
    return validationErrorResponse({ 'Idempotency-Key': 'Invalid idempotency key format.' })
  }

  let requestId = crypto.randomUUID()
  let idempotentReplay = false

  if (idempotencyHeader) {
    requestId = await deriveRequestIdFromIdempotencyKey(idempotencyHeader)
    const existing = await getPublicRequestSummary(env.DB, requestId)
    if (existing) {
      return Response.json(
        { request: existing, idempotentReplay: true },
        { status: 200, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
      )
    }
    idempotentReplay = false
  }

  const result = await createPublicCustomerRequest(env.DB, validated.data, {
    requestId,
    idempotentReplay,
  })

  if (!result.ok) {
    if (result.error === 'validation_error' && result.fields) {
      return validationErrorResponse(result.fields)
    }
    return Response.json(
      { error: result.error ?? 'server_error', message: result.message ?? 'Request failed.' },
      { status: result.status ?? 500, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
    )
  }

  const status = result.idempotentReplay ? 200 : 201
  return Response.json(
    { request: result.request, idempotentReplay: Boolean(result.idempotentReplay) },
    { status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
  )
}
