import { resolveApiUrl } from './resolveApiUrl.js'

/** Worker maximum page size (`listPublicProducts`). */
export const PUBLIC_PRODUCTS_PAGE_LIMIT = 100

/**
 * @param {Response} res
 */
async function parseJsonBody(res) {
  const text = await res.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * @param {{ limit?: number, offset?: number }} [opts]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<
 *   | { ok: true, products: unknown[], status: number }
 *   | { ok: false, status: number, error: string, message: string }
 * >}
 */
export async function fetchPublicProductsPage(opts = {}, fetchImpl = fetch) {
  const limit = Math.min(
    PUBLIC_PRODUCTS_PAGE_LIMIT,
    Math.max(1, Number(opts.limit) || PUBLIC_PRODUCTS_PAGE_LIMIT),
  )
  const offset = Math.max(0, Number(opts.offset) || 0)
  const path = `/api/public/products?limit=${limit}&offset=${offset}`

  let res
  try {
    res = await fetchImpl(resolveApiUrl(path), {
      method: 'GET',
      credentials: 'same-origin',
    })
  } catch {
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      message: 'Could not reach the server. Check your connection and try again.',
    }
  }

  const data = await parseJsonBody(res)
  const payload = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: String(payload.error ?? 'request_failed'),
      message: String(payload.message ?? (res.statusText || 'Could not load products.')),
    }
  }

  const products = Array.isArray(payload.products) ? payload.products : []
  return { ok: true, products, status: res.status }
}

/**
 * Fetch every active public product, paging until a short page or empty result.
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchAllPublicProducts(fetchImpl = fetch) {
  const merged = []
  const seenIds = new Set()
  let offset = 0

  while (true) {
    const page = await fetchPublicProductsPage(
      { limit: PUBLIC_PRODUCTS_PAGE_LIMIT, offset },
      fetchImpl,
    )
    if (!page.ok) {
      return page
    }

    const batch = page.products
    if (batch.length === 0) {
      break
    }

    for (const entry of batch) {
      if (!entry || typeof entry !== 'object') continue
      const id = String(/** @type {Record<string, unknown>} */ (entry).id ?? '').trim()
      if (!id || seenIds.has(id)) continue
      seenIds.add(id)
      merged.push(entry)
    }

    if (batch.length < PUBLIC_PRODUCTS_PAGE_LIMIT) {
      break
    }
    offset += PUBLIC_PRODUCTS_PAGE_LIMIT
  }

  return { ok: true, products: merged, status: 200 }
}
