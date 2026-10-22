import { isLikelyImageFile } from './adminImageUploadFlow.js'

/** @param {File} file @param {number} [maxBytes] */
export function validateImageUploadFile(file, maxBytes = 10 * 1024 * 1024) {
  if (!file) return { ok: false, message: 'No file selected.' }
  if (!isLikelyImageFile(file)) {
    return { ok: false, message: 'Please choose a PNG, JPEG, or other supported image file.' }
  }
  if (file.size > maxBytes) {
    return { ok: false, message: `Image must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.` }
  }
  if (file.size === 0) {
    return { ok: false, message: 'The selected file is empty.' }
  }
  return { ok: true }
}
