export const ADMIN_PRODUCT_LIST_LIMITS = {
  defaultLimit: 25,
  maxLimit: 100,
  maxPage: 500,
  maxSearchLength: 80,
}

/**
 * @param {URLSearchParams} searchParams
 */
export function parseAdminProductListQuery(searchParams) {
  const errors = {}
  const pageRaw = searchParams.get('page')
  const limitRaw = searchParams.get('limit')
  const qRaw = searchParams.get('q') ?? searchParams.get('search')
  const categorySlug = searchParams.get('category') ?? searchParams.get('categorySlug')
  const activeRaw = searchParams.get('active')
  const includeArchived = searchParams.get('includeArchived') === '1'
  const missingRateOnly = searchParams.get('missingRate') === '1'
  const missingPurchaseRateOnly = searchParams.get('missingPurchaseRate') === '1'

  let page = 1
  if (pageRaw !== null && pageRaw !== '') {
    const n = Number(pageRaw)
    if (!Number.isInteger(n) || n < 1 || n > ADMIN_PRODUCT_LIST_LIMITS.maxPage) {
      errors.page = 'Invalid page.'
    } else {
      page = n
    }
  }

  let limit = ADMIN_PRODUCT_LIST_LIMITS.defaultLimit
  if (limitRaw !== null && limitRaw !== '') {
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n < 1) {
      errors.limit = 'Invalid limit.'
    } else if (n > ADMIN_PRODUCT_LIST_LIMITS.maxLimit) {
      errors.limit = `Limit must not exceed ${ADMIN_PRODUCT_LIST_LIMITS.maxLimit}.`
    } else {
      limit = n
    }
  }

  let q = ''
  if (qRaw !== null && String(qRaw).trim()) {
    q = String(qRaw).trim().slice(0, ADMIN_PRODUCT_LIST_LIMITS.maxSearchLength)
  }

  /** @type {'all' | 'active' | 'archived'} */
  let activeFilter = 'active'
  if (includeArchived) {
    activeFilter = 'all'
  }
  if (activeRaw === '0' || activeRaw === 'false') {
    activeFilter = 'archived'
  } else if (activeRaw === '1' || activeRaw === 'true') {
    activeFilter = 'active'
  }

  let category = null
  if (categorySlug !== null && String(categorySlug).trim()) {
    category = String(categorySlug).trim()
  }

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      page,
      limit,
      offset: (page - 1) * limit,
      q,
      categorySlug: category,
      activeFilter,
      missingRateOnly,
      missingPurchaseRateOnly,
    },
  }
}

/**
 * @param {unknown} body
 */
export function validateSellingPriceInrField(body) {
  if (body === undefined || body === null || body === '') {
    return { ok: true, data: null }
  }
  const n = Number(body)
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
    return { ok: false, error: 'Selling price must be a valid INR amount between 0 and 1,000,000.' }
  }
  return { ok: true, data: n }
}
