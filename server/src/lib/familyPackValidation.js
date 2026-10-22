import { inrToPaise } from '../services/money.js'
import { isValidProductId } from './validation.js'

export const FAMILY_PACK_ID_RE = /^FP\d{3,}$/
export const FAMILY_PACK_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const FAMILY_PACK_LIMITS = {
  nameMax: 120,
  shortDescriptionMax: 500,
  packLabelMax: 40,
  maxImages: 20,
  maxItems: 80,
  maxQuantity: 999,
}

/** @param {string} id */
export function isValidFamilyPackId(id) {
  return FAMILY_PACK_ID_RE.test(String(id ?? '').trim())
}

/** @param {string} slug */
export function isValidFamilyPackSlug(slug) {
  const s = String(slug ?? '').trim()
  return s.length >= 2 && s.length <= 80 && FAMILY_PACK_SLUG_RE.test(s)
}

/** @param {string} raw */
export function normalizeFamilyPackSlug(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, paise: number } | { ok: false, message: string }}
 */
export function parseSellingPriceInr(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, message: 'Selling price is required.' }
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, message: 'Selling price must be greater than zero.' }
  }
  try {
    const paise = inrToPaise(n)
    if (paise <= 0) return { ok: false, message: 'Selling price must be greater than zero.' }
    return { ok: true, paise }
  } catch {
    return { ok: false, message: 'Invalid selling price.' }
  }
}

/**
 * @param {unknown} images
 * @returns {{ ok: true, images: { url: string, sortOrder: number, isCover: boolean }[] } | { ok: false, errors: Record<string, string> }}
 */
export function normalizeFamilyPackImages(images) {
  if (!Array.isArray(images)) {
    return { ok: false, errors: { images: 'Images must be an array.' } }
  }
  if (images.length > FAMILY_PACK_LIMITS.maxImages) {
    return { ok: false, errors: { images: `At most ${FAMILY_PACK_LIMITS.maxImages} images allowed.` } }
  }
  /** @type {{ url: string, sortOrder: number, isCover: boolean }[]} */
  const out = []
  const errors = {}
  images.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors[`images[${index}]`] = 'Invalid image entry.'
      return
    }
    const row = /** @type {Record<string, unknown>} */ (entry)
    const url = String(row.url ?? '').trim()
    if (!url || url.length > 2048) {
      errors[`images[${index}].url`] = 'Image URL is required.'
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      errors[`images[${index}].url`] = 'Image URL must be http(s).'
      return
    }
    const sortOrder = Number(row.sortOrder ?? row.sort_order ?? index)
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      errors[`images[${index}].sortOrder`] = 'Invalid sort order.'
      return
    }
    out.push({
      url,
      sortOrder,
      isCover: Boolean(row.isCover ?? row.is_cover),
    })
  })
  if (Object.keys(errors).length) return { ok: false, errors }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.url.localeCompare(b.url))
  let coverIndex = out.findIndex((r) => r.isCover)
  if (coverIndex === -1 && out.length) {
    out[0].isCover = true
  } else if (coverIndex >= 0) {
    out.forEach((r, i) => {
      r.isCover = i === coverIndex
    })
  }
  return { ok: true, images: out }
}

/**
 * @param {unknown} items
 * @param {{ allowEmpty?: boolean }} [opts]
 */
export function normalizeFamilyPackItems(items, opts = {}) {
  if (!Array.isArray(items)) {
    return { ok: false, errors: { items: 'Pack contents must be an array.' } }
  }
  if (items.length === 0) {
    if (opts.allowEmpty) return { ok: true, items: [] }
    return { ok: false, errors: { items: 'At least one pack item is required.' } }
  }
  if (items.length > FAMILY_PACK_LIMITS.maxItems) {
    return { ok: false, errors: { items: `At most ${FAMILY_PACK_LIMITS.maxItems} items allowed.` } }
  }
  /** @type {{ productId: string, quantity: number, unitLabel: string, sortOrder: number }[]} */
  const out = []
  const errors = {}
  const seenProducts = new Set()
  items.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors[`items[${index}]`] = 'Invalid item entry.'
      return
    }
    const row = /** @type {Record<string, unknown>} */ (entry)
    const productId = String(row.productId ?? row.product_id ?? '').trim()
    if (!isValidProductId(productId)) {
      errors[`items[${index}].productId`] = 'Invalid product id.'
      return
    }
    if (seenProducts.has(productId)) {
      errors[`items[${index}].productId`] = 'Duplicate product in pack.'
      return
    }
    seenProducts.add(productId)
    const quantity = Number(row.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > FAMILY_PACK_LIMITS.maxQuantity) {
      errors[`items[${index}].quantity`] = 'Quantity must be a positive whole number.'
      return
    }
    const unitLabel = String(row.unitLabel ?? row.unit_label ?? '').trim()
    if (unitLabel.length > 80) {
      errors[`items[${index}].unitLabel`] = 'Unit label is too long.'
      return
    }
    const sortOrder = Number(row.sortOrder ?? row.sort_order ?? index)
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      errors[`items[${index}].sortOrder`] = 'Invalid sort order.'
      return
    }
    out.push({ productId, quantity, unitLabel, sortOrder })
  })
  if (Object.keys(errors).length) return { ok: false, errors }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.productId.localeCompare(b.productId))
  return { ok: true, items: out }
}

/**
 * @param {Record<string, unknown>} body
 * @param {{ isCreate?: boolean }} [opts]
 */
export function validateFamilyPackPayload(body, opts = {}) {
  /** @type {Record<string, string>} */
  const errors = {}
  const isCreate = opts.isCreate === true

  const name = String(body.name ?? '').trim()
  if (!name) errors.name = 'Pack name is required.'
  else if (name.length > FAMILY_PACK_LIMITS.nameMax) errors.name = 'Pack name is too long.'

  const slugRaw = body.slug !== undefined && body.slug !== null ? String(body.slug) : ''
  const slug = slugRaw ? normalizeFamilyPackSlug(slugRaw) : ''
  if (isCreate && !slug && name) {
    const fromName = normalizeFamilyPackSlug(name)
    if (!isValidFamilyPackSlug(fromName)) errors.slug = 'Could not derive slug from name.'
  } else if (slug && !isValidFamilyPackSlug(slug)) {
    errors.slug = 'Slug must be lowercase letters, numbers, and hyphens.'
  }

  const shortDescription = String(body.shortDescription ?? body.short_description ?? '').trim()
  if (shortDescription.length > FAMILY_PACK_LIMITS.shortDescriptionMax) {
    errors.shortDescription = 'Short description is too long.'
  }

  const hasPriceField =
    body.sellingPriceInr !== undefined ||
    body.selling_price_inr !== undefined ||
    body.sellingPricePaise !== undefined ||
    body.selling_price_paise !== undefined

  /** @type {{ ok: true, paise: number } | { ok: false, message: string } | null} */
  let priceParsed = null
  if (hasPriceField) {
    if (body.sellingPricePaise !== undefined || body.selling_price_paise !== undefined) {
      const paise = Number(body.sellingPricePaise ?? body.selling_price_paise)
      if (!Number.isInteger(paise) || paise <= 0) {
        errors.sellingPriceInr = 'Selling price must be greater than zero.'
      } else {
        priceParsed = { ok: true, paise }
      }
    } else {
      priceParsed = parseSellingPriceInr(body.sellingPriceInr ?? body.selling_price_inr)
      if (!priceParsed.ok) {
        errors.sellingPriceInr = priceParsed.message
      }
    }
  } else if (isCreate) {
    errors.sellingPriceInr = 'Selling price is required.'
  }

  const packLabel = String(body.packLabel ?? body.pack_label ?? '').trim()
  if (packLabel.length > FAMILY_PACK_LIMITS.packLabelMax) {
    errors.packLabel = 'Pack label is too long.'
  }

  let sortOrder = 0
  if (body.sortOrder !== undefined || body.sort_order !== undefined) {
    const n = Number(body.sortOrder ?? body.sort_order)
    if (!Number.isInteger(n)) errors.sortOrder = 'Display order must be a whole number.'
    else sortOrder = n
  }

  let active = body.active === true || body.active === 1 || body.active === '1'
  if (body.active === false || body.active === 0 || body.active === '0') active = false

  let imagesNorm = /** @type {{ url: string, sortOrder: number, isCover: boolean }[] | null} */ (null)
  if (body.images !== undefined) {
    const img = normalizeFamilyPackImages(body.images)
    if (!img.ok) Object.assign(errors, img.errors)
    else imagesNorm = img.images
  }

  let itemsNorm = /** @type {{ productId: string, quantity: number, unitLabel: string, sortOrder: number }[] | null} */ (null)
  if (body.items !== undefined) {
    const allowEmptyItems = isCreate && Array.isArray(body.items) && body.items.length === 0
    const it = normalizeFamilyPackItems(body.items, { allowEmpty: allowEmptyItems })
    if (!it.ok) Object.assign(errors, it.errors)
    else itemsNorm = it.items
  } else if (isCreate) {
    itemsNorm = []
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors }
  }

  const sellingPricePaise = priceParsed?.ok ? priceParsed.paise : null

  return {
    ok: true,
    data: {
      name,
      slug: slug || normalizeFamilyPackSlug(name),
      shortDescription,
      sellingPricePaise,
      packLabel: packLabel || null,
      sortOrder,
      active,
      images: imagesNorm ?? [],
      items: itemsNorm ?? [],
    },
  }
}
