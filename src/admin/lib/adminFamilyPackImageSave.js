import { isLocalPreviewUrl, isPersistableFamilyPackImageUrl } from './adminImageUploadFlow.js'

/** @param {{ url?: string }[]} images */
export function hasPendingFamilyPackImagePreviews(images) {
  return (images ?? []).some((img) => isLocalPreviewUrl(String(img?.url ?? '')))
}

/** @param {{ url?: string }[]} images */
export function countPersistableFamilyPackImages(images) {
  return (images ?? []).filter((img) => isPersistableFamilyPackImageUrl(String(img?.url ?? ''))).length
}

/**
 * @param {{ uploading: boolean, images: { url?: string }[] }} state
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function assertFamilyPackSaveNotBlockedByImages(state) {
  if (state.uploading) {
    return { ok: false, message: 'Image uploads are still in progress. Wait until they finish before saving.' }
  }
  if (hasPendingFamilyPackImagePreviews(state.images)) {
    return {
      ok: false,
      message: 'Some images are still uploading (local previews only). Wait for Cloudinary upload and save to finish.',
    }
  }
  return { ok: true }
}
