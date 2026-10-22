import { isLocalPreviewUrl, isPersistableImageUrl } from './adminImageUploadFlow.js'

/** @param {string[]} images */
export function hasPendingProductImagePreviews(images) {
  return (images ?? []).some((url) => isLocalPreviewUrl(String(url ?? '')))
}

/** @param {string[]} images */
export function countPersistableProductImages(images) {
  return (images ?? []).filter((url) => isPersistableImageUrl(String(url ?? ''))).length
}

/**
 * @param {{ uploading: boolean, images: string[] }} state
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function assertProductSaveNotBlockedByImages(state) {
  if (state.uploading) {
    return { ok: false, message: 'Image uploads are still in progress. Wait until they finish before saving.' }
  }
  if (hasPendingProductImagePreviews(state.images)) {
    return {
      ok: false,
      message: 'Some images are still uploading (local previews only). Wait for Cloudinary upload and save to finish.',
    }
  }
  return { ok: true }
}
