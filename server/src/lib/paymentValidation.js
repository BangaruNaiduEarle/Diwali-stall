export const PAYMENT_METHODS = Object.freeze(['CASH', 'UPI', 'CARD', 'BANK', 'OTHER'])
export const RECORDING_MODES = Object.freeze(['ONLINE', 'OFFLINE'])
export const PAYMENT_ENTRY_TYPES = Object.freeze(['PAYMENT', 'HOLD', 'RELEASE_HOLD'])

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null
  const date = new Date(value), calendar = new Date(value.slice(0, 10) + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null
  return date.toISOString()
}

export function validatePaymentBody(body, transport = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { _body: 'JSON object required.' } }
  const allowed = new Set(['operationId', 'entryType', 'amountPaise', 'recordingMode', 'paymentMethod', 'reference', 'details', 'occurredAt'])
  const errors = {}
  for (const key of Object.keys(body)) if (!allowed.has(key)) errors[key] = 'Unsupported payment field.'
  const entryType = body.entryType ?? 'PAYMENT'
  if (!PAYMENT_ENTRY_TYPES.includes(entryType)) errors.entryType = 'Invalid ledger entry type.'
  if (typeof body.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(body.operationId)) errors.operationId = 'A unique operation ID (8–128 safe characters) is required.'
  if (!RECORDING_MODES.includes(body.recordingMode)) errors.recordingMode = 'Choose ONLINE or OFFLINE recording mode.'
  if (!Number.isSafeInteger(body.amountPaise) || (entryType === 'PAYMENT' ? body.amountPaise <= 0 : body.amountPaise !== 0)) errors.amountPaise = entryType === 'PAYMENT' ? 'Amount must be positive integer paise.' : 'Hold actions must have zero amount.'
  if (entryType === 'PAYMENT' && !PAYMENT_METHODS.includes(body.paymentMethod)) errors.paymentMethod = 'Choose a supported payment method.'
  const reference = typeof body.reference === 'string' ? body.reference.trim() || null : null
  if (body.reference != null && (typeof body.reference !== 'string' || body.reference.length > 200 || (reference && !/^[\x20-\x7e]+$/.test(reference)))) errors.reference = 'Reference must be at most 200 printable ASCII characters.'
  if (entryType === 'PAYMENT' && ['UPI', 'CARD', 'BANK'].includes(body.paymentMethod) && !reference) errors.reference = 'Transaction reference is required for this method.'
  if (entryType !== 'PAYMENT' && (body.paymentMethod != null || reference)) errors.paymentMethod = 'Hold actions do not have a payment method or transaction reference.'
  const details = typeof body.details === 'string' ? body.details.trim() || null : null
  if (body.details != null && (typeof body.details !== 'string' || body.details.length > 500)) errors.details = 'Details must be at most 500 characters.'
  const suppliedTime = body.occurredAt ?? transport.occurredAt ?? null
  const occurredAt = suppliedTime == null ? null : timestamp(suppliedTime)
  if (suppliedTime != null && occurredAt == null) errors.occurredAt = 'Use a valid ISO-8601 occurrence timestamp.'
  if (body.occurredAt != null && transport.occurredAt != null && occurredAt !== timestamp(transport.occurredAt)) errors.occurredAt = 'Body and device occurrence timestamps must agree.'
  if (body.recordingMode === 'OFFLINE' && occurredAt == null) errors.occurredAt = 'Occurrence time is required for an OFFLINE record.'
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, data: {
    operationId: body.operationId, entryType, amountPaise: body.amountPaise, recordingMode: body.recordingMode,
    paymentMethod: entryType === 'PAYMENT' ? body.paymentMethod : null, reference,
    normalizedReference: reference?.replaceAll(' ', '').toUpperCase() ?? null, details, occurredAt,
  } }
}

export async function paymentFingerprint(data, actorUserId, deviceId) {
  const bytes = new TextEncoder().encode(JSON.stringify([actorUserId, deviceId, data.entryType, data.amountPaise, data.recordingMode, data.paymentMethod, data.normalizedReference, data.details, data.occurredAt]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}
