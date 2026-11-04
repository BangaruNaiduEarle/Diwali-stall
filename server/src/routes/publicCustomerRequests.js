import { readJsonBody, validationErrorResponse, JSON_HEADERS } from '../lib/http.js'
import {
  normalizeIdempotencyKey,
  validateCustomerRequestBody,
} from '../lib/customerRequestValidation.js'
import {
  createPublicCustomerRequest,
  deriveRequestIdFromIdempotencyKey,
  ensurePublicReferenceOnRequest,
  getPublicRequestSummary,
} from '../services/publicCustomerRequests.js'
import { preparePublicCustomerRequestWriter } from '../services/publicCustomerRequestContext.js'

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

  const writer = await preparePublicCustomerRequestWriter(env.DB, env)
  if (!writer.ok) {
    return Response.json(
      { error: writer.error, message: writer.message },
      { status: writer.status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
    )
  }
  const db = writer.db

  let requestId = crypto.randomUUID()
  let idempotentReplay = false

  if (idempotencyHeader) {
    const key = writer.scope
      ? JSON.stringify([writer.scope.businessId, writer.scope.locationId, writer.scope.seasonId, idempotencyHeader])
      : idempotencyHeader
    requestId = await deriveRequestIdFromIdempotencyKey(key)
    const existing = await getPublicRequestSummary(db, requestId)
    if (existing) {
      const ensured = await ensurePublicReferenceOnRequest(db, requestId)
      if (ensured && typeof ensured === 'object' && 'ok' in ensured && ensured.ok === false) {
        return Response.json(
          { error: ensured.error ?? 'server_error', message: ensured.message ?? 'Request failed.' },
          { status: ensured.status ?? 500, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
        )
      }
      return Response.json(
        { request: ensured ?? existing, idempotentReplay: true },
        { status: 200, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
      )
    }
    idempotentReplay = false
  }

  const result = await createPublicCustomerRequest(db, validated.data, {
    requestId,
    idempotentReplay,
  }, env)

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
