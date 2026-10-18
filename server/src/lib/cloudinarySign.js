/**
 * Cloudinary signed-upload helpers (Worker + Node). Never expose api_secret.
 * Signature algorithm: SHA-1 of sorted params + api_secret (Cloudinary default).
 */

export const CLOUDINARY_PRODUCT_FOLDER = 'diwali/products'
export const CLOUDINARY_SLOT_MIN = 1
export const CLOUDINARY_SLOT_MAX = 20

/**
 * @param {Record<string, unknown>} env
 * @returns {{ cloudName: string, apiKey: string, apiSecret: string } | null}
 */
export function readCloudinaryCloudName(env) {
  const cloudName = String(env?.CLOUDINARY_CLOUD_NAME ?? '').trim()
  return cloudName || null
}

export function readCloudinaryConfig(env) {
  const cloudName = readCloudinaryCloudName(env)
  const apiKey = String(env?.CLOUDINARY_API_KEY ?? '').trim()
  const apiSecret = String(env?.CLOUDINARY_API_SECRET ?? '').trim()
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: number } | { ok: false }}
 */
export function normalizeUploadSlot(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: CLOUDINARY_SLOT_MIN }
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < CLOUDINARY_SLOT_MIN || n > CLOUDINARY_SLOT_MAX) {
    return { ok: false }
  }
  return { ok: true, value: n }
}

/**
 * Server-owned folder + public_id. Client folder/publicId fields are ignored.
 * @param {string} productId
 * @param {number} slot
 */
export function buildProductUploadTarget(productId, slot) {
  return {
    folder: CLOUDINARY_PRODUCT_FOLDER,
    publicId: `${productId}/${slot}`,
  }
}

/**
 * Cloudinary string-to-sign: every param except file, cloud_name, resource_type, api_key.
 * @param {Record<string, string | number | boolean>} params
 */
export function buildCloudinarySignatureString(params) {
  const skipped = new Set(['file', 'cloud_name', 'resource_type', 'api_key'])
  return Object.keys(params)
    .filter((key) => !skipped.has(key))
    .filter((key) => {
      const v = params[key]
      return v !== undefined && v !== null && v !== ''
    })
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
}

/** @param {string} text */
export async function sha1Hex(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {Record<string, string | number | boolean>} params
 * @param {string} apiSecret
 */
export async function signCloudinaryParams(params, apiSecret) {
  const payload = buildCloudinarySignatureString(params)
  return sha1Hex(`${payload}${apiSecret}`)
}
