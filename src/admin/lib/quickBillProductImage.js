import { firstAdminProductImagePath } from './adminProductTableDisplay.js'

/**
 * First image URL from admin products API / D1 `images_json` — no static remapping.
 * Only returns values already stored as HTTPS URLs (e.g. Cloudinary delivery URLs).
 *
 * @param {{ images?: unknown } | unknown[] | null | undefined} productOrImages
 * @returns {string}
 */
export function resolveQuickBillApiImageUrl(productOrImages) {
  /** @type {unknown} */
  let images = productOrImages
  if (productOrImages && typeof productOrImages === 'object' && !Array.isArray(productOrImages)) {
    images = /** @type {{ images?: unknown }} */ (productOrImages).images
  }
  const stored = firstAdminProductImagePath(images)
  if (!stored) return ''
  const url = stored.trim()
  if (!url.startsWith('https://')) return ''
  return url
}

/** @deprecated use resolveQuickBillApiImageUrl */
export function resolveQuickBillCloudinaryImageUrl(productOrImages) {
  return resolveQuickBillApiImageUrl(productOrImages)
}

/**
 * Whether an image src is allowed to render in Quick Bill (HTTPS from API only).
 * @param {string | null | undefined} src
 */
export function isQuickBillRenderableImageSrc(src) {
  return String(src ?? '').trim().startsWith('https://')
}

/**
 * @param {string | null | undefined} src
 * @param {boolean} [loadFailed]
 */
export function quickBillThumbViewModel(src, loadFailed = false) {
  const normalized = String(src ?? '').trim()
  const showImage = isQuickBillRenderableImageSrc(normalized) && !loadFailed
  return {
    showImage,
    imageSrc: showImage ? normalized : '',
    showPlaceholder: !showImage,
  }
}
