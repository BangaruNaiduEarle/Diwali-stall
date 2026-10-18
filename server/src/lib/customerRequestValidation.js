import { isValidProductId } from './validation.js'

export const CUSTOMER_REQUEST_LIMITS = {
  maxItems: 50,
  maxQuantity: 99,
  minQuantity: 1,
  nameMin: 2,
  nameMax: 80,
  phoneDigits: 10,
  areaMax: 120,
  pickupMax: 40,
  noteMax: 300,
  idempotencyKeyMax: 128,
}

const FORBIDDEN_BODY_KEYS = new Set([
  'unitRatePaise',
  'unit_rate_paise',
  'price',
  'x4',
  'total',
  'subtotal',
  'quotationTotal',
  'quotation_total',
  'lineTotal',
  'line_total',
  'amount',
  'currency',
])

const FORBIDDEN_ITEM_KEYS = new Set([
  'unitRatePaise',
  'unit_rate_paise',
  'price',
  'x4',
  'lineTotal',
  'line_total',
  'productName',
  'name',
  'total',
])

function phoneDigits(mobile) {
  return String(mobile ?? '').replace(/\D/g, '')
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, data: NormalizedCustomerRequest } | { ok: false, errors: Record<string, string> }}
 */
export function validateCustomerRequestBody(body) {
  const errors = {}

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }

  const raw = /** @type {Record<string, unknown>} */ (body)

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_BODY_KEYS.has(key)) {
      errors[key] = 'Price and quotation fields are not accepted.'
    }
  }

  const customerRaw = raw.customer
  if (!customerRaw || typeof customerRaw !== 'object' || Array.isArray(customerRaw)) {
    errors.customer = 'Customer details object required.'
  }

  const itemsRaw = raw.items
  if (!Array.isArray(itemsRaw)) {
    errors.items = 'Items array required.'
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors }
  }

  const customerObj = /** @type {Record<string, unknown>} */ (customerRaw)
  const name = String(customerObj.name ?? '').trim()
  if (!name) {
    errors['customer.name'] = 'Name is required.'
  } else if (name.length < CUSTOMER_REQUEST_LIMITS.nameMin) {
    errors['customer.name'] = 'Name is too short.'
  } else if (name.length > CUSTOMER_REQUEST_LIMITS.nameMax) {
    errors['customer.name'] = 'Name is too long.'
  }

  const digits = phoneDigits(customerObj.mobile ?? customerObj.phone)
  if (!digits) {
    errors['customer.mobile'] = 'Mobile number is required.'
  } else if (digits.length !== CUSTOMER_REQUEST_LIMITS.phoneDigits) {
    errors['customer.mobile'] = 'Enter a valid 10-digit mobile number.'
  }

  const area = String(customerObj.area ?? '').trim()
  if (area.length > CUSTOMER_REQUEST_LIMITS.areaMax) {
    errors['customer.area'] = 'Area is too long.'
  }

  const pickupPreference = String(customerObj.pickupDate ?? customerObj.pickupPreference ?? '').trim()
  if (pickupPreference.length > CUSTOMER_REQUEST_LIMITS.pickupMax) {
    errors['customer.pickupDate'] = 'Pickup preference is too long.'
  }

  const note = String(customerObj.note ?? '').trim()
  if (note.length > CUSTOMER_REQUEST_LIMITS.noteMax) {
    errors['customer.note'] = 'Note is too long.'
  }

  /** @type {NormalizedLineItem[]} */
  const items = []
  if (Array.isArray(itemsRaw)) {
    if (itemsRaw.length === 0) {
      errors.items = 'At least one item is required.'
    } else if (itemsRaw.length > CUSTOMER_REQUEST_LIMITS.maxItems) {
      errors.items = `Too many items (max ${CUSTOMER_REQUEST_LIMITS.maxItems}).`
    } else {
      const seen = new Set()
      itemsRaw.forEach((entry, index) => {
        const prefix = `items[${index}]`
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errors[prefix] = 'Item must be an object.'
          return
        }
        const item = /** @type {Record<string, unknown>} */ (entry)
        for (const key of Object.keys(item)) {
          if (FORBIDDEN_ITEM_KEYS.has(key)) {
            errors[`${prefix}.${key}`] = 'Price fields are not accepted on items.'
          }
        }
        const productId = String(item.productId ?? item.product_id ?? '').trim()
        if (!isValidProductId(productId)) {
          errors[`${prefix}.productId`] = 'Invalid product id.'
          return
        }
        if (seen.has(productId)) {
          errors[`${prefix}.productId`] = 'Duplicate product id in request.'
          return
        }
        seen.add(productId)

        const quantity = Number(item.quantity)
        if (!Number.isInteger(quantity)) {
          errors[`${prefix}.quantity`] = 'Quantity must be a whole number.'
        } else if (quantity < CUSTOMER_REQUEST_LIMITS.minQuantity || quantity > CUSTOMER_REQUEST_LIMITS.maxQuantity) {
          errors[`${prefix}.quantity`] = `Quantity must be between ${CUSTOMER_REQUEST_LIMITS.minQuantity} and ${CUSTOMER_REQUEST_LIMITS.maxQuantity}.`
        } else {
          items.push({ productId, quantity })
        }
      })
    }
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    data: {
      customer: {
        name,
        mobile: digits,
        area,
        pickupPreference,
        note,
      },
      items,
    },
  }
}

/**
 * @param {string | null | undefined} key
 */
export function normalizeIdempotencyKey(key) {
  const trimmed = String(key ?? '').trim()
  if (!trimmed) return null
  if (trimmed.length > CUSTOMER_REQUEST_LIMITS.idempotencyKeyMax) return null
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null
  return trimmed
}
