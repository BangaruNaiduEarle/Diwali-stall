import { useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ImagePlus, Loader2, Trash2, X } from 'lucide-react'
import { requestUploadSign } from '../api/adminApi.js'
import {
  MAX_PRODUCT_IMAGES,
  imagePreviewSrc,
  parseUploadSignResponse,
  uploadFileToCloudinary,
} from '../lib/cloudinaryUpload.js'

/**
 * @param {{
 *   productId: string | null,
 *   images: string[],
 *   onImagesChange: (images: string[]) => void,
 *   disabled?: boolean,
 *   onEnsureProduct: () => Promise<{ ok: true, productId: string } | { ok: false, message: string }>,
 *   onPersistImages: (images: string[]) => Promise<{ ok: true } | { ok: false, message: string }>,
 * }} props
 */
export default function ProductImageManager({
  productId,
  images,
  onImagesChange,
  disabled = false,
  onEnsureProduct,
  onPersistImages,
}) {
  const inputId = useId()
  const fileRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const abortRef = useRef(/** @type {AbortController | null} */ (null))

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(/** @type {string | null} */ (null))
  const [uploadProgress, setUploadProgress] = useState(/** @type {string | null} */ (null))
  const [replaceIndex, setReplaceIndex] = useState(/** @type {number | null} */ (null))

  const atMax = images.length >= MAX_PRODUCT_IMAGES
  const busy = disabled || uploading

  function moveImage(index, direction) {
    const next = [...images]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    const tmp = next[index]
    next[index] = next[target]
    next[target] = tmp
    onImagesChange(next)
  }

  function removeImage(index) {
    onImagesChange(images.filter((_, i) => i !== index))
    setUploadError(null)
  }

  function openFilePicker(index = null) {
    if (busy) return
    if (index == null && atMax) {
      setUploadError(`Maximum ${MAX_PRODUCT_IMAGES} images allowed.`)
      return
    }
    setReplaceIndex(index)
    setUploadError(null)
    fileRef.current?.click()
  }

  function cancelUpload() {
    abortRef.current?.abort()
    abortRef.current = null
    setUploading(false)
    setUploadProgress(null)
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file.')
      return
    }

    setUploading(true)
    setUploadError(null)
    setUploadProgress('Preparing product…')

    const ensured = await onEnsureProduct()
    if (!ensured.ok) {
      setUploading(false)
      setUploadProgress(null)
      setUploadError(ensured.message)
      return
    }

    const pid = ensured.productId
    const insertAt = replaceIndex != null ? replaceIndex : images.length
    const slot = insertAt + 1
    if (slot < 1 || slot > MAX_PRODUCT_IMAGES) {
      setUploading(false)
      setUploadProgress(null)
      setUploadError('Invalid image slot.')
      return
    }

    setUploadProgress(`Requesting upload signature (slot ${slot})…`)
    const signResult = await requestUploadSign(pid, slot)
    if (!signResult.ok) {
      setUploading(false)
      setUploadProgress(null)
      setUploadError(signResult.message)
      return
    }

    const parsedSign = parseUploadSignResponse(signResult.data)
    if (!parsedSign.ok) {
      setUploading(false)
      setUploadProgress(null)
      setUploadError(parsedSign.message)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setUploadProgress('Uploading to Cloudinary…')

    const uploadResult = await uploadFileToCloudinary(parsedSign.sign, file, {
      signal: controller.signal,
    })
    abortRef.current = null

    if (!uploadResult.ok) {
      setUploading(false)
      setUploadProgress(null)
      setUploadError(uploadResult.message)
      return
    }

    const next = [...images]
    if (replaceIndex != null && replaceIndex < next.length) {
      next[replaceIndex] = uploadResult.secureUrl
    } else {
      next.push(uploadResult.secureUrl)
    }

    onImagesChange(next)
    setUploadProgress('Saving image order…')

    const saved = await onPersistImages(next)
    setUploading(false)
    setUploadProgress(null)
    setReplaceIndex(null)

    if (!saved.ok) {
      setUploadError(`Upload succeeded but save failed: ${saved.message}`)
      return
    }
  }

  const needsProductId = !productId || !/^P\d+$/.test(productId)

  return (
    <div className="admin-image-manager">
      <div className="admin-image-manager__head">
        <div>
          <span className="admin-label">Product images</span>
          <p className="admin-hint">
            Up to {MAX_PRODUCT_IMAGES} images. Existing paths/URLs are kept as-is until you replace a slot. Slot{' '}
            {images.length + 1} is used for the next upload.
          </p>
          {needsProductId ? (
            <p className="admin-hint admin-hint--warn">
              Enter a valid product ID and required fields before uploading; the product will be created in D1 first.
            </p>
          ) : null}
        </div>
        <div className="admin-image-manager__actions">
          {uploading ? (
            <button type="button" className="admin-link-button" onClick={cancelUpload}>
              Cancel upload
            </button>
          ) : null}
          <button
            type="button"
            className="admin-image-manager__add"
            disabled={busy || atMax}
            onClick={() => openFilePicker(null)}
          >
            <ImagePlus size={18} aria-hidden="true" />
            Add image
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={busy}
        onChange={handleFileChange}
      />

      {uploading ? (
        <div className="admin-image-manager__progress" aria-live="polite">
          <Loader2 className="animate-spin" size={18} aria-hidden="true" />
          <span>{uploadProgress ?? 'Working…'}</span>
        </div>
      ) : null}

      {uploadError ? (
        <div className="admin-alert admin-alert--error admin-image-manager__error" role="alert">
          {uploadError}
          <button type="button" className="admin-image-manager__dismiss" onClick={() => setUploadError(null)} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {images.length === 0 ? (
        <p className="admin-image-manager__empty">No images yet. Add an image or save local paths via the advanced field below.</p>
      ) : (
        <ul className="admin-image-list">
          {images.map((src, index) => {
            const preview = imagePreviewSrc(src)
            return (
              <li key={`${index}-${src}`} className="admin-image-item">
                <div className="admin-image-item__preview">
                  {preview ? (
                    <img src={preview} alt="" loading="lazy" />
                  ) : (
                    <span className="admin-image-item__placeholder">No preview</span>
                  )}
                  <span className="admin-image-item__slot">Slot {index + 1}</span>
                </div>
                <p className="admin-image-item__url" title={src}>
                  {src}
                </p>
                <div className="admin-image-item__controls">
                  <button
                    type="button"
                    className="admin-icon-btn"
                    disabled={busy || index === 0}
                    onClick={() => moveImage(index, -1)}
                    aria-label="Move up"
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    type="button"
                    className="admin-icon-btn"
                    disabled={busy || index === images.length - 1}
                    onClick={() => moveImage(index, 1)}
                    aria-label="Move down"
                  >
                    <ChevronDown size={18} />
                  </button>
                  <button
                    type="button"
                    className="admin-icon-btn"
                    disabled={busy}
                    onClick={() => openFilePicker(index)}
                    aria-label="Replace with upload"
                  >
                    <ImagePlus size={18} />
                  </button>
                  <button
                    type="button"
                    className="admin-icon-btn admin-icon-btn--danger"
                    disabled={busy}
                    onClick={() => removeImage(index)}
                    aria-label="Remove"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
