/**
 * Admin direct Cloudinary upload (browser). API secret stays on the Worker only.
 */

const CLOUDINARY_HOST_RE = /^(res|res-\d+)\.cloudinary\.com$/i
const SIGNATURE_RE = /^[a-f0-9]{40}$/i

/**
 * @param {unknown} data
 */
export function parseUploadSignResponse(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'invalid_sign_response', message: 'Upload sign response was not JSON.' }
  }
  const o = /** @type {Record<string, unknown>} */ (data)
  const cloudName = String(o.cloudName ?? '').trim()
  const apiKey = String(o.apiKey ?? '').trim()
  const signature = String(o.signature ?? '').trim()
  const folder = String(o.folder ?? '').trim()
  const publicId = String(o.publicId ?? '').trim()
  const timestamp = Number(o.timestamp)

  if (!cloudName || !apiKey || !folder || !publicId) {
    return { ok: false, error: 'invalid_sign_response', message: 'Upload sign response missing required fields.' }
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, error: 'invalid_sign_response', message: 'Upload sign response had an invalid timestamp.' }
  }
  if (!SIGNATURE_RE.test(signature)) {
    return { ok: false, error: 'invalid_sign_response', message: 'Upload sign response had an invalid signature.' }
  }

  return {
    ok: true,
    sign: { cloudName, apiKey, signature, folder, publicId, timestamp },
  }
}

/**
 * @param {string} secureUrl
 * @param {string} cloudName from sign response (server-owned account binding)
 */
export function validateCloudinaryDeliveryUrl(secureUrl, cloudName) {
  const expectedCloud = String(cloudName ?? '').trim()
  if (!expectedCloud) {
    return { ok: false, error: 'cloud_name_missing', message: 'Cloud name missing from sign response.' }
  }
  let url
  try {
    url = new URL(String(secureUrl ?? '').trim())
  } catch {
    return { ok: false, error: 'invalid_url', message: 'Cloudinary returned an invalid image URL.' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'insecure_url', message: 'Cloudinary image URL must use HTTPS.' }
  }
  if (!CLOUDINARY_HOST_RE.test(url.hostname)) {
    return { ok: false, error: 'bad_host', message: 'Cloudinary image URL host is not allowed.' }
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 4 || parts[0] !== expectedCloud || parts[1] !== 'image' || parts[2] !== 'upload') {
    return {
      ok: false,
      error: 'bad_path',
      message: 'Cloudinary image URL does not match the signed account.',
    }
  }
  return { ok: true, secureUrl: url.toString() }
}

/**
 * @param {unknown} body
 * @param {string} cloudName
 */
export function parseCloudinaryUploadResponse(body, cloudName) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid_upload_response', message: 'Cloudinary upload response was not JSON.' }
  }
  const o = /** @type {Record<string, unknown>} */ (body)
  if (o.error) {
    const msg =
      typeof o.error === 'object' && o.error && 'message' in o.error
        ? String(/** @type {{ message?: unknown }} */ (o.error).message ?? 'Cloudinary upload failed.')
        : 'Cloudinary upload failed.'
    return { ok: false, error: 'cloudinary_error', message: msg }
  }
  const secureUrl = String(o.secure_url ?? '').trim()
  if (!secureUrl) {
    return { ok: false, error: 'missing_secure_url', message: 'Cloudinary upload did not return secure_url.' }
  }
  const check = validateCloudinaryDeliveryUrl(secureUrl, cloudName)
  if (!check.ok) return check
  return { ok: true, secureUrl: check.secureUrl }
}

/**
 * @param {{ cloudName: string, apiKey: string, signature: string, folder: string, publicId: string, timestamp: number }} sign
 * @param {File} file
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function uploadFileToCloudinary(sign, file, opts = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', sign.apiKey)
  form.append('timestamp', String(sign.timestamp))
  form.append('signature', sign.signature)
  form.append('folder', sign.folder)
  form.append('public_id', sign.publicId)
  form.append('overwrite', 'true')

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(sign.cloudName)}/image/upload`

  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: opts.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'upload_aborted', message: 'Upload cancelled.' }
    }
    return { ok: false, error: 'network_error', message: 'Could not reach Cloudinary to upload the image.' }
  }

  let body = null
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: 'invalid_upload_response', message: 'Cloudinary upload returned invalid JSON.' }
  }

  const parsed = parseCloudinaryUploadResponse(body, sign.cloudName)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      message: parsed.message ?? `Cloudinary upload failed (${res.status}).`,
    }
  }
  return parsed
}

/** @param {string} src */
export function imagePreviewSrc(src) {
  const s = String(src ?? '').trim()
  if (!s) return ''
  if (s.startsWith('/images/')) return s
  if (s.startsWith('https://')) return s
  return ''
}

export const MAX_PRODUCT_IMAGES = 20
