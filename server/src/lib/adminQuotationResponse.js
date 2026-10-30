import {
  buildManualRequestInternalPricingPreview,
  buildRequestInternalPricingView,
  manualRequestEligibleForInternalPricingPreview,
} from './adminInternalPricingPreview.js'
import { canViewSensitiveProductPricing } from './adminRoles.js'
import {
  catalogueSellingUnitRates,
  presentCustomerFacingQuotation,
} from './customerFacingQuotationTotal.js'

export { catalogueSellingUnitRates }

/** Quick Bill audit + internal pricing metadata — owner/super_admin only. */
const RESTRICTED_QUOTATION_AUDIT_KEYS = [
  'pricingMode',
  'sellingSubtotalPaise',
  'finalSubtotalPaise',
  'bargainFloorPaise',
  'acceptedAmountPaise',
  'internalPricingPreview',
]

/**
 * @param {Record<string, unknown> | null | undefined} quotation
 * @returns {Record<string, unknown> | null | undefined}
 */
export function stripQuotationAuditFieldsForRestrictedRole(quotation) {
  if (!quotation || typeof quotation !== 'object') return quotation
  const next = { ...quotation }
  for (const key of RESTRICTED_QUOTATION_AUDIT_KEYS) {
    delete next[key]
  }
  return next
}

/**
 * True when a persisted unit rate is not explainable by catalogue selling (box or loose).
 * @param {D1Database} db
 * @param {string} productId
 * @param {unknown} unitPaise
 */
export async function shouldRedactNonSellingUnitRateForAdmin(db, productId, unitPaise) {
  const u = unitPaise == null ? null : Number(unitPaise)
  if (!Number.isInteger(u) || u <= 0) return false
  const rates = await catalogueSellingUnitRates(db, String(productId))
  if (!rates) return false
  if (u === rates.boxPaise) return false
  if (rates.loosePaise != null && u === rates.loosePaise) return false
  return true
}

/**
 * Customer-facing quotation view for all roles; audit fields stripped for admin.
 *
 * @param {D1Database} db
 * @param {Record<string, unknown> | null | undefined} quotation
 * @param {unknown} role
 */
export async function filterQuotationForRole(db, quotation, role) {
  if (!quotation) return quotation

  const presented = await presentCustomerFacingQuotation(
    db,
    quotation,
    quotation.customerRequestId ?? null,
  )

  if (canViewSensitiveProductPricing(role)) {
    return presented
  }

  return stripQuotationAuditFieldsForRestrictedRole(presented)
}

/**
 * Display-only catalogue company for admin quotation lines (not persisted on quotation_items / WhatsApp).
 *
 * @param {D1Database} db
 * @param {unknown} items
 */
export async function attachProductCompanyToQuotationItems(db, items) {
  if (!Array.isArray(items) || items.length === 0) return items

  /** @type {string[]} */
  const productIds = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const id = /** @type {Record<string, unknown>} */ (raw).productId
    if (id != null && String(id).trim()) productIds.push(String(id).trim())
  }
  const uniqueIds = [...new Set(productIds)]
  if (!uniqueIds.length) return items

  const placeholders = uniqueIds.map(() => '?').join(', ')
  const result = await db
    .prepare(`SELECT id, company FROM products WHERE id IN (${placeholders})`)
    .bind(...uniqueIds)
    .all()

  /** @type {Map<string, string | null>} */
  const companyById = new Map()
  for (const row of result.results ?? []) {
    if (!row || typeof row !== 'object') continue
    const id = String(/** @type {Record<string, unknown>} */ (row).id ?? '')
    if (!id) continue
    const raw = /** @type {Record<string, unknown>} */ (row).company
    const company =
      raw != null && String(raw).trim() ? String(raw).trim() : null
    companyById.set(id, company)
  }

  return items.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw
    const item = /** @type {Record<string, unknown>} */ (raw)
    const productId = item.productId != null ? String(item.productId) : ''
    if (!productId || !companyById.has(productId)) return item
    const company = companyById.get(productId)
    if (!company) return item
    return { ...item, company }
  })
}

/**
 * Quotation on customer-request detail — customer-facing lines plus owner-only audit or estimate preview.
 *
 * @param {D1Database} db
 * @param {Record<string, unknown> | null | undefined} quotation
 * @param {unknown} role
 * @param {Record<string, unknown> | null | undefined} [request]
 */
export async function filterQuotationForCustomerRequestDetail(db, quotation, role, request) {
  const filtered = await filterQuotationForRole(db, quotation, role)
  if (!filtered) return filtered

  const withCompany = {
    ...filtered,
    items: await attachProductCompanyToQuotationItems(db, filtered.items),
  }

  if (!canViewSensitiveProductPricing(role)) {
    return withCompany
  }
  if (String(withCompany.pricingMode ?? '') === 'bargain') {
    return withCompany
  }
  if (!manualRequestEligibleForInternalPricingPreview(request)) {
    return withCompany
  }
  const preview = await buildManualRequestInternalPricingPreview(db, request?.items)
  if (!preview) return withCompany
  return { ...withCompany, internalPricingPreview: preview }
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown> | null | undefined} request
 * @param {unknown} role
 */
const RESTRICTED_REQUEST_DETAIL_KEYS = ['internalPricingView']

/**
 * @param {Record<string, unknown>} request
 */
function stripInternalFieldsFromRequestForAdmin(request) {
  const next = { ...request }
  for (const key of RESTRICTED_REQUEST_DETAIL_KEYS) {
    delete next[key]
  }
  return next
}

export async function filterCustomerRequestDetailForRole(db, request, role) {
  if (!request) return request

  if (canViewSensitiveProductPricing(role)) {
    const internalPricingView = await buildRequestInternalPricingView(db, request.items)
    return {
      ...request,
      ...(internalPricingView ? { internalPricingView } : {}),
    }
  }

  const items = await Promise.all(
    (request.items ?? []).map(async (item) => {
      if (!item || typeof item !== 'object') return item
      const productId = item.productId
      if (!productId || item.unitPricePaise == null) return item
      const redact = await shouldRedactNonSellingUnitRateForAdmin(db, String(productId), item.unitPricePaise)
      if (!redact) return item
      return { ...item, unitPricePaise: null }
    }),
  )

  return stripInternalFieldsFromRequestForAdmin({ ...request, items })
}
