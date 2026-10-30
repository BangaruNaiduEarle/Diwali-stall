import { useEffect, useRef, useState } from 'react'
import { assertProductSaveNotBlockedByImages } from '../lib/adminProductImageSave.js'
import { Link, useNavigate } from 'react-router-dom'
import {
  createAdminProduct,
  fetchAdminCategories,
  updateAdminProduct,
  updateAdminPurchaseRate,
} from '../api/adminApi.js'
import ProductForm, {
  adminRateFieldChanged,
  buildProductPayload,
  emptyProductFormValues,
  getPurchaseRateInrFromForm,
} from '../components/ProductForm.jsx'
import { adminNavigationFlashState } from '../lib/adminNavigationFlash.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { showAdminProductSensitiveColumns } from '../lib/adminProductTableColumns.js'

const PRODUCT_ID_RE = /^P\d{3,}$/

const backToProductsClassName =
  'focus-ring inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-maroon)] hover:text-[var(--color-maroon-deep)] hover:underline'

export default function AdminProductCreatePage() {
  const { role } = useAdminSession()
  const showSensitiveColumns = showAdminProductSensitiveColumns(role)
  const navigate = useNavigate()
  const [categories, setCategories] = useState(/** @type {{ slug: string, label: string }[]} */ ([]))
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [categoryError, setCategoryError] = useState(/** @type {string | null} */ (null))
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState(/** @type {string | null} */ (null))
  const [serverFields, setServerFields] = useState(/** @type {Record<string, string> | null} */ (null))
  /** Set after first successful create (e.g. before image upload). */
  const [persistedProductId, setPersistedProductId] = useState(/** @type {string | null} */ (null))
  const uploadCoordinatorRef = useRef(
    /** @type {{ waitUntilIdle: () => Promise<void>, isBusy: () => boolean } | null} */ (null),
  )
  const [imageUploadBusy, setImageUploadBusy] = useState(false)
  const [formInitial] = useState(() => emptyProductFormValues())

  useEffect(() => {
    let cancelled = false
    fetchAdminCategories().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setCategoryError(result.message)
        setLoadingCategories(false)
        return
      }
      const mapped = result.categories
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          slug: String(/** @type {Record<string, unknown>} */ (c).slug ?? ''),
          label: String(/** @type {Record<string, unknown>} */ (c).label ?? ''),
        }))
        .filter((c) => c.slug)
      setCategories(mapped)
      setLoadingCategories(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function ensureProduct(values) {
    if (persistedProductId && PRODUCT_ID_RE.test(persistedProductId)) {
      return { ok: true, productId: persistedProductId }
    }
    const id = String(values.id ?? '').trim()
    if (!PRODUCT_ID_RE.test(id)) {
      return { ok: false, message: 'Enter a valid product ID (e.g. P165) before uploading.' }
    }
    if (!String(values.name ?? '').trim()) {
      return { ok: false, message: 'Enter a product name before uploading.' }
    }
    if (!String(values.categorySlug ?? '').trim()) {
      return { ok: false, message: 'Select a category before uploading.' }
    }

    const result = await createAdminProduct(
      buildProductPayload({ ...values, id }, {
        includeSellingPrice: showSensitiveColumns,
        includeFinalPrice: showSensitiveColumns,
      }),
    )
    if (!result.ok) {
      const fieldMsg = result.fields ? Object.values(result.fields).join(' ') : ''
      return { ok: false, message: fieldMsg || result.message }
    }
    setPersistedProductId(id)
    return { ok: true, productId: id }
  }

  async function persistImages(images, values) {
    const ensured = await ensureProduct(values)
    if (!ensured.ok) return ensured
    const result = await updateAdminProduct(ensured.productId, { images })
    if (!result.ok) {
      const fieldMsg = result.fields ? Object.values(result.fields).join(' ') : ''
      return { ok: false, message: fieldMsg || result.message }
    }
    const product = result.product
    const savedImages = Array.isArray(product?.images)
      ? product.images.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : images
    return { ok: true, images: savedImages }
  }

  async function handleSubmit(values) {
    if (submitting) return
    setServerError(null)
    setServerFields(null)

    await uploadCoordinatorRef.current?.waitUntilIdle()
    const imageGate = assertProductSaveNotBlockedByImages({
      uploading: uploadCoordinatorRef.current?.isBusy() ?? imageUploadBusy,
      images: values.images ?? [],
    })
    if (!imageGate.ok) {
      setServerError(imageGate.message)
      return
    }

    setSubmitting(true)
    const body = buildProductPayload(values, {
      includeSellingPrice: showSensitiveColumns,
      includeFinalPrice: showSensitiveColumns,
    })
    delete body.id
    const result =
      persistedProductId && persistedProductId === values.id
        ? await updateAdminProduct(persistedProductId, body)
        : await createAdminProduct({ ...body, id: values.id })

    if (!result.ok) {
      setSubmitting(false)
      setServerError(result.message)
      setServerFields(result.fields ?? null)
      return
    }
    const product = result.product
    const newId = product?.id ? String(product.id) : values.id
    if (showSensitiveColumns && newId) {
      if (adminRateFieldChanged('', values.purchaseRateInr)) {
        const purchaseInr = getPurchaseRateInrFromForm(values)
        if (purchaseInr !== null && Number.isFinite(purchaseInr)) {
          const purchaseRes = await updateAdminPurchaseRate(newId, purchaseInr)
          if (!purchaseRes.ok) {
            setSubmitting(false)
            setServerError(purchaseRes.message)
            setServerFields(purchaseRes.fields ?? null)
            return
          }
        }
      }
    }
    setSubmitting(false)
    navigate(`/admin/products/${encodeURIComponent(newId)}/edit`, {
      replace: true,
      state: adminNavigationFlashState('Product added successfully.'),
    })
  }

  if (loadingCategories) {
    return (
      <div className="admin-page">
        <p className="admin-page__subtitle">Loading categories…</p>
      </div>
    )
  }

  return (
    <div className="admin-page admin-page--wide">
      <div className="admin-page__head">
        <div className="min-w-0 flex-1">
          <Link to="/admin/products" className={backToProductsClassName}>
            ← Back to Products
          </Link>
          <h2 className="admin-page__title mt-3">New product</h2>
          <p className="admin-page__subtitle">Create a catalogue row in D1.</p>
        </div>
      </div>
      {categoryError ? (
        <div className="admin-alert admin-alert--error" role="alert">
          {categoryError}
        </div>
      ) : null}
      <ProductForm
        mode="create"
        initial={formInitial}
        categories={categories}
        submitting={submitting}
        serverError={serverError}
        serverFields={serverFields}
        onSubmit={handleSubmit}
        onCancel={() => navigate('/admin/products')}
        resolvedProductId={persistedProductId}
        onEnsureProduct={ensureProduct}
        onPersistImages={persistImages}
        uploadCoordinatorRef={uploadCoordinatorRef}
        onUploadBusyChange={setImageUploadBusy}
        showSensitiveColumns={showSensitiveColumns}
      />
    </div>
  )
}
