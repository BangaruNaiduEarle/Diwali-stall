/**
 * Liveness/readiness stub — does not query D1 or expose private data.
 */

const SERVICE_NAME = 'diwali-api'

/**
 * @param {Request} _request
 * @param {Record<string, unknown>} _env
 */
export function handleHealth(_request, _env) {
  return jsonHealth({ ok: true, service: SERVICE_NAME, phase: '2b' })
}

/** @param {{ ok: boolean, service: string, phase: number }} body */
export function jsonHealth(body) {
  return Response.json(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}
