/** These values describe a request; they never authorize or record a payment. */
export function validateRequestPaymentPreferences(body, agreedAmountPaise) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['status', 'mode', 'receivedAmountPaise'].includes(key))) {
    return { ok: false, message: 'Send only payment preference fields.' }
  }
  if (!['paid', 'unpaid', 'partial_paid'].includes(body.status)) {
    return { ok: false, message: 'Choose Paid, Unpaid or Partial Paid.' }
  }
  if (!['online', 'offline'].includes(body.mode)) {
    return { ok: false, message: 'Choose Online or Offline.' }
  }
  const received = body.receivedAmountPaise
  if (body.status === 'partial_paid') {
    if (!Number.isSafeInteger(agreedAmountPaise) || agreedAmountPaise <= 0 ||
        !Number.isSafeInteger(received) || received <= 0 || received >= agreedAmountPaise) {
      return { ok: false, message: 'Received Amount must be greater than zero and less than the saved agreed amount.' }
    }
  } else if (received != null) {
    return { ok: false, message: 'Received Amount is only allowed for Partial Paid.' }
  }
  return { ok: true, data: { status: body.status, mode: body.mode,
    receivedAmountPaise: body.status === 'partial_paid' ? received : null } }
}

export function preferenceAmountToPaise(value) {
  const text = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return NaN
  const [whole, fraction = ''] = text.split('.')
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(paise) ? paise : NaN
}
