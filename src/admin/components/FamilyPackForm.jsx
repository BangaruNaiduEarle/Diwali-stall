import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { getButtonClassName } from '../../components/ui/buttonVariants.js'
import { requestFamilyPackUploadSign } from '../api/adminApi.js'
import { suggestFamilyPackSlugFromName } from '../lib/adminFamilyPackSlug.js'
import {
  MAX_PRODUCT_IMAGES,
  imagePreviewSrc,
  parseUploadSignResponse,
  uploadFileToCloudinary,
} from '../lib/cloudinaryUpload.js'
import {
  createLocalPreviewUrl,
  isLocalPreviewUrl,
  isPersistableFamilyPackImageUrl,
  revokeLocalPreviewUrl,
  snapshotFilesFromInputEvent,
} from '../lib/adminImageUploadFlow.js'
import { buildFamilyPackPayload } from '../lib/adminFamilyPackPayload.js'
import { normalizeAdminProductIdInput } from '../lib/adminFamilyPackFormValidation.js'
import { validateImageUploadFile } from '../lib/validateImageUploadFile.js'

export { buildFamilyPackPayload } from '../lib/adminFamilyPackPayload.js'

function familyPackImageDisplaySrc(url) {
  const s = String(url ?? '').trim()
  if (!s) return ''
  if (isLocalPreviewUrl(s)) return s
  return imagePreviewSrc(s) || s
}

/**
 * @typedef {{
 *   name: string
 *   slug: string
 *   shortDescription: string
 *   sellingPriceInr: string
 *   packLabel: string
 *   sortOrder: string
 *   active: boolean
 *   images: { url: string, sortOrder: number, isCover: boolean }[]
 *   items: { productId: string, quantity: string, unitLabel: string, sortOrder: number }[]
 * }} FamilyPackFormValues
 */

export function emptyFamilyPackFormValues() {
  return {
    name: '',
    slug: '',
    shortDescription: '',
    sellingPriceInr: '',
    packLabel: '',
    sortOrder: '0',
    active: false,
    images: [],
    items: [{ productId: '', quantity: '1', unitLabel: '', sortOrder: 0 }],
  }
}

/** @param {Record<string, unknown>} pack */
export function familyPackToFormValues(pack) {
  return {
    name: String(pack.name ?? ''),
    slug: String(pack.slug ?? ''),
    shortDescription: String(pack.shortDescription ?? ''),
    sellingPriceInr: pack.sellingPriceInr != null ? String(pack.sellingPriceInr) : '',
    packLabel: String(pack.packLabel ?? ''),
    sortOrder: String(pack.sortOrder ?? 0),
    active: Boolean(pack.active),
    images: (pack.images ?? []).map((img, index) => ({
      url: String(img.url ?? ''),
      sortOrder: Number(img.sortOrder ?? index),
      isCover: Boolean(img.isCover),
    })),
    items: (pack.items ?? []).map((row, index) => ({
      productId: String(row.productId ?? ''),
      quantity: String(row.quantity ?? 1),
      unitLabel: String(row.unitLabel ?? ''),
      sortOrder: Number(row.sortOrder ?? index),
    })),
  }
}

/**
 * @param {{
 *   values: FamilyPackFormValues
 *   onChange: (values: FamilyPackFormValues) => void
 *   fieldErrors?: Record<string, string> | null
 *   familyPackId?: string | null
 *   onEnsureFamilyPack: () => Promise<{ ok: true, familyPackId: string } | { ok: false, message: string }>
 *   onPersistImages?: (
 *     images: { url: string, sortOrder: number, isCover: boolean }[],
 *     opts?: { familyPackId?: string, formSnapshot?: FamilyPackFormValues },
 *   ) => Promise<{ ok: true } | { ok: false, message: string }>
 *   onImagesSaved?: () => void
 *   isCreateRoute?: boolean
 *   uploadCoordinatorRef?: { current: { waitUntilIdle: () => Promise<void>, isBusy: () => boolean } | null }
 *   onUploadBusyChange?: (busy: boolean) => void
 *   disabled?: boolean
 * }} props
 */
export default function FamilyPackForm({
  values,
  onChange,
  fieldErrors,
  familyPackId,
  onEnsureFamilyPack,
  onPersistImages,
  onImagesSaved,
  isCreateRoute = false,
  uploadCoordinatorRef,
  onUploadBusyChange,
  disabled = false,
}) {
  const fileRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const localPreviewUrlsRef = useRef(/** @type {Set<string>} */ (new Set()))
  const slugManualRef = useRef(Boolean(familyPackId))
  const valuesRef = useRef(values)
  const uploadRunRef = useRef(/** @type {Promise<void> | null} */ (null))
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(/** @type {string | null} */ (null))
  const [uploadError, setUploadError] = useState(/** @type {string | null} */ (null))
  const [uploadSuccess, setUploadSuccess] = useState(/** @type {string | null} */ (null))
  const inputId = useId()
  const coverGroupId = useId()

  useEffect(() => {
    valuesRef.current = values
  }, [values])

  useEffect(() => {
    if (familyPackId) slugManualRef.current = true
  }, [familyPackId])

  useEffect(() => {
    const busy =
      uploading || values.images.some((img) => String(img.url ?? '').startsWith('blob:'))
    onUploadBusyChange?.(busy)
    if (!uploadCoordinatorRef) return
    uploadCoordinatorRef.current = {
      waitUntilIdle: async () => {
        if (uploadRunRef.current) await uploadRunRef.current
      },
      isBusy: () =>
        uploading ||
        valuesRef.current.images.some((img) => String(img.url ?? '').startsWith('blob:')),
    }
  }, [uploadCoordinatorRef, uploading, values.images, onUploadBusyChange])

  function setField(patch) {
    onChange({ ...values, ...patch })
  }

  function handleNameChange(name) {
    const patch = { name }
    if (!slugManualRef.current && !familyPackId) {
      patch.slug = suggestFamilyPackSlugFromName(name)
    }
    setField(patch)
  }

  function handleSlugChange(slug) {
    slugManualRef.current = true
    setField({ slug })
  }

  function applySuggestedSlug() {
    const suggested = suggestFamilyPackSlugFromName(values.name)
    if (!suggested) return
    slugManualRef.current = true
    setField({ slug: suggested })
  }

  function updateItem(index, patch) {
    const items = values.items.map((row, i) => (i === index ? { ...row, ...patch } : row))
    setField({ items })
  }

  function addItemRow() {
    setField({
      items: [...values.items, { productId: '', quantity: '1', unitLabel: '', sortOrder: values.items.length }],
    })
  }

  function removeItemRow(index) {
    const next = values.items.filter((_, i) => i !== index)
    setField({ items: next.length ? next : [{ productId: '', quantity: '1', unitLabel: '', sortOrder: 0 }] })
  }

  function moveImage(index, direction) {
    const next = [...values.images]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    const normalized = next.map((img, i) => ({ ...img, sortOrder: i }))
    setField({ images: normalized })
    void persistImagesIfNeeded(normalized, familyPackId ?? undefined)
  }

  function setCover(index) {
    const normalized = values.images.map((img, i) => ({ ...img, isCover: i === index }))
    setField({ images: normalized })
    void persistImagesIfNeeded(normalized, familyPackId ?? undefined)
  }

  function normalizeImagesForSave(images) {
    const persistable = images.filter((img) => isPersistableFamilyPackImageUrl(img.url))
    const hasCover = persistable.some((img) => img.isCover)
    return persistable.map((img, index) => ({
      url: img.url,
      sortOrder: index,
      isCover: hasCover ? Boolean(img.isCover) : index === 0,
    }))
  }

  async function persistUploadedImages(nextImages, persistPackId) {
    if (!onPersistImages || !nextImages.length) return { ok: true }
    const id = persistPackId ?? familyPackId ?? undefined
    const formSnapshot = { ...valuesRef.current, images: nextImages }
    const saved = await onPersistImages(normalizeImagesForSave(nextImages), {
      familyPackId: id,
      formSnapshot,
    })
    if (!saved.ok) setUploadError(`Save failed: ${saved.message}`)
    return saved
  }

  async function persistImagesIfNeeded(nextImages, persistPackId) {
    await persistUploadedImages(nextImages, persistPackId)
  }

  function removeImage(index) {
    const removed = values.images[index]
    revokeLocalPreviewUrl(removed?.url)
    localPreviewUrlsRef.current.delete(removed?.url)
    const next = values.images.filter((_, i) => i !== index)
    if (next.length && !next.some((img) => img.isCover)) next[0].isCover = true
    const normalized = next.map((img, i) => ({ ...img, sortOrder: i }))
    setField({ images: normalized })
    void persistImagesIfNeeded(normalized, familyPackId ?? undefined)
  }

  useEffect(() => {
    const urls = localPreviewUrlsRef.current
    return () => {
      for (const url of urls) revokeLocalPreviewUrl(url)
      urls.clear()
    }
  }, [])

  async function handleImageFile(e) {
    const pickedFiles = snapshotFilesFromInputEvent(e)
    if (!pickedFiles.length || disabled || uploading) {
      if (!pickedFiles.length && !disabled && !uploading) {
        setUploadError('No files were captured from the file picker. Try again.')
      }
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
      setUploadSuccess(null)
      setUploadProgress('Showing local preview…')
      const initialPersistedCount = valuesRef.current.images.filter((img) =>
        isPersistableFamilyPackImageUrl(img.url),
      ).length

      let nextImages = [...valuesRef.current.images]
      /** @type {{ file: File, previewUrl: string, imageIndex: number }[]} */
      const uploadJobs = []

      for (const file of validFiles) {
        if (nextImages.length >= MAX_PRODUCT_IMAGES) {
          setUploadError(`Maximum ${MAX_PRODUCT_IMAGES} images allowed.`)
          break
        }
        const previewUrl = createLocalPreviewUrl(file)
        localPreviewUrlsRef.current.add(previewUrl)
        const isFirst = nextImages.length === 0
        const imageIndex = nextImages.length
        nextImages = [
          ...nextImages,
          { url: previewUrl, sortOrder: imageIndex, isCover: isFirst && !nextImages.some((img) => img.isCover) },
        ]
        uploadJobs.push({ file, previewUrl, imageIndex })
      }
      setField({ images: nextImages })

      try {
        setUploadProgress('Preparing family pack…')
        const ensured = await onEnsureFamilyPack()
        if (!ensured.ok) {
          setUploadError(ensured.message)
          return
        }

        const uploadFamilyPackId = ensured.familyPackId

        const existingUrls = new Set(
          nextImages.map((img) => img.url).filter((url) => isPersistableFamilyPackImageUrl(url)),
        )

        let persistedAny = false
        let persistFailed = false

        for (let i = 0; i < uploadJobs.length; i++) {
          const { file, previewUrl } = uploadJobs[i]
          const slot = Math.min(
            MAX_PRODUCT_IMAGES,
            nextImages.filter((img) => isPersistableFamilyPackImageUrl(img.url)).length + 1,
          )
          setUploadProgress(`Requesting upload signature (${i + 1}/${uploadJobs.length})…`)
          const signResult = await requestFamilyPackUploadSign(uploadFamilyPackId, slot)
          if (!signResult.ok) {
            setUploadError(signResult.message || 'Cloudinary is not configured or upload sign failed.')
            break
          }
          const parsed = parseUploadSignResponse(signResult.data)
          if (!parsed.ok) {
            setUploadError(parsed.message)
            break
          }
          setUploadProgress(`Uploading to Cloudinary (${i + 1}/${uploadJobs.length})…`)
          const upload = await uploadFileToCloudinary(parsed.sign, file)
          if (!upload.ok) {
            setUploadError(upload.message)
            break
          }
          if (existingUrls.has(upload.secureUrl)) {
            revokeLocalPreviewUrl(previewUrl)
            nextImages = nextImages.filter((img) => img.url !== previewUrl)
            setField({ images: nextImages.map((img, idx) => ({ ...img, sortOrder: idx })) })
            continue
          }
          existingUrls.add(upload.secureUrl)
          revokeLocalPreviewUrl(previewUrl)
          localPreviewUrlsRef.current.delete(previewUrl)
          nextImages = nextImages.map((img, idx) => {
            if (img.url !== previewUrl) return { ...img, sortOrder: idx }
            return { url: upload.secureUrl, sortOrder: idx, isCover: img.isCover }
          })
          setField({ images: nextImages })

          setUploadProgress(`Saving image ${i + 1} of ${uploadJobs.length} to family pack…`)
          const saved = await persistUploadedImages(nextImages, uploadFamilyPackId)
          if (!saved.ok) {
            persistFailed = true
            break
          }
          persistedAny = true
        }

        const persistedCount = nextImages.filter((img) => isPersistableFamilyPackImageUrl(img.url)).length
        if (persistFailed) {
          // persistUploadedImages already set uploadError
        } else if (persistedAny && persistedCount > initialPersistedCount) {
          setUploadSuccess('Images uploaded to Cloudinary and saved.')
          onImagesSaved?.()
        } else if (persistedCount > initialPersistedCount && !onPersistImages) {
          setUploadError('Images uploaded to Cloudinary but were not saved to this pack. Try again or save from edit.')
        }
      } catch (err) {
        console.error('[FamilyPackForm] image upload failed', err)
        setUploadError(err instanceof Error ? err.message : 'Image upload failed unexpectedly.')
      } finally {
        setUploadProgress(null)
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

  const uploadBusy = disabled || uploading
  const atMaxImages = values.images.length >= MAX_PRODUCT_IMAGES
  const uploadTriggerClass = getButtonClassName({
    variant: 'secondary',
    size: 'sm',
    className: `inline-flex cursor-pointer${uploadBusy || atMaxImages ? ' pointer-events-none opacity-50' : ''}`,
  })

  const err = (key) => fieldErrors?.[key]

  /** @param {string | undefined} fieldKey @param {string} [extra] */
  function fieldControlClass(fieldKey, extra = '') {
    const parts = ['admin-field__input']
    if (extra) parts.push(extra)
    if (fieldKey && err(fieldKey)) parts.push('admin-field__input--invalid')
    return parts.join(' ')
  }

  const suggestedSlug = suggestFamilyPackSlugFromName(values.name)
  const hasFilledItems = values.items.some((row) => row.productId.trim())
  const showItemsEmpty = !hasFilledItems

  return (
    <form className="admin-form admin-form--sections" onSubmit={(e) => e.preventDefault()} noValidate>
      <section className="admin-form__section" aria-labelledby="fp-basic-heading">
        <div className="admin-form__section-head">
          <span className="admin-form__section-index">Section 1</span>
          <h2 id="fp-basic-heading" className="admin-form__section-title">
            Basic information
          </h2>
        </div>
        <p className="admin-form__section-desc">How this pack appears on the public site — name, URL, and short summary.</p>
        <div className="admin-form__grid">
          <label className="admin-field">
            <span className="admin-field__label">
              Family pack name <span className="admin-field__label-required" aria-hidden="true">*</span>
            </span>
            <input
              className={fieldControlClass('name')}
              value={values.name}
              disabled={disabled}
              aria-required="true"
              aria-invalid={Boolean(err('name'))}
              autoComplete="off"
              onChange={(e) => handleNameChange(e.target.value)}
            />
            {err('name') ? <span className="admin-field__error">{err('name')}</span> : null}
          </label>

          <div className="admin-field">
            <span className="admin-field__label" id={`${inputId}-slug-label`}>
              URL slug <span className="admin-field__label-required" aria-hidden="true">*</span>
            </span>
            <input
              className={fieldControlClass('slug')}
              value={values.slug}
              disabled={disabled}
              aria-labelledby={`${inputId}-slug-label`}
              aria-describedby={`${inputId}-slug-hint`}
              aria-invalid={Boolean(err('slug'))}
              autoComplete="off"
              onChange={(e) => handleSlugChange(e.target.value)}
            />
            <p className="admin-field__hint" id={`${inputId}-slug-hint`}>
              Used in the public URL <code className="text-xs">/packs/your-slug</code>. Lowercase letters, numbers, and
              hyphens. Leave blank on create to derive from the pack name when you save.
            </p>
            {suggestedSlug && values.slug !== suggestedSlug && !familyPackId ? (
              <button type="button" className="admin-link-button text-sm" disabled={disabled} onClick={applySuggestedSlug}>
                Use suggested slug: {suggestedSlug}
              </button>
            ) : null}
            {err('slug') ? <span className="admin-field__error">{err('slug')}</span> : null}
          </div>

          <label className="admin-field admin-field--full">
            <span className="admin-field__label">Description</span>
            <textarea
              className={`${fieldControlClass('shortDescription')} admin-field__input--textarea`}
              value={values.shortDescription}
              disabled={disabled}
              aria-invalid={Boolean(err('shortDescription'))}
              onChange={(e) => setField({ shortDescription: e.target.value })}
            />
            <p className="admin-field__hint">Optional. Shown on pack cards and the pack detail page.</p>
            {err('shortDescription') ? <span className="admin-field__error">{err('shortDescription')}</span> : null}
          </label>
        </div>
      </section>

      <section className="admin-form__section" aria-labelledby="fp-pricing-heading">
        <div className="admin-form__section-head">
          <span className="admin-form__section-index">Section 2</span>
          <h2 id="fp-pricing-heading" className="admin-form__section-title">
            Pricing &amp; availability
          </h2>
        </div>
        <p className="admin-form__section-desc">Storefront selling price, list order, and whether customers can add this pack to an estimate.</p>
        <div className="admin-form__grid">
          <label className="admin-field">
            <span className="admin-field__label">
              Selling price (INR) <span className="admin-field__label-required" aria-hidden="true">*</span>
            </span>
            <div className="admin-field__input-prefix-wrap">
              <span className="admin-field__input-prefix" aria-hidden="true">
                ₹
              </span>
              <input
                className={fieldControlClass('sellingPriceInr')}
                inputMode="decimal"
                value={values.sellingPriceInr}
                disabled={disabled}
                aria-required="true"
                aria-invalid={Boolean(err('sellingPriceInr'))}
                onChange={(e) => setField({ sellingPriceInr: e.target.value })}
              />
            </div>
            <p className="admin-field__hint">Whole rupees or decimals (e.g. 499 or 499.50).</p>
            {err('sellingPriceInr') ? <span className="admin-field__error">{err('sellingPriceInr')}</span> : null}
          </label>

          <label className="admin-field">
            <span className="admin-field__label">Display order</span>
            <input
              className={fieldControlClass('sortOrder')}
              inputMode="numeric"
              value={values.sortOrder}
              disabled={disabled}
              aria-invalid={Boolean(err('sortOrder'))}
              onChange={(e) => setField({ sortOrder: e.target.value })}
            />
            <p className="admin-field__hint">Lower numbers appear first in admin and public lists.</p>
            {err('sortOrder') ? <span className="admin-field__error">{err('sortOrder')}</span> : null}
          </label>

          <label className="admin-field">
            <span className="admin-field__label">Pack label</span>
            <input
              className={fieldControlClass(undefined)}
              value={values.packLabel}
              disabled={disabled}
              onChange={(e) => setField({ packLabel: e.target.value })}
            />
            <p className="admin-field__hint">Optional badge such as Budget or Popular.</p>
          </label>

          <fieldset className="admin-field admin-field--radio-group" disabled={disabled}>
            <legend className="admin-field__label">Active / inactive on public site</legend>
            <p className="admin-field__hint admin-field__hint--tight">
              Controls whether this pack appears in the public catalogue and can be added to new estimates.
            </p>
            <div className="admin-field__radio-row admin-field__radio-row--cards">
              <label className="admin-field__radio-option admin-field__radio-option--card">
                <input
                  type="radio"
                  name={`${inputId}-active`}
                  checked={values.active === true}
                  onChange={() => setField({ active: true })}
                />
                <span className="admin-field__radio-option__body">
                  <strong>Active</strong>
                  <span className="admin-field__radio-option__detail">
                    Visible on the storefront; customers can browse and add this pack to estimates.
                  </span>
                </span>
              </label>
              <label className="admin-field__radio-option admin-field__radio-option--card">
                <input
                  type="radio"
                  name={`${inputId}-active`}
                  checked={values.active === false}
                  onChange={() => setField({ active: false })}
                />
                <span className="admin-field__radio-option__body">
                  <strong>Inactive</strong>
                  <span className="admin-field__radio-option__detail">
                    Hidden from the catalogue. Existing estimate lines that already include this pack are unchanged.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        </div>
      </section>

      <section className="admin-form__section" aria-labelledby="fp-images-heading">
        <div className="admin-form__section-head">
          <span className="admin-form__section-index">Section 3</span>
          <h2 id="fp-images-heading" className="admin-form__section-title">
            Images
          </h2>
        </div>
        <p className="admin-form__section-desc">
          Upload one or more JPEG/PNG images. Files upload to <strong>Cloudinary</strong> after you select them. Mark one
          image as the cover; drag order with the move buttons. Up to {MAX_PRODUCT_IMAGES} images.
        </p>
        {isCreateRoute && !familyPackId ? (
          <p className="admin-field__hint mb-3">
            Before the first upload, enter <strong>name</strong> and <strong>selling price (INR)</strong>. A draft pack is
            created automatically; included items can be added before you save or activate the pack.
          </p>
        ) : null}

        {uploadError ? (
          <p className="admin-field__error" role="alert">
            {uploadError}
          </p>
        ) : null}
        {uploadSuccess ? (
          <p className="admin-hint admin-hint--success mb-3" role="status">
            {uploadSuccess}
          </p>
        ) : null}
        {uploadProgress ? (
          <p className="mb-3 flex items-center gap-2 text-sm text-[var(--color-muted)]" aria-live="polite">
            <Loader2 className="animate-spin" size={16} aria-hidden="true" />
            {uploadProgress}
          </p>
        ) : null}

        {values.images.length === 0 ? (
          <p className="admin-form__empty">No images yet. Use Upload images to add pack photos.</p>
        ) : (
          <ul className="admin-fp-image-list">
            {values.images.map((img, index) => {
              const pending = isLocalPreviewUrl(img.url)
              const saved = isPersistableFamilyPackImageUrl(img.url)
              return (
                <li
                  key={`${img.url}-${index}`}
                  className={`admin-fp-image-row${pending ? ' admin-fp-image-row--pending' : ''}`}
                >
                  <img src={familyPackImageDisplaySrc(img.url)} alt="" className="admin-fp-image-row__thumb" />
                  <div className="min-w-0">
                    <div className="admin-fp-image-row__badges">
                      {img.isCover ? <span className="admin-fp-image-badge admin-fp-image-badge--cover">Cover</span> : null}
                      {pending ? (
                        <span className="admin-fp-image-badge admin-fp-image-badge--pending">Pending upload</span>
                      ) : null}
                      {saved ? <span className="admin-fp-image-badge admin-fp-image-badge--saved">Saved</span> : null}
                    </div>
                    <p className="admin-fp-image-row__url">{pending ? 'Local preview only' : img.url}</p>
                    <label className="admin-fp-image-row__cover-label">
                      <input
                        type="radio"
                        name={coverGroupId}
                        checked={img.isCover}
                        disabled={disabled || pending}
                        onChange={() => setCover(index)}
                      />
                      Set as cover image
                    </label>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      className="admin-icon-btn"
                      disabled={disabled || index === 0}
                      aria-label="Move image up"
                      onClick={() => moveImage(index, -1)}
                    >
                      <ChevronUp size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="admin-icon-btn"
                      disabled={disabled || index === values.images.length - 1}
                      aria-label="Move image down"
                      onClick={() => moveImage(index, 1)}
                    >
                      <ChevronDown size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="admin-icon-btn"
                      disabled={disabled}
                      aria-label="Remove image"
                      onClick={() => removeImage(index)}
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <input
          id={inputId}
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          disabled={uploadBusy || atMaxImages}
          onChange={handleImageFile}
        />
        <label htmlFor={inputId} className={uploadTriggerClass}>
          {uploading ? (
            <Loader2 className="ui-btn__icon animate-spin" width={16} height={16} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <ImagePlus className="ui-btn__icon shrink-0" width={16} height={16} strokeWidth={1.8} aria-hidden="true" />
          )}
          <span className="ui-btn__label">{uploading ? 'Uploading…' : 'Upload images'}</span>
        </label>
        {familyPackId && values.slug ? (
          <p className="admin-field__hint mt-2">
            Public page:{' '}
            <a className="font-medium text-[var(--color-maroon)] underline" href={`/packs/${values.slug}`} target="_blank" rel="noreferrer">
              /packs/{values.slug}
            </a>
          </p>
        ) : null}
      </section>

      <section className="admin-form__section" aria-labelledby="fp-items-heading">
        <div className="admin-form__section-head">
          <span className="admin-form__section-index">Section 4</span>
          <h2 id="fp-items-heading" className="admin-form__section-title">
            Included items
          </h2>
        </div>
        <p className="admin-form__section-desc">
          Catalogue products inside this pack (for customer information). Estimates bill one line for the whole pack — these
          rows are not separate estimate lines.
        </p>
        {err('items') ? <p className="admin-field__error">{err('items')}</p> : null}
        {showItemsEmpty ? (
          <p className="admin-form__empty">
            No included items yet. Add at least one row with a catalogue product ID (e.g. P042), quantity, and optional
            unit label.
          </p>
        ) : null}

        <div className="admin-fp-item-table-wrap">
          <table className="admin-fp-item-table">
            <thead>
              <tr>
                <th scope="col">Product ID</th>
                <th scope="col">Quantity</th>
                <th scope="col">Unit</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {values.items.map((row, index) => {
                const pid = row.productId.trim()
                const productFieldKey = `items[${index}].productId`
                const qtyFieldKey = `items[${index}].quantity`
                const unitFieldKey = `items[${index}].unitLabel`
                return (
                  <tr key={index}>
                    <td data-label="Product ID">
                      <div className="admin-fp-item-field">
                        <label className="admin-fp-item-field__label admin-field__label" htmlFor={`${inputId}-item-${index}-pid`}>
                          Product ID <span className="admin-field__label-required" aria-hidden="true">*</span>
                        </label>
                        <input
                          id={`${inputId}-item-${index}-pid`}
                          className={`${fieldControlClass(productFieldKey)} admin-field__input--product-id`}
                          value={row.productId}
                          disabled={disabled}
                          placeholder="Enter product ID (e.g. P042)"
                          autoComplete="off"
                          spellCheck={false}
                          aria-required="true"
                          aria-invalid={Boolean(err(productFieldKey))}
                          onChange={(e) => updateItem(index, { productId: e.target.value })}
                          onBlur={(e) => {
                            const normalized = normalizeAdminProductIdInput(e.target.value)
                            if (normalized !== e.target.value.trim()) {
                              updateItem(index, { productId: normalized })
                            }
                          }}
                        />
                        {err(productFieldKey) ? (
                          <span className="admin-field__error">{err(productFieldKey)}</span>
                        ) : !pid ? (
                          <span className="admin-field__hint admin-field__hint--tight">Catalogue id from Products admin.</span>
                        ) : null}
                      </div>
                    </td>
                    <td data-label="Quantity">
                      <div className="admin-fp-item-field">
                        <label className="admin-fp-item-field__label admin-field__label" htmlFor={`${inputId}-item-${index}-qty`}>
                          Quantity <span className="admin-field__label-required" aria-hidden="true">*</span>
                        </label>
                        <input
                          id={`${inputId}-item-${index}-qty`}
                          className={`${fieldControlClass(qtyFieldKey)} admin-field__input--qty`}
                          inputMode="numeric"
                          value={row.quantity}
                          disabled={disabled}
                          placeholder="1"
                          aria-required="true"
                          aria-invalid={Boolean(err(qtyFieldKey))}
                          onChange={(e) => updateItem(index, { quantity: e.target.value })}
                        />
                        {err(qtyFieldKey) ? <span className="admin-field__error">{err(qtyFieldKey)}</span> : null}
                      </div>
                    </td>
                    <td data-label="Unit">
                      <div className="admin-fp-item-field">
                        <label className="admin-fp-item-field__label admin-field__label" htmlFor={`${inputId}-item-${index}-unit`}>
                          Unit
                        </label>
                        <input
                          id={`${inputId}-item-${index}-unit`}
                          className={fieldControlClass(unitFieldKey)}
                          value={row.unitLabel}
                          disabled={disabled}
                          placeholder="e.g. box, pkt"
                          aria-invalid={Boolean(err(unitFieldKey))}
                          onChange={(e) => updateItem(index, { unitLabel: e.target.value })}
                        />
                        {err(unitFieldKey) ? <span className="admin-field__error">{err(unitFieldKey)}</span> : null}
                      </div>
                    </td>
                    <td data-label="Remove" className="admin-fp-item-table__remove">
                      <button
                        type="button"
                        className="admin-icon-btn admin-icon-btn--danger admin-fp-item-table__remove-btn"
                        disabled={disabled || (values.items.length <= 1 && !pid)}
                        aria-label={`Remove included item row ${index + 1}`}
                        title="Remove item"
                        onClick={() => removeItemRow(index)}
                      >
                        <Trash2 size={18} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="secondary" size="sm" className="mt-3" icon={Plus} disabled={disabled} onClick={addItemRow}>
          Add item
        </Button>
      </section>
    </form>
  )
}
