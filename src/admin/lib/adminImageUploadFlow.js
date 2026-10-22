/**
 * Shared admin image upload helpers (file input → preview → sign → Cloudinary).
 */

/** @param {Event & { target: EventTarget | null }} event */
export function snapshotFilesFromInputEvent(event) {
  const target = event.target
  if (!target || typeof target !== 'object') return []
  const input = /** @type {HTMLInputElement} */ (target)
  if (input.type !== 'file') return []
  const files = Array.from(input.files ?? [])
  input.value = ''
  return files
}

/** @param {File} file */
export function isLikelyImageFile(file) {
  if (!file) return false
  const type = String(file.type ?? '').trim().toLowerCase()
  if (type.startsWith('image/')) return true
  return /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i.test(String(file.name ?? ''))
}

/** @param {string} url */
export function isLocalPreviewUrl(url) {
  return String(url ?? '').startsWith('blob:')
}

/** @param {string} url */
export function isCloudinaryHttpsImageUrl(url) {
  const s = String(url ?? '').trim()
  if (!s.startsWith('https://')) return false
  try {
    const parsed = new URL(s)
    if (!/^(res(-\d+)?)\.cloudinary\.com$/i.test(parsed.hostname)) return false
    return parsed.pathname.includes('/image/upload/')
  } catch {
    return false
  }
}

/** @param {string} url */
export function isPersistableImageUrl(url) {
  const s = String(url ?? '').trim()
  if (!s || isLocalPreviewUrl(s)) return false
  if (s.startsWith('/images/') || s.startsWith('images/')) return true
  return isCloudinaryHttpsImageUrl(s)
}

/** Family pack D1 rows require HTTPS Cloudinary delivery URLs (see server normalizeFamilyPackImages). */
export function isPersistableFamilyPackImageUrl(url) {
  return isCloudinaryHttpsImageUrl(url)
}

/** @param {File} file */
export function createLocalPreviewUrl(file) {
  return URL.createObjectURL(file)
}

/** @param {string | undefined | null} url */
export function revokeLocalPreviewUrl(url) {
  if (isLocalPreviewUrl(url)) {
    URL.revokeObjectURL(String(url))
  }
}

/** @param {string} url */
export function adminImageDisplaySrc(url) {
  const s = String(url ?? '').trim()
  if (!s) return ''
  if (isLocalPreviewUrl(s)) return s
  return s
}
