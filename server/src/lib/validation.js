const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PRODUCT_ID_RE = /^P\d{3,}$/

export const LIMITS = {
  name: 200,
  pack: 120,
  description: 2000,
  company: 120,
  categoryLabel: 120,
}

/** @param {string} slug */
export function isValidCategorySlug(slug) {
  return SLUG_RE.test(String(slug ?? '').trim())
}

/** @param {string} id */
export function isValidProductId(id) {
  return PRODUCT_ID_RE.test(String(id ?? '').trim())
}

const VALID_STOCK = new Set(['available', 'soldout', 'sold-out'])

/** @param {string} status */
export function isValidStockStatus(status) {
  return VALID_STOCK.has(String(status ?? '').trim())
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, data: Record<string, unknown> } | { ok: false, errors: Record<string, string> }}
 */
export function parseJsonObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }
  return { ok: true, data: /** @type {Record<string, unknown>} */ (body) }
}

const LOCAL_IMAGE_PREFIX = '/images/'
const MAX_IMAGE_REF_LENGTH = 1024
const CLOUDINARY_HOST_RE = /^(res|res-\d+)\.cloudinary\.com$/i

/**
 * Local `/images/...` paths or HTTPS Cloudinary delivery URLs.
 * @param {string} raw
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateImageRef(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return { ok: false, error: 'Empty image path.' }
  if (s.length > MAX_IMAGE_REF_LENGTH) return { ok: false, error: 'Image path too long.' }
  if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false, error: 'Image path contains control characters.' }

  if (s.startsWith(LOCAL_IMAGE_PREFIX)) {
    if (s.includes('://') || s.includes('\\') || s.includes('..')) {
      return { ok: false, error: `Unsafe local image path: ${s}` }
    }
    return { ok: true }
  }

  let parsed
  try {
    parsed = new URL(s)
  } catch {
    return { ok: false, error: `Malformed image URL: ${s}` }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: `Image URL must use https: ${s}` }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Image URL must not include credentials.' }
  }
  if (!CLOUDINARY_HOST_RE.test(parsed.hostname)) {
    return { ok: false, error: `Image host is not Cloudinary: ${s}` }
  }
  if (!parsed.pathname.includes('/image/upload/')) {
    return { ok: false, error: `Not a Cloudinary image delivery URL: ${s}` }
  }
  return { ok: true }
}

/** @param {string[]} paths */
export function validateImagePaths(paths) {
  const errors = []
  if (!Array.isArray(paths)) {
    return { ok: false, errors: ['images must be an array of path strings.'] }
  }
  if (paths.length > 20) {
    errors.push('Too many images (max 20).')
  }
  for (const p of paths) {
    const result = validateImageRef(p)
    if (!result.ok) errors.push(result.error)
  }
  return { ok: errors.length === 0, errors }
}
