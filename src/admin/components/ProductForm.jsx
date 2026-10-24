import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import ProductImageManager from './ProductImageManager.jsx'
import { isLocalPreviewUrl } from '../lib/adminImageUploadFlow.js'
import { MAX_PRODUCT_IMAGES } from '../lib/cloudinaryUpload.js'
import { buildProductPayload } from '../lib/adminProductBuildPayload.js'

export { buildProductPayload } from '../lib/adminProductBuildPayload.js'

const STOCK_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'soldout', label: 'Sold out' },
  { value: 'sold-out', label: 'Sold out (legacy)' },
]

const PRODUCT_ID_RE = /^P\d{3,}$/

/**
 * @param {{
 *   mode: 'create' | 'edit',
 *   initial: import('../components/ProductForm.jsx').ProductFormValues,
 *   categories: { slug: string, label: string }[],
 *   submitting: boolean,
 *   serverError: string | null,
 *   serverFields: Record<string, string> | null,
 *   onSubmit: (values: import('../components/ProductForm.jsx').ProductFormValues) => void,
 *   onCancel: () => void,
 *   resolvedProductId: string | null,
 *   onEnsureProduct: (values: import('../components/ProductForm.jsx').ProductFormValues) => Promise<{ ok: true, productId: string } | { ok: false, message: string }>,
 *   onPersistImages: (images: string[], values: import('../components/ProductForm.jsx').ProductFormValues) => Promise<
 *     { ok: true, images?: string[] } | { ok: false, message: string }
 *   >,
 *   uploadCoordinatorRef?: { current: { waitUntilIdle: () => Promise<void>, isBusy: () => boolean } | null },
 *   onUploadBusyChange?: (busy: boolean) => void,
 *   showSensitiveColumns?: boolean,
 *   initialRevision?: number,
 * }} props
 */
export default function ProductForm({
  mode,
  initial,
  initialRevision = 0,
  categories,
  submitting,
  serverError,
  serverFields,
  onSubmit,
  onCancel,
  resolvedProductId,
  onEnsureProduct,
  onPersistImages,
  uploadCoordinatorRef,
  onUploadBusyChange,
  showSensitiveColumns = false,
}) {
  const [values, setValues] = useState(initial)
  const [clientErrors, setClientErrors] = useState(/** @type {Record<string, string>} */ ({}))
  const [showManualImages, setShowManualImages] = useState(false)

  useEffect(() => {
    if (mode !== 'edit' || initialRevision <= 0) return
    setValues(initial)
    setClientErrors({})
  }, [mode, initial, initialRevision])

  const fieldError = useMemo(() => {
    /** @type {Record<string, string>} */
    const merged = { ...clientErrors }
    if (serverFields) {
      for (const [k, v] of Object.entries(serverFields)) {
        merged[k] = v
      }
    }
    return merged
  }, [clientErrors, serverFields])

  function setField(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setClientErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function setImages(images) {
    setValues((prev) => ({ ...prev, images }))
    setClientErrors((prev) => {
      if (!prev.images) return prev
      const next = { ...prev }
      delete next.images
      return next
    })
  }

  function validate() {
    /** @type {Record<string, string>} */
    const errors = {}
    if (mode === 'create') {
      const id = String(values.id ?? '').trim()
      if (!PRODUCT_ID_RE.test(id)) errors.id = 'Product id must look like P001.'
    }
    if (!String(values.name ?? '').trim()) errors.name = 'Name is required.'
    if (!String(values.categorySlug ?? '').trim()) errors.categorySlug = 'Category is required.'
    const sort = Number(values.sortOrder)
    if (!Number.isFinite(sort)) errors.sortOrder = 'Sort order must be a number.'
    const images = values.images ?? []
    if (images.length > MAX_PRODUCT_IMAGES) errors.images = `Maximum ${MAX_PRODUCT_IMAGES} images.`
    for (const img of images) {
      const s = String(img).trim()
      if (!s) {
        errors.images = 'Image paths cannot be empty.'
        break
      }
      if (isLocalPreviewUrl(s)) {
        errors.images = 'Images are still uploading. Wait for uploads to finish before saving.'
        break
      }
    }
    setClientErrors(errors)
    return Object.keys(errors).length === 0
  }

  function normalizedValues() {
    return {
      ...values,
      id: String(values.id ?? '').trim(),
      name: String(values.name).trim(),
      categorySlug: String(values.categorySlug).trim(),
      company: String(values.company ?? '').trim(),
      pack: String(values.pack ?? '').trim(),
      description: String(values.description ?? '').trim(),
      sortOrder: Number(values.sortOrder) || 0,
      images: [...(values.images ?? [])],
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    onSubmit(normalizedValues())
  }

  async function handleEnsureProduct() {
    return onEnsureProduct(normalizedValues())
  }

  async function handlePersistImages(images) {
    const result = await onPersistImages(images, normalizedValues())
    if (result.ok && Array.isArray(result.images)) {
      setImages(result.images.map(String))
    }
    return result
  }

  function applyManualImages(text) {
    const lines = String(text ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    setImages(lines.slice(0, MAX_PRODUCT_IMAGES))
  }

  const formDisabled = submitting

  return (
    <form className="admin-form" onSubmit={handleSubmit} noValidate>
      {serverError ? (
        <div className="admin-alert admin-alert--error" role="alert">
          {serverError}
        </div>
      ) : null}

      {mode === 'create' ? (
        <div className="admin-field">
          <label className="admin-label" htmlFor="product-id">
            Product ID
          </label>
          <input
            id="product-id"
            className="admin-input"
            value={values.id}
            onChange={(e) => setField('id', e.target.value)}
            placeholder="P165"
            autoComplete="off"
            disabled={formDisabled}
          />
          {fieldError.id ? <p className="admin-field-error">{fieldError.id}</p> : null}
        </div>
      ) : (
        <div className="admin-field">
          <span className="admin-label">Product ID</span>
          <p className="admin-readonly">{values.id}</p>
        </div>
      )}

      <div className="admin-field">
        <label className="admin-label" htmlFor="product-name">
          Name
        </label>
        <input
          id="product-name"
          className="admin-input"
          value={values.name}
          onChange={(e) => setField('name', e.target.value)}
          maxLength={200}
          disabled={formDisabled}
          required
        />
        {fieldError.name ? <p className="admin-field-error">{fieldError.name}</p> : null}
      </div>

      <div className="admin-field">
        <label className="admin-label" htmlFor="product-category">
          Category
        </label>
        <select
          id="product-category"
          className="admin-input"
          value={values.categorySlug}
          onChange={(e) => setField('categorySlug', e.target.value)}
          disabled={formDisabled || categories.length === 0}
        >
          <option value="">Select category…</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label} ({c.slug})
            </option>
          ))}
        </select>
        {fieldError.categorySlug ? <p className="admin-field-error">{fieldError.categorySlug}</p> : null}
      </div>

      <div className="admin-field">
        <label className="admin-label" htmlFor="product-company">
          Company
        </label>
        <input
          id="product-company"
          className="admin-input"
          value={values.company ?? ''}
          onChange={(e) => setField('company', e.target.value)}
          maxLength={120}
          disabled={formDisabled}
          placeholder="Optional manufacturer / brand"
          autoComplete="organization"
        />
        {fieldError.company ? <p className="admin-field-error">{fieldError.company}</p> : null}
      </div>

      {showSensitiveColumns ? (
        <div className="admin-form__row">
          <div className="admin-field">
            <label className="admin-label" htmlFor="product-purchase-rate">
              Purchase rate — Excel Rate (INR)
            </label>
            <input
              id="product-purchase-rate"
              type="number"
              min="0"
              step="0.01"
              className="admin-input"
              value={values.purchaseRateInr ?? ''}
              onChange={(e) => setField('purchaseRateInr', e.target.value)}
              disabled={formDisabled}
              placeholder={values.hasPurchaseRate ? '' : 'Missing — set purchase rate'}
            />
            {fieldError.purchaseRateInr ? <p className="admin-field-error">{fieldError.purchaseRateInr}</p> : null}
            {mode === 'edit' && !values.hasPurchaseRate ? (
              <p className="admin-hint admin-hint--warn">No purchase rate stored in D1 yet.</p>
            ) : null}
          </div>
          <div className="admin-field">
            <label className="admin-label" htmlFor="product-selling-price">
              Selling Price (INR)
            </label>
            <input
              id="product-selling-price"
              type="number"
              min="0"
              step="0.01"
              className="admin-input"
              value={values.sellingPriceInr ?? ''}
              onChange={(e) => setField('sellingPriceInr', e.target.value)}
              disabled={formDisabled}
              placeholder={values.hasSellingPrice ? '' : 'Missing — set selling price'}
            />
            {fieldError.sellingPriceInr ? <p className="admin-field-error">{fieldError.sellingPriceInr}</p> : null}
            {mode === 'edit' && !values.hasSellingPrice ? (
              <p className="admin-hint admin-hint--warn">No selling price stored in D1 yet.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="admin-form__row">
        <div className="admin-field">
          <label className="admin-label" htmlFor="product-pack">
            Pack
          </label>
          <input
            id="product-pack"
            className="admin-input"
            value={values.pack}
            onChange={(e) => setField('pack', e.target.value)}
            maxLength={120}
            disabled={formDisabled}
          />
        </div>
        <div className="admin-field">
          <label className="admin-label" htmlFor="product-sort">
            Sort order
          </label>
          <input
            id="product-sort"
            type="number"
            className="admin-input"
            value={values.sortOrder}
            onChange={(e) => setField('sortOrder', e.target.value)}
            disabled={formDisabled}
          />
          {fieldError.sortOrder ? <p className="admin-field-error">{fieldError.sortOrder}</p> : null}
        </div>
      </div>

      <div className="admin-field">
        <label className="admin-label" htmlFor="product-description">
          Description
        </label>
        <textarea
          id="product-description"
          className="admin-input admin-textarea"
          value={values.description}
          onChange={(e) => setField('description', e.target.value)}
          maxLength={2000}
          rows={4}
          disabled={formDisabled}
        />
        {fieldError.description ? <p className="admin-field-error">{fieldError.description}</p> : null}
      </div>

      <div className="admin-field">
        <label className="admin-label" htmlFor="product-stock">
          Stock status
        </label>
        <select
          id="product-stock"
          className="admin-input"
          value={values.stockStatus}
          onChange={(e) => setField('stockStatus', e.target.value)}
          disabled={formDisabled}
        >
          {STOCK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {fieldError.stockStatus ? <p className="admin-field-error">{fieldError.stockStatus}</p> : null}
      </div>

      <div className="admin-form__checks">
        <label className="admin-check">
          <input
            type="checkbox"
            checked={Boolean(values.featured)}
            onChange={(e) => setField('featured', e.target.checked)}
            disabled={formDisabled}
          />
          Featured on catalogue
        </label>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={Boolean(values.active)}
            onChange={(e) => setField('active', e.target.checked)}
            disabled={formDisabled}
          />
          Active (visible on public site)
        </label>
      </div>

      <ProductImageManager
        productId={resolvedProductId}
        images={values.images ?? []}
        onImagesChange={setImages}
        disabled={formDisabled}
        onEnsureProduct={handleEnsureProduct}
        onPersistImages={handlePersistImages}
        uploadCoordinatorRef={uploadCoordinatorRef}
        onUploadBusyChange={onUploadBusyChange}
      />
      {fieldError.images ? <p className="admin-field-error">{fieldError.images}</p> : null}

      <div className="admin-field">
        <button
          type="button"
          className="admin-link-button"
          onClick={() => setShowManualImages((v) => !v)}
          disabled={formDisabled}
        >
          {showManualImages ? 'Hide manual path editor' : 'Edit image paths manually'}
        </button>
        {showManualImages ? (
          <>
            <p className="admin-hint">One local path or HTTPS URL per line. Does not upload files.</p>
            <textarea
              className="admin-input admin-textarea admin-textarea--mono"
              defaultValue={(values.images ?? []).join('\n')}
              rows={5}
              disabled={formDisabled}
              onBlur={(e) => applyManualImages(e.target.value)}
            />
          </>
        ) : null}
      </div>

      <div className="admin-form__actions">
        <Button type="button" variant="secondary" surface="light" disabled={formDisabled} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" surface="light" loading={submitting} disabled={formDisabled}>
          {submitting
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving changes…'
            : mode === 'create'
              ? 'Create product'
              : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

/**
 * @typedef {Object} ProductFormValues
 * @property {string} id
 * @property {string} categorySlug
 * @property {string} name
 * @property {string} company
 * @property {string} pack
 * @property {string} description
 * @property {boolean} featured
 * @property {string} stockStatus
 * @property {boolean} active
 * @property {number | string} sortOrder
 * @property {string[]} images
 */

/** @param {Record<string, unknown>} product */
export function productToFormValues(product) {
  const images = Array.isArray(product.images)
    ? product.images.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : []
  return {
    id: String(product.id ?? ''),
    categorySlug: String(product.categorySlug ?? ''),
    name: String(product.name ?? ''),
    company: String(product.company ?? ''),
    pack: String(product.pack ?? ''),
    description: String(product.description ?? ''),
    featured: Boolean(product.featured),
    stockStatus: String(product.stockStatus ?? 'available'),
    active: product.active !== false,
    sortOrder: Number(product.sortOrder) || 0,
    images,
    purchaseRateInr: product.purchaseRateInr != null ? String(product.purchaseRateInr) : '',
    hasPurchaseRate: product.hasPurchaseRate === true,
    sellingPriceInr: product.sellingPriceInr != null ? String(product.sellingPriceInr) : '',
    hasSellingPrice:
      product.hasSellingPrice === true ||
      (Number.isFinite(Number(product.sellingPriceInr)) && Number(product.sellingPriceInr) > 0),
  }
}

export function emptyProductFormValues() {
  return {
    id: '',
    categorySlug: '',
    name: '',
    company: '',
    pack: '',
    description: '',
    featured: false,
    stockStatus: 'available',
    active: true,
    sortOrder: 0,
    images: [],
    purchaseRateInr: '',
    hasPurchaseRate: false,
    sellingPriceInr: '',
    hasSellingPrice: false,
  }
}

/** @param {import('../components/ProductForm.jsx').ProductFormValues} values */
export function getPurchaseRateInrFromForm(values) {
  if (values.purchaseRateInr === undefined || values.purchaseRateInr === '') return null
  return Number(values.purchaseRateInr)
}

/**
 * @param {string | number | null | undefined} initialInr
 * @param {string | number | null | undefined} formInr
 */
export function adminRateFieldChanged(initialInr, formInr) {
  if (formInr === undefined || formInr === '') return false
  const next = Number(formInr)
  if (!Number.isFinite(next)) return false
  if (initialInr === null || initialInr === undefined || initialInr === '') return true
  const prev = Number(initialInr)
  if (!Number.isFinite(prev)) return true
  return Math.round(prev * 100) !== Math.round(next * 100)
}
