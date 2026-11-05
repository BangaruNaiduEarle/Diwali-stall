import { customerRequestDb, customerRequestScope, validateScopedRequest, validateTransactionCatalogueReferences } from './adminCustomerRequestScope.js'
import {
  buildManualRequestInternalPricingPreview,
  buildRequestInternalPricingView,
  manualRequestEligibleForInternalPricingPreview,
} from './adminInternalPricingPreview.js'
import { canViewSensitiveProductPricing } from './adminRoles.js'
import { billPurchaseSummary } from './billPurchaseSummary.js'
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
  'internalFinancialSummary',
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
export async function shouldRedactNonSellingUnitRateForAdmin(db, productId, unitPaise, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  await validateTransactionCatalogueReferences(db, [{ productId }])
  const u = unitPaise == null ? null : Number(unitPaise)
  const restricted = Boolean(customerRequestScope(db))
  if (restricted && (!Number.isSafeInteger(unitPaise) || unitPaise <= 0)) return true
  if (!Number.isInteger(u) || u <= 0) return false
  const rates = await catalogueSellingUnitRates(db, String(productId))
  if (!rates) return restricted
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
export async function filterQuotationForRole(db, quotation, role, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  if (!quotation) return quotation

  const presented = await presentCustomerFacingQuotation(
    db,
    quotation,
    quotation.customerRequestId ?? null,
    seasonId,
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
export async function attachProductCompanyToQuotationItems(db, items, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  if (!Array.isArray(items) || items.length === 0) return items

  await validateTransactionCatalogueReferences(db, items)
  const season = String(seasonId ?? '').trim()
  if (!season) return items

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
    .prepare(`SELECT id, company FROM products WHERE season_id = ? AND id IN (${placeholders})`)
    .bind(season, ...uniqueIds)
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
 * @param {string} seasonId
 */
export async function filterQuotationForCustomerRequestDetail(db, quotation, role, request, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  await validateScopedRequest(db, request)
  if (customerRequestScope(db) && request && quotation && request.id !== quotation.customerRequestId) {
    throw Object.assign(new Error('Quotation and request ownership do not match.'), { status: 409, code: 'request_ownership_mismatch' })
  }
  const filtered = await filterQuotationForRole(db, quotation, role, customerRequestScope(db)?.seasonId)
  if (!filtered) return filtered

  const withCompany = {
    ...filtered,
    items: await attachProductCompanyToQuotationItems(db, filtered.items, seasonId),
  }

  if (canViewSensitiveProductPricing(role)) withCompany.internalFinancialSummary = await billPurchaseSummary(db, request, withCompany, role, seasonId)

  if (!canViewSensitiveProductPricing(role)) {
    return withCompany
  }
  if (String(withCompany.pricingMode ?? '') === 'bargain') {
    return withCompany
  }
  if (!manualRequestEligibleForInternalPricingPreview(request)) {
    return withCompany
  }
  const preview = await buildManualRequestInternalPricingPreview(db, request?.items, seasonId)
  if (!preview) return withCompany
  return { ...withCompany, internalPricingPreview: preview }
}

/**
 * @param {D1Database} db
 * @param {Record<string, unknown> | null | undefined} request
 * @param {unknown} role
 */
const RESTRICTED_REQUEST_DETAIL_KEYS = ['internalPricingView', 'paymentPreferences']

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

export async function filterCustomerRequestDetailForRole(db, request, role, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  await validateScopedRequest(db, request)
  if (!request) return request

  if (canViewSensitiveProductPricing(role)) {
    const internalPricingView = await buildRequestInternalPricingView(db, request.items, seasonId)
    return {
      ...request,
      ...(internalPricingView ? { internalPricingView } : {}),
    }
  }

  const items = await Promise.all(
    (request.items ?? []).map(async (item) => {
      if (!item || typeof item !== 'object') return item
      const productId = item.productId
      if (customerRequestScope(db) && !productId && item.unitPricePaise != null) {
        const pack = item.familyPackId
          ? await db.prepare('SELECT selling_price_paise FROM family_packs WHERE id = ?').bind(item.familyPackId).first() : null
        const price = pack?.selling_price_paise
        if (!Number.isSafeInteger(price) || price <= 0 || item.unitPricePaise !== price) return { ...item, unitPricePaise: null }
      }
      if (!productId || item.unitPricePaise == null) return item
      const redact = await shouldRedactNonSellingUnitRateForAdmin(db, String(productId), item.unitPricePaise)
      if (!redact) return item
      return { ...item, unitPricePaise: null }
    }),
  )

  return stripInternalFieldsFromRequestForAdmin({ ...request, items })
}
