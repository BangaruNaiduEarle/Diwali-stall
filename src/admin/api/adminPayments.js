import { apiRequest } from './client.js'
import { requestRevisionHeaders } from '../lib/billAdjustment.js'
import { paymentBrowserDeviceId } from '../lib/payments.js'

export async function fetchRequestPayments(requestId, { afterSequence = 0, limit = 50 } = {}) {
  const query = new URLSearchParams({ afterSequence: String(afterSequence), limit: String(limit) })
  const result = await apiRequest(`/api/admin/customer-requests/${encodeURIComponent(requestId)}/payments?${query}`)
  return result.ok ? { ...result.data, ok: true } : result
}

export async function recordRequestPayment(requestId, body, { revision, deviceId = paymentBrowserDeviceId() } = {}) {
  const result = await apiRequest(`/api/admin/customer-requests/${encodeURIComponent(requestId)}/payments`, {
    method: 'POST', headers: { ...requestRevisionHeaders(revision), 'X-Device-Id': deviceId }, body: JSON.stringify(body),
  })
  return result.ok ? { ...result.data, ok: true } : result
}
