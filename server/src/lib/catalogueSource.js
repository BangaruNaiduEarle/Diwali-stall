import { categoryLabelToSlug } from './categorySlug.js'

const VALID_STOCK = new Set(['available', 'soldout', 'sold-out'])

/**
 * Normalize one frontend catalogue row for D1 (excludes price/x4).
 * @param {Record<string, unknown>} raw
 * @param {number} arrayIndex
 * @returns {{ record: Record<string, unknown> | null, warnings: string[], errors: string[] }}
 */
export function normalizeCatalogueSourceProduct(raw, arrayIndex) {
  const warnings = []
  const errors = []

  const id = String(raw?.id ?? '').trim()
  if (!id) {
    errors.push(`Row ${arrayIndex}: missing id`)
    return { record: null, warnings, errors }
  }

  const name = String(raw?.name ?? '').trim()
  if (!name) {
    errors.push(`${id}: missing name`)
  }

  const categoryLabel = String(raw?.category ?? '').trim()
  const category_slug = categoryLabelToSlug(categoryLabel)
  if (!category_slug) {
    errors.push(`${id}: unknown category label "${categoryLabel}"`)
  }

  let stock_status = String(raw?.stockStatus ?? 'available').trim()
  if (!VALID_STOCK.has(stock_status)) {
    warnings.push(`${id}: unexpected stockStatus "${stock_status}", keeping as-is if valid at DB layer`)
    if (!VALID_STOCK.has(stock_status)) {
      errors.push(`${id}: invalid stockStatus "${stock_status}"`)
    }
  }

  /** @type {string[]} */
  let images = []
  if (Array.isArray(raw?.images)) {
    images = raw.images.map((u) => String(u).trim()).filter(Boolean)
  }
  if (typeof raw?.image === 'string' && raw.image.trim()) {
    warnings.push(`${id}: legacy "image" field present; merged into images array`)
    const legacy = raw.image.trim()
    if (!images.includes(legacy)) images.unshift(legacy)
  }
  if (images.length === 0) {
    warnings.push(`${id}: no images`)
  }

  const companyRaw = raw?.company
  let company = null
  if (companyRaw !== undefined && companyRaw !== null && String(companyRaw).trim() !== '') {
    company = String(companyRaw).trim()
  }

  if (raw?.price !== undefined) {
    /* explicitly ignored — not an error */
  }
  if (raw?.x4 !== undefined) {
    /* explicitly ignored */
  }

  if (errors.length > 0) {
    return { record: null, warnings, errors }
  }

  const record = {
    id,
    category_slug,
    name,
    pack: String(raw?.pack ?? '').trim(),
    description: String(raw?.description ?? '').trim(),
    featured: raw?.featured ? 1 : 0,
    stock_status,
    active: raw?.active === false ? 0 : 1,
    sort_order: arrayIndex,
    images_json: JSON.stringify(images),
    company,
  }

  return { record, warnings, errors }
}

/**
 * @param {Record<string, unknown>[]} sourceProducts
 */
export function buildCatalogueImportManifest(sourceProducts) {
  const warnings = []
  const errors = []
  const records = []
  const seenIds = new Set()

  sourceProducts.forEach((raw, index) => {
    const { record, warnings: w, errors: e } = normalizeCatalogueSourceProduct(raw, index)
    warnings.push(...w)
    errors.push(...e)
    if (record) {
      if (seenIds.has(record.id)) {
        errors.push(`${record.id}: duplicate id in source array`)
      } else {
        seenIds.add(record.id)
        records.push(record)
      }
    }
  })

  return {
    sourceProductCount: sourceProducts.length,
    recordCount: records.length,
    records,
    warnings,
    errors,
  }
}
