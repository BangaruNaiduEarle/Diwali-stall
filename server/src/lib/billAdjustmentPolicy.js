import { canViewSensitiveProductPricing } from './adminRoles.js'

export const billLineKey = line => `${line.productId ?? line.product_id ?? ''}|${line.unitType ?? line.unit_type ?? (String(line.productName ?? line.product_name).endsWith(' (loose pc)') ? 'piece' : 'box')}`

/** Strict allowlists prevent financial fields/aliases from being silently accepted. */
export function parseBillAdjustmentFields(body, role) {
  const privileged = canViewSensitiveProductPricing(role)
  const allowed = new Set(['items', 'acceptedAmountInr', 'accepted_amount_inr', 'discountPaise'])
  const errors = {}, overrides = []
  for (const key of Object.keys(body)) if (!allowed.has(key)) errors[key] = 'Unsupported adjustment field.'
  if (!privileged && Object.keys(body).some(key => key !== 'items')) return { ok: false, status: 403, code: 'forbidden', message: 'Only Owner or Super Admin can change financial amounts.' }
  const items = Array.isArray(body.items) ? body.items.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return line
    for (const key of Object.keys(line)) if (!['productId', 'quantity', 'unitType', 'unitRatePaise'].includes(key)) errors[`items[${index}].${key}`] = 'Unsupported item field.'
    if (Object.hasOwn(line, 'unitRatePaise')) {
      if (!privileged) return { forbiddenPrice: true }
      if (!Number.isSafeInteger(line.unitRatePaise) || line.unitRatePaise <= 0) errors[`items[${index}].unitRatePaise`] = 'Selling price must be positive integer paise.'
      overrides.push({ productId: line.productId, unitType: line.unitType === 'piece' ? 'piece' : 'box', unitRatePaise: line.unitRatePaise })
    }
    return { productId: line.productId, quantity: line.quantity, unitType: line.unitType }
  }) : body.items
  if (Array.isArray(items) && items.some(item => item?.forbiddenPrice)) return { ok: false, status: 403, code: 'forbidden', message: 'Only Owner or Super Admin can change selling prices.' }
  if (Object.hasOwn(body, 'discountPaise') && (!Number.isSafeInteger(body.discountPaise) || body.discountPaise < 0)) errors.discountPaise = 'Discount must be non-negative integer paise.'
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, items, overrides, discountProvided: Object.hasOwn(body, 'discountPaise'), discountPaise: body.discountPaise }
}

/** Reference only. This amount is never an input to the payable total. */
export function bargainingReference(finalSubtotalPaise) {
  return Number.isSafeInteger(finalSubtotalPaise) && finalSubtotalPaise >= 0 && Number.isSafeInteger(finalSubtotalPaise + 50000) ? finalSubtotalPaise + 50000 : null
}
