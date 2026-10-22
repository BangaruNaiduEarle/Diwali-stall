const PRODUCT_ID_RE = /^P\d{3,}$/
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_ITEM_QUANTITY = 9999

/** @param {string} id */
export function isValidAdminProductId(id) {
  return PRODUCT_ID_RE.test(String(id ?? '').trim())
}

/** @param {string} raw */
export function normalizeAdminProductIdInput(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''
  const upper = trimmed.toUpperCase()
  if (/^P\d+$/.test(upper)) return upper
  return trimmed
}

/**
 * Minimal validation to create a draft pack for image upload (name + selling price only).
 * @param {{ name: string, slug: string, sellingPriceInr: string, sortOrder: string }} values
 * @returns {{ ok: true } | { ok: false, fields: Record<string, string> }}
 */
export function validateFamilyPackFormValuesForUploadDraft(values) {
  /** @type {Record<string, string>} */
  const fields = {}

  const name = String(values.name ?? '').trim()
  if (!name) fields.name = 'Pack name is required.'

  const slug = String(values.slug ?? '').trim()
  if (slug && !SLUG_RE.test(slug)) {
    fields.slug = 'Slug must be lowercase letters, numbers, and hyphens.'
  }

  const priceRaw = String(values.sellingPriceInr ?? '').trim()
  if (!priceRaw) {
    fields.sellingPriceInr = 'Selling price is required.'
  } else {
    const n = Number(priceRaw)
    if (!Number.isFinite(n) || n <= 0) {
      fields.sellingPriceInr = 'Selling price must be greater than zero.'
    }
  }

  const sortRaw = String(values.sortOrder ?? '').trim()
  if (sortRaw !== '') {
    const sortN = Number(sortRaw)
    if (!Number.isInteger(sortN)) fields.sortOrder = 'Display order must be a whole number.'
  }

  if (Object.keys(fields).length) return { ok: false, fields }
  return { ok: true }
}

/**
 * Client-side validation before save (mirrors server family pack rules where practical).
 * @param {{ name: string, slug: string, sellingPriceInr: string, sortOrder: string, items: { productId: string, quantity: string, unitLabel: string }[] }} values
 * @param {{ isCreate?: boolean }} [opts]
 * @returns {{ ok: true } | { ok: false, fields: Record<string, string> }}
 */
export function validateFamilyPackFormValues(values, opts = {}) {
  const isCreate = opts.isCreate === true
  /** @type {Record<string, string>} */
  const fields = {}

  const name = String(values.name ?? '').trim()
  if (!name) fields.name = 'Pack name is required.'

  const slug = String(values.slug ?? '').trim()
  if (slug && !SLUG_RE.test(slug)) {
    fields.slug = 'Slug must be lowercase letters, numbers, and hyphens.'
  }

  const priceRaw = String(values.sellingPriceInr ?? '').trim()
  if (!priceRaw) {
    if (isCreate) fields.sellingPriceInr = 'Selling price is required.'
  } else {
    const n = Number(priceRaw)
    if (!Number.isFinite(n) || n <= 0) {
      fields.sellingPriceInr = 'Selling price must be greater than zero.'
    }
  }

  const sortRaw = String(values.sortOrder ?? '').trim()
  if (sortRaw !== '') {
    const sortN = Number(sortRaw)
    if (!Number.isInteger(sortN)) fields.sortOrder = 'Display order must be a whole number.'
  }

  const persistedRows = values.items
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.productId.trim())

  if (persistedRows.length === 0) {
    fields.items = 'At least one included item with a product ID is required.'
  }

  const seenProducts = new Set()
  for (const { row, index } of persistedRows) {
    const productId = normalizeAdminProductIdInput(row.productId)
    const qtyRaw = String(row.quantity ?? '').trim()
    const productKey = `items[${index}].productId`
    const qtyKey = `items[${index}].quantity`

    if (!isValidAdminProductId(productId)) {
      fields[productKey] = 'Invalid product id (expected format P042).'
    } else if (seenProducts.has(productId)) {
      fields[productKey] = 'Duplicate product in pack.'
    } else {
      seenProducts.add(productId)
    }

    if (!qtyRaw) {
      fields[qtyKey] = 'Quantity is required.'
    } else {
      const quantity = Number(qtyRaw)
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
        fields[qtyKey] = 'Quantity must be a positive whole number.'
      }
    }
  }

  if (Object.keys(fields).length) return { ok: false, fields }
  return { ok: true }
}
