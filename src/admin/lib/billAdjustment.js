export function requestRevisionHeaders(revision) {
  return Number.isSafeInteger(revision) && revision >= 0 ? { 'If-Match': String(revision) } : {}
}

export function currentBillRevision(request, quotation) {
  const values = [request?.revision, quotation?.requestRevision].filter(value => Number.isSafeInteger(value) && value >= 0)
  // Independently refreshed quotations must not authorize stale request items.
  return values.length ? Math.min(...values) : null
}

export function rupeesToPaise(value, positive = false) {
  const text = String(value ?? '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const exact = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) return null
  const paise = Number(exact)
  return Number.isSafeInteger(paise) && (positive ? paise > 0 : paise >= 0) ? paise : null
}

export function paiseInputValue(value) {
  if (!Number.isSafeInteger(value) || value < 0) return ''
  const paise = BigInt(value)
  return `${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`
}

export function adjustmentPayload(cart, { privileged = false, discountInr = '', agreedAmountInr = '' } = {}) {
  const items = []
  for (const line of cart) {
    if(line.familyPackId){
      if(String(line.priceInr??'').trim())return {ok:false,message:'Family Pack unit price overrides are unsupported. Use the existing bill discount or agreed amount.'}
      items.push({familyPackId:line.familyPackId,quantity:line.quantity});continue
    }
    const item = { productId: line.productId, quantity: line.quantity, unitType: line.unitType === 'piece' ? 'piece' : 'box' }
    if (privileged && String(line.priceInr ?? '').trim()) {
      const price = rupeesToPaise(line.priceInr, true)
      if (price == null) return { ok: false, message: 'Enter a positive selling price with at most two decimal places.' }
      item.unitRatePaise = price
    }
    items.push(item)
  }
  const body = { items }
  if (privileged && String(discountInr).trim()) {
    const discount = rupeesToPaise(discountInr)
    if (discount == null) return { ok: false, message: 'Enter a non-negative discount with at most two decimal places.' }
    body.discountPaise = discount
  }
  if (privileged && String(agreedAmountInr).trim()) body.acceptedAmountInr = String(agreedAmountInr).trim()
  return { ok: true, body }
}

export function draftHasNewerRevision(draftRevision, latestRevision, dirty) {
  return dirty && Number.isSafeInteger(latestRevision) && latestRevision !== draftRevision
}

export function checkoutHandoverFields(locationModeEnabled, assigneeUserId) {
  const id = String(assigneeUserId ?? '').trim()
  return locationModeEnabled && id ? { assigneeUserId: id } : {}
}
