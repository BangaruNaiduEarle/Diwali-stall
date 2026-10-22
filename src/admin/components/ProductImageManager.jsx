import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ImagePlus, Loader2, Trash2, X } from 'lucide-react'
import { requestUploadSign } from '../api/adminApi.js'
import {
  MAX_PRODUCT_IMAGES,
  imagePreviewSrc,
  parseUploadSignResponse,
  uploadFileToCloudinary,
} from '../lib/cloudinaryUpload.js'
import {
  createLocalPreviewUrl,
  isLocalPreviewUrl,
  isPersistableImageUrl,
  revokeLocalPreviewUrl,
  snapshotFilesFromInputEvent,
} from '../lib/adminImageUploadFlow.js'
import { validateImageUploadFile } from '../lib/validateImageUploadFile.js'

function productImageDisplaySrc(src) {
  const s = String(src ?? '').trim()
  if (!s) return ''
  if (isLocalPreviewUrl(s)) return s
  return imagePreviewSrc(s) || s
}

/**
 * @param {{
 *   productId: string | null,
 *   images: string[],
 *   onImagesChange: (images: string[]) => void,
 *   disabled?: boolean,
 *   onEnsureProduct: () => Promise<{ ok: true, productId: string } | { ok: false, message: string }>,
 *   onPersistImages: (images: string[]) => Promise<{ ok: true } | { ok: false, message: string }>,
 *   uploadCoordinatorRef?: { current: { waitUntilIdle: () => Promise<void>, isBusy: () => boolean } | null },
 *   onUploadBusyChange?: (busy: boolean) => void,
 * }} props
 */
export default function ProductImageManager({
  productId,
  images,
  onImagesChange,
  disabled = false,
  onEnsureProduct,
  onPersistImages,
  uploadCoordinatorRef,
  onUploadBusyChange,
}) {
  const inputId = useId()
  const fileRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const abortRef = useRef(/** @type {AbortController | null} */ (null))
  const localPreviewUrlsRef = useRef(/** @type {Set<string>} */ (new Set()))
  const imagesRef = useRef(images)
  const uploadRunRef = useRef(/** @type {Promise<void> | null} */ (null))

  useEffect(() => {
    imagesRef.current = images
  }, [images])

  useEffect(() => {
    const urls = localPreviewUrlsRef.current
    return () => {
      for (const url of urls) revokeLocalPreviewUrl(url)
      urls.clear()
    }
  }, [])

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(/** @type {string | null} */ (null))
  const [uploadProgress, setUploadProgress] = useState(/** @type {string | null} */ (null))
  const [replaceIndex, setReplaceIndex] = useState(/** @type {number | null} */ (null))

  useEffect(() => {
    const busy =
      uploading || images.some((url) => isLocalPreviewUrl(String(url ?? '')))
    onUploadBusyChange?.(busy)
    if (!uploadCoordinatorRef) return
    uploadCoordinatorRef.current = {
      waitUntilIdle: async () => {
        if (uploadRunRef.current) await uploadRunRef.current
      },
      isBusy: () =>
        uploading || imagesRef.current.some((url) => isLocalPreviewUrl(String(url ?? ''))),
    }
  }, [uploadCoordinatorRef, uploading, images, onUploadBusyChange])

  const atMax = images.length >= MAX_PRODUCT_IMAGES
  const busy = disabled || uploading

  function setCover(index) {
    if (index <= 0) return
    const next = [...images]
    const [picked] = next.splice(index, 1)
    next.unshift(picked)
    onImagesChange(next)
  }

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
    const removed = images[index]
    revokeLocalPreviewUrl(removed)
    localPreviewUrlsRef.current.delete(removed)
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
    const pickedFiles = snapshotFilesFromInputEvent(e)
    if (!pickedFiles.length || busy) {
      if (!pickedFiles.length && !busy) setUploadError('No files were captured from the file picker. Try again.')
      return
    }

    const run = async () => {
      /** @type {File[]} */
      const validFiles = []
      for (const file of pickedFiles) {
        const valid = validateImageUploadFile(file)
        if (!valid.ok) {
          setUploadError(valid.message)
          continue
        }
        validFiles.push(file)
      }
      if (!validFiles.length) return

      setUploadError(null)
      setUploadProgress('Showing local preview…')

      let next = [...imagesRef.current]
      /** @type {{ file: File, previewUrl: string }[]} */
      const uploadJobs = []

      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i]
        if (next.length >= MAX_PRODUCT_IMAGES && replaceIndex == null) {
          setUploadError(`Maximum ${MAX_PRODUCT_IMAGES} images allowed.`)
          break
        }
        const previewUrl = createLocalPreviewUrl(file)
        localPreviewUrlsRef.current.add(previewUrl)
        if (replaceIndex != null && i === 0 && replaceIndex < next.length) {
          revokeLocalPreviewUrl(next[replaceIndex])
          localPreviewUrlsRef.current.delete(next[replaceIndex])
          next[replaceIndex] = previewUrl
        } else {
          next.push(previewUrl)
        }
        uploadJobs.push({ file, previewUrl })
      }
      onImagesChange(next)

      try {
        setUploadProgress('Preparing product…')
        const ensured = await onEnsureProduct()
        if (!ensured.ok) {
          setUploadError(ensured.message)
          return
        }

        const pid = ensured.productId
        const seen = new Set(next.filter((url) => isPersistableImageUrl(url)))
        let persistFailed = false

        for (let i = 0; i < uploadJobs.length; i++) {
          const { file, previewUrl } = uploadJobs[i]
          const slot = Math.min(MAX_PRODUCT_IMAGES, next.filter((url) => isPersistableImageUrl(url)).length + 1)
          setUploadProgress(`Requesting upload signature (${i + 1}/${uploadJobs.length})…`)
          const signResult = await requestUploadSign(pid, slot)
          if (!signResult.ok) {
            setUploadError(signResult.message || 'Upload sign failed.')
            break
          }
          const parsedSign = parseUploadSignResponse(signResult.data)
          if (!parsedSign.ok) {
            setUploadError(parsedSign.message)
            break
          }
          setUploadProgress(`Uploading to Cloudinary (${i + 1}/${uploadJobs.length})…`)
          const controller = new AbortController()
          abortRef.current = controller
          const uploadResult = await uploadFileToCloudinary(parsedSign.sign, file, { signal: controller.signal })
          abortRef.current = null
          if (!uploadResult.ok) {
            setUploadError(uploadResult.message)
            break
          }
          if (seen.has(uploadResult.secureUrl)) {
            revokeLocalPreviewUrl(previewUrl)
            localPreviewUrlsRef.current.delete(previewUrl)
            next = next.filter((url) => url !== previewUrl)
            onImagesChange(next)
            continue
          }
          seen.add(uploadResult.secureUrl)
          revokeLocalPreviewUrl(previewUrl)
          localPreviewUrlsRef.current.delete(previewUrl)
          next = next.map((url) => (url === previewUrl ? uploadResult.secureUrl : url))
          onImagesChange(next)

          const persistable = next.filter((url) => isPersistableImageUrl(url))
          if (persistable.length) {
            setUploadProgress(`Saving image ${i + 1} of ${uploadJobs.length} to product…`)
            const saved = await onPersistImages(persistable)
            if (!saved.ok) {
              setUploadError(`Upload succeeded but save failed: ${saved.message}`)
              persistFailed = true
              break
            }
          }
        }

        if (!persistFailed && next.some((url) => isPersistableImageUrl(url))) {
          setUploadProgress(null)
        }
      } catch (err) {
        console.error('[ProductImageManager] image upload failed', err)
        setUploadError(err instanceof Error ? err.message : 'Image upload failed unexpectedly.')
      } finally {
        setUploadProgress(null)
        setReplaceIndex(null)
      }
    }

    setUploading(true)
    uploadRunRef.current = run()
    try {
      await uploadRunRef.current
    } finally {
      uploadRunRef.current = null
      setUploading(false)
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
            Add images
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        id={inputId}
        type="file"
        accept="image/*"
        multiple
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
            const preview = productImageDisplaySrc(src)
            return (
              <li key={`${index}-${src}`} className="admin-image-item">
                <div className="admin-image-item__preview">
                  {preview ? (
                    <img src={preview} alt="" loading="lazy" />
                  ) : (
                    <span className="admin-image-item__placeholder">No preview</span>
                  )}
                  <span className="admin-image-item__slot">{index === 0 ? 'Cover' : `Slot ${index + 1}`}</span>
                </div>
                <p className="admin-image-item__url" title={src}>
                  {src}
                </p>
                <div className="admin-image-item__controls">
                  {index > 0 ? (
                    <button
                      type="button"
                      className="admin-link-button admin-image-item__cover-btn"
                      disabled={busy}
                      onClick={() => setCover(index)}
                    >
                      Set cover
                    </button>
                  ) : null}
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
