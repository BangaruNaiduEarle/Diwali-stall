export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
}

/**
 * @param {Request} request
 * @param {number} [maxBytes]
 */
export async function readJsonBody(request, maxBytes = 65536) {
  const len = Number(request.headers.get('Content-Length') || 0)
  if (len > maxBytes) {
    return { ok: false, status: 413, error: 'payload_too_large', message: 'Request body too large.' }
  }
  const text = await request.text()
  if (text.length > maxBytes) {
    return { ok: false, status: 413, error: 'payload_too_large', message: 'Request body too large.' }
  }
  if (!text.trim()) {
    return { ok: false, status: 400, error: 'invalid_json', message: 'Empty body.' }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, error: 'invalid_json', message: 'Invalid JSON.' }
  }
}

/** @param {Record<string, string>} errors */
export function validationErrorResponse(errors) {
  return Response.json(
    { error: 'validation_error', message: 'Validation failed.', fields: errors },
    { status: 400, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } },
  )
}
