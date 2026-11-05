// Endpoint-specific wall-time spans. Never include SQL, IDs or customer data.
const timings = new WeakMap()

export async function measureCustomerRequestList(request, name, work) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/api/admin/customer-requests') return work()
  let spans = timings.get(request)
  if (!spans) { spans = new Map(); timings.set(request, spans) }
  const start = performance.now()
  try { return await work() }
  finally { spans.set(name, (spans.get(name) ?? 0) + performance.now() - start) }
}

export function customerRequestListTimingHeaders(request) {
  const spans = timings.get(request)
  return spans ? { 'Server-Timing': [...spans].map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`).join(', ') } : {}
}
