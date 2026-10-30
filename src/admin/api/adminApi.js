import { apiRequest } from './client.js'

/** @returns {Promise<import('./adminApi.js').SessionResult>} */
export async function fetchAdminSession() {
  const result = await apiRequest('/api/admin/session')
  if (!result.ok) return result
  const data = /** @type {{ ok?: boolean, email?: string, message?: string }} */ (result.data ?? {})
  if (!data.ok || !data.email) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_session',
      message: 'Admin session response was invalid.',
    }
  }
  return {
    ok: true,
    email: data.email,
    role: typeof data.role === 'string' ? data.role : 'admin',
    message: data.message ?? '',
  }
}

export async function loginAdmin({ email, password }) {
  const result = await apiRequest('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!result.ok) return result
  const data = /** @type {{ ok?: boolean, email?: string, role?: string }} */ (result.data ?? {})
  if (!data.ok || !data.email) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Login response was invalid.',
    }
  }
  return { ok: true, email: data.email, role: data.role ?? 'admin' }
}

export async function logoutAdmin() {
  return apiRequest('/api/admin/auth/logout', { method: 'POST' })
}

export async function fetchAdminUsers() {
  const result = await apiRequest('/api/admin/users')
  if (!result.ok) return result
  const users = /** @type {{ users?: unknown[] }} */ (result.data ?? {}).users
  return { ok: true, users: Array.isArray(users) ? users : [] }
}

export async function fetchAdminUserAssignees() {
  const result = await apiRequest('/api/admin/users/assignees')
  if (!result.ok) return result
  const users = /** @type {{ users?: unknown[] }} */ (result.data ?? {}).users
  return { ok: true, users: Array.isArray(users) ? users : [] }
}

export async function createAdminUser(body) {
  return apiRequest('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function disableAdminUser(id) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(id)}/disable`, { method: 'POST' })
}

export async function enableAdminUser(id) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(id)}/enable`, { method: 'POST' })
}

export async function resetAdminUserPassword(id, password) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export async function updateAdminUserRole(id, role) {
  const result = await apiRequest(`/api/admin/users/${encodeURIComponent(id)}/role`, {
    method: 'POST',
    body: JSON.stringify({ role }),
  })
  if (!result.ok) return result
  const user = /** @type {{ user?: unknown }} */ (result.data ?? {}).user
  return { ok: true, user }
}

/**
 * @param {{ includeArchived?: boolean, limit?: number, offset?: number }} [opts]
 */
/**
 * @param {{ page?: number, limit?: number, q?: string, categorySlug?: string, missingRateOnly?: boolean, missingPurchaseRateOnly?: boolean, includeArchived?: boolean, flexSearch?: boolean }} opts
 */
export async function fetchAdminProductsPage(opts = {}) {
  const params = new URLSearchParams()
  params.set('page', String(opts.page ?? 1))
  if (opts.limit != null) params.set('limit', String(opts.limit))
  if (opts.q) params.set('q', opts.q)
  if (opts.flexSearch) params.set('flexSearch', '1')
  if (opts.categorySlug) params.set('category', opts.categorySlug)
  if (opts.missingRateOnly) params.set('missingRate', '1')
  if (opts.missingPurchaseRateOnly) params.set('missingPurchaseRate', '1')
  if (opts.includeArchived) params.set('includeArchived', '1')
  const result = await apiRequest(`/api/admin/products?${params.toString()}`)
  if (!result.ok) return result
  const data = /** @type {{ products?: unknown[], pagination?: Record<string, number> }} */ (result.data ?? {})
  const pagination = data.pagination ?? { page: 1, limit: 25, total: 0, totalPages: 0 }
  return {
    ok: true,
    products: Array.isArray(data.products) ? data.products : [],
    pagination: {
      page: Number(pagination.page) || 1,
      limit: Number(pagination.limit) || 25,
      total: Number(pagination.total) || 0,
      totalPages: Number(pagination.totalPages) || 0,
    },
  }
}

export async function fetchAdminProducts(opts = {}) {
  const params = new URLSearchParams()
  if (opts.includeArchived) params.set('includeArchived', '1')
  if (opts.limit != null) params.set('limit', String(opts.limit))
  if (opts.offset != null) params.set('offset', String(opts.offset))
  const qs = params.toString()
  const result = await apiRequest(`/api/admin/products${qs ? `?${qs}` : ''}`)
  if (!result.ok) return result
  const products = /** @type {{ products?: unknown[] }} */ (result.data ?? {}).products
  return { ok: true, products: Array.isArray(products) ? products : [] }
}

/** @param {string} id */
export async function fetchAdminProduct(id) {
  const result = await apiRequest(`/api/admin/products/${encodeURIComponent(id)}`)
  if (!result.ok) return result
  const product = /** @type {{ product?: unknown }} */ (result.data ?? {}).product
  if (!product || typeof product !== 'object') {
    return {
      ok: false,
      status: 404,
      error: 'not_found',
      message: 'Product not found.',
    }
  }
  return { ok: true, product }
}

export async function fetchAdminCategories() {
  const result = await apiRequest('/api/admin/categories')
  if (!result.ok) return result
  const categories = /** @type {{ categories?: unknown[] }} */ (result.data ?? {}).categories
  return { ok: true, categories: Array.isArray(categories) ? categories : [] }
}

/** @param {{ slug: string, label: string, sortOrder?: number }} body */
export async function createAdminCategory(body) {
  const result = await apiRequest('/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify({
      slug: body.slug,
      label: body.label,
      sortOrder: body.sortOrder,
    }),
  })
  if (!result.ok) return result
  const category = /** @type {{ category?: unknown }} */ (result.data ?? {}).category
  return { ok: true, category: category ?? null }
}

/** @param {string} slug @param {{ label?: string, sortOrder?: number }} body */
export async function updateAdminCategory(slug, body) {
  const result = await apiRequest(`/api/admin/categories/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      label: body.label,
      sortOrder: body.sortOrder,
    }),
  })
  if (!result.ok) return result
  const category = /** @type {{ category?: unknown }} */ (result.data ?? {}).category
  return { ok: true, category: category ?? null }
}

/** @param {unknown} data */
function productFromAdminWriteResponse(data) {
  const product = /** @type {{ product?: unknown }} */ (data ?? {}).product
  if (!product || typeof product !== 'object') return null
  return /** @type {Record<string, unknown>} */ (product)
}

/** @param {Record<string, unknown>} body */
export async function createAdminProduct(body) {
  const result = await apiRequest('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!result.ok) return result
  const product = productFromAdminWriteResponse(result.data)
  if (!product) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Create product response was invalid.',
    }
  }
  return { ok: true, status: result.status, product, data: result.data }
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} body
 */
export async function updateAdminProduct(id, body) {
  const result = await apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!result.ok) return result
  const product = productFromAdminWriteResponse(result.data)
  if (!product) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Update product response was invalid.',
    }
  }
  return { ok: true, status: result.status, product, data: result.data }
}

/** @param {string} id @param {boolean} active */
export async function patchAdminProductStatus(id, active) {
  return apiRequest(`/api/admin/products/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  })
}

/** @param {string} id */
export async function deleteAdminProduct(id) {
  return apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * @param {string} productId
 * @param {number} slot 1–20
 */
/** @param {string} id @param {number} x4SellingPriceInr */
export async function updateAdminX4SellingRate(id, x4SellingPriceInr) {
  return apiRequest(`/api/admin/products/${encodeURIComponent(id)}/x4-selling-rate`, {
    method: 'PUT',
    body: JSON.stringify({ x4SellingPriceInr }),
  })
}

/** @deprecated use updateAdminX4SellingRate */
export async function updateAdminPrivateRate(id, unitRateInr) {
  return updateAdminX4SellingRate(id, unitRateInr)
}

/** @param {string} id @param {number} purchaseRateInr */
export async function updateAdminPurchaseRate(id, purchaseRateInr) {
  return apiRequest(`/api/admin/products/${encodeURIComponent(id)}/purchase-rate`, {
    method: 'PUT',
    body: JSON.stringify({ purchaseRateInr }),
  })
}

export async function fetchAdminCustomerRequests(opts = {}) {
  const params = new URLSearchParams()
  params.set('page', String(opts.page ?? 1))
  if (opts.status) params.set('status', opts.status)
  if (opts.finalizationStatus) params.set('finalizationStatus', opts.finalizationStatus)
  if (opts.assignedToMe) params.set('assignedToMe', '1')
  const q = typeof opts.q === 'string' ? opts.q.trim() : ''
  if (q) params.set('q', q)
  const result = await apiRequest(`/api/admin/customer-requests?${params.toString()}`)
  if (!result.ok) return result
  const data = /** @type {{ requests?: unknown[], pagination?: Record<string, number> }} */ (result.data ?? {})
  return {
    ok: true,
    requests: Array.isArray(data.requests) ? data.requests : [],
    pagination: data.pagination ?? {},
  }
}

/** @param {string} id */
export async function fetchAdminCustomerRequest(id) {
  const result = await apiRequest(`/api/admin/customer-requests/${encodeURIComponent(id)}`)
  if (!result.ok) return result
  return { ok: true, request: /** @type {Record<string, unknown>} */ (result.data?.request) }
}

/**
 * @param {string} id
 * @param {string} status
 */
/**
 * @param {string} id
 * @param {{ assigneeUserId?: string, assigneeEmail?: string }} body
 */
/** @param {string} id */
export async function patchAdminCustomerRequestCustomerAgreed(id) {
  const result = await apiRequest(
    `/api/admin/customer-requests/${encodeURIComponent(id)}/customer-agreed`,
    { method: 'PATCH' },
  )
  if (!result.ok) return result
  const data = /** @type {{ request?: Record<string, unknown> }} */ (result.data ?? {})
  if (!data.request) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Customer agreement response was invalid.',
    }
  }
  return { ok: true, request: data.request }
}

/** @param {string} id */
export async function patchAdminCustomerRequestFinalize(id) {
  const result = await apiRequest(
    `/api/admin/customer-requests/${encodeURIComponent(id)}/finalize`,
    { method: 'PATCH' },
  )
  if (!result.ok) return result
  const data = /** @type {{ request?: Record<string, unknown> }} */ (result.data ?? {})
  if (!data.request) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Finalize response was invalid.',
    }
  }
  return { ok: true, request: data.request }
}

/** @param {string} id @param {{ items: { productId: string, quantity: number, unitType?: string }[] }} body */
export async function previewAdminCustomerRequestAdjustBill(id, body) {
  const result = await apiRequest(
    `/api/admin/customer-requests/${encodeURIComponent(id)}/adjust-bill/preview`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )
  if (!result.ok) return result
  const preview = /** @type {Record<string, unknown> | undefined} */ (
    /** @type {{ preview?: unknown }} */ (result.data ?? {}).preview
  )
  if (!preview || typeof preview !== 'object') {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Adjust bill preview response was invalid.',
    }
  }
  return { ok: true, preview }
}

/** @param {string} id @param {{ items: { productId: string, quantity: number, unitType?: string }[], acceptedAmountInr?: string }} body */
export async function patchAdminCustomerRequestAdjustBill(id, body) {
  const result = await apiRequest(
    `/api/admin/customer-requests/${encodeURIComponent(id)}/adjust-bill`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  )
  if (!result.ok) return result
  const data = /** @type {{ request?: Record<string, unknown>, quotation?: Record<string, unknown>, clearedAcceptedAmount?: boolean, savedAcceptedAmount?: boolean }} */ (
    result.data ?? {}
  )
  if (!data.request) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Adjust bill response was invalid.',
    }
  }
  return {
    ok: true,
    request: data.request,
    quotation: data.quotation ?? null,
    clearedAcceptedAmount: Boolean(data.clearedAcceptedAmount),
    savedAcceptedAmount: Boolean(data.savedAcceptedAmount),
  }
}

export async function patchAdminCustomerRequestAssign(id, body) {
  const payload =
    body.assigneeUserId != null && String(body.assigneeUserId).trim()
      ? { assigneeUserId: String(body.assigneeUserId).trim() }
      : { assigneeEmail: String(body.assigneeEmail ?? '').trim().toLowerCase() }
  const result = await apiRequest(
    `/api/admin/customer-requests/${encodeURIComponent(id)}/assign`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  )
  if (!result.ok) return result
  const data = /** @type {{ request?: Record<string, unknown> }} */ (result.data ?? {})
  if (!data.request) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Assign response was invalid.',
    }
  }
  return { ok: true, request: data.request }
}

export async function patchAdminCustomerRequestStatus(id, status) {
  const result = await apiRequest(
    `/api/admin/customer-requests/${encodeURIComponent(id)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: String(status ?? '').trim() }),
    },
  )
  if (!result.ok) return result
  const data = /** @type {{ request?: { id?: string, status?: string } }} */ (result.data ?? {})
  if (!data.request?.id || !data.request?.status) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Status update response was invalid.',
    }
  }
  return {
    ok: true,
    request: { id: String(data.request.id), status: String(data.request.status) },
  }
}

/** @param {string} requestId */
export async function createQuotationForRequest(requestId) {
  return apiRequest(`/api/admin/customer-requests/${encodeURIComponent(requestId)}/quotation`, {
    method: 'POST',
    body: '{}',
  })
}

/** @param {string} requestId */
export async function regenerateQuotationForRequest(requestId) {
  return apiRequest(`/api/admin/customer-requests/${encodeURIComponent(requestId)}/quotation/regenerate`, {
    method: 'POST',
    body: '{}',
  })
}

/** @param {string} requestId */
export async function fetchQuotationForRequest(requestId) {
  return apiRequest(`/api/admin/customer-requests/${encodeURIComponent(requestId)}/quotation`)
}

/**
 * Owner/Super Admin — save customer-agreed amount on the active quotation (internal audit).
 * @param {string} requestId
 * @param {{ acceptedAmountInr: string }} body
 */
export async function patchQuotationCustomerAgreedAmount(requestId, body) {
  return apiRequest(
    `/api/admin/customer-requests/${encodeURIComponent(requestId)}/quotation/customer-agreed-amount`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  )
}

/** @param {string} quotationId */
export async function fetchQuotationWhatsApp(quotationId) {
  return apiRequest(`/api/admin/quotations/${encodeURIComponent(quotationId)}/whatsapp`)
}

/** @param {string} requestId */
export async function fetchOrderConfirmationWhatsApp(requestId) {
  return apiRequest(
    `/api/admin/customer-requests/${encodeURIComponent(requestId)}/order-confirmation/whatsapp`,
  )
}

/**
 * @param {{ productId: string, quantity: number, unitType?: 'box' | 'piece' }[]} items
 * @param {{ pricingMode?: 'selling' | 'bargain' }} [options]
 */
export async function previewQuickBill(items, options = {}) {
  const pricingMode = options.pricingMode === 'bargain' ? 'bargain' : 'selling'
  const result = await apiRequest('/api/admin/quick-bill/preview', {
    method: 'POST',
    body: JSON.stringify({ items, pricingMode }),
  })
  if (!result.ok) return result
  const preview = /** @type {{ preview?: unknown }} */ (result.data ?? {}).preview
  if (!preview || typeof preview !== 'object') {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Preview response was invalid.',
    }
  }
  return { ok: true, preview }
}

/**
 * @param {{
 *   customer: { name: string, mobile: string, area?: string, note?: string },
 *   items: { productId: string, quantity: number, unitType?: 'box' | 'piece' }[],
 *   pricingMode?: 'selling' | 'bargain',
 *   acceptedAmountPaise?: number,
 * }} payload
 */
export async function checkoutQuickBill(payload) {
  const result = await apiRequest('/api/admin/quick-bill/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (!result.ok) return result
  const data = /** @type {{ request?: unknown, quotation?: unknown, warnings?: unknown }} */ (result.data ?? {})
  if (!data.request || !data.quotation) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Checkout response was invalid.',
    }
  }
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.filter((w) => w && typeof w === 'object')
    : undefined
  return { ok: true, request: data.request, quotation: data.quotation, warnings }
}

export async function requestUploadSign(productId, slot) {
  return apiRequest('/api/admin/uploads/sign', {
    method: 'POST',
    body: JSON.stringify({ productId, slot }),
  })
}

export async function requestFamilyPackUploadSign(familyPackId, slot) {
  return apiRequest('/api/admin/uploads/sign', {
    method: 'POST',
    body: JSON.stringify({ familyPackId, slot }),
  })
}

export async function fetchAdminFamilyPacks(opts = {}) {
  const params = new URLSearchParams()
  if (opts.includeInactive === false) params.set('includeInactive', '0')
  if (opts.q) params.set('q', opts.q)
  const qs = params.toString()
  const result = await apiRequest(`/api/admin/family-packs${qs ? `?${qs}` : ''}`)
  if (!result.ok) return result
  const familyPacks = /** @type {{ familyPacks?: unknown[] }} */ (result.data ?? {}).familyPacks
  return { ok: true, familyPacks: Array.isArray(familyPacks) ? familyPacks : [] }
}

export async function fetchAdminFamilyPack(id) {
  const result = await apiRequest(`/api/admin/family-packs/${encodeURIComponent(id)}`)
  if (!result.ok) return result
  const familyPack = /** @type {{ familyPack?: unknown }} */ (result.data ?? {}).familyPack
  if (!familyPack) {
    return { ok: false, status: result.status, error: 'invalid_response', message: 'Invalid family pack response.' }
  }
  return { ok: true, familyPack }
}

export async function createAdminFamilyPack(body) {
  return apiRequest('/api/admin/family-packs', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateAdminFamilyPack(id, body) {
  return apiRequest(`/api/admin/family-packs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function patchAdminFamilyPackStatus(id, active) {
  return apiRequest(`/api/admin/family-packs/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  })
}

/** @param {string} id */
export async function deleteAdminFamilyPack(id) {
  return apiRequest(`/api/admin/family-packs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * @typedef {{ ok: true, email: string, message: string }} SessionOk
 * @typedef {{ ok: false, status: number, error: string, message: string, fields?: Record<string, string> }} SessionFail
 * @typedef {SessionOk | SessionFail} SessionResult
 */
