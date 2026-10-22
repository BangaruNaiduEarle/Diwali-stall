import { useEffect, useRef, useState } from 'react'
import { assertProductSaveNotBlockedByImages } from '../lib/adminProductImageSave.js'
import { useNavigate, useParams } from 'react-router-dom'
import {
  deleteAdminProduct,
  fetchAdminCategories,
  fetchAdminProduct,
  patchAdminProductStatus,
  updateAdminProduct,
} from '../api/adminApi.js'
import AdminConfirmDialog from '../components/AdminConfirmDialog.jsx'
import Button from '../../components/ui/Button.jsx'
import { updateAdminPurchaseRate, updateAdminX4SellingRate } from '../api/adminApi.js'
import ProductForm, {
  adminRateFieldChanged,
  buildProductPayload,
  getPurchaseRateInrFromForm,
  getX4SellingInrFromForm,
  productToFormValues,
} from '../components/ProductForm.jsx'
import AdminFeedbackBanner from '../components/AdminFeedbackBanner.jsx'
import { useAdminFlash } from '../lib/useAdminFlash.js'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { showAdminProductSensitiveColumns } from '../lib/adminProductTableColumns.js'

const PRODUCT_ID_RE = /^P\d{3,}$/

export default function AdminProductEditPage() {
  const { role } = useAdminSession()
  const showSensitiveColumns = showAdminProductSensitiveColumns(role)
  const { id: routeId } = useParams()
  const productId = String(routeId ?? '').trim()
  const navigate = useNavigate()
  const { flash, setFlash, clearFlash } = useAdminFlash()

  const [initial, setInitial] = useState(/** @type {import('../components/ProductForm.jsx').ProductFormValues | null} */ (null))
  const [categories, setCategories] = useState(/** @type {{ slug: string, label: string }[]} */ ([]))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(/** @type {string | null} */ (null))
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState(/** @type {string | null} */ (null))
  const [serverFields, setServerFields] = useState(/** @type {Record<string, string> | null} */ (null))
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const uploadCoordinatorRef = useRef(
    /** @type {{ waitUntilIdle: () => Promise<void>, isBusy: () => boolean } | null} */ (null),
  )
  const [imageUploadBusy, setImageUploadBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!/^P\d+$/.test(productId)) {
      setLoadError('Invalid product id in URL.')
      setLoading(false)
      return () => {}
    }

    setLoading(true)
    setLoadError(null)

    Promise.all([fetchAdminProduct(productId), fetchAdminCategories()]).then(([productRes, catRes]) => {
      if (cancelled) return
      if (!productRes.ok) {
        setLoadError(productRes.message)
        setLoading(false)
        return
      }
      if (!catRes.ok) {
        setLoadError(catRes.message)
        setLoading(false)
        return
      }
      setInitial(productToFormValues(/** @type {Record<string, unknown>} */ (productRes.product)))
      const mapped = catRes.categories
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          slug: String(/** @type {Record<string, unknown>} */ (c).slug ?? ''),
          label: String(/** @type {Record<string, unknown>} */ (c).label ?? ''),
        }))
        .filter((c) => c.slug)
      setCategories(mapped)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [productId])

  async function ensureProduct(_values) {
    if (!PRODUCT_ID_RE.test(productId)) {
      return { ok: false, message: 'Invalid product id.' }
    }
    return { ok: true, productId }
  }

  async function persistImages(images, _values) {
    const result = await updateAdminProduct(productId, { images })
    if (!result.ok) {
      return { ok: false, message: result.message }
    }
    const product = /** @type {{ product?: Record<string, unknown> }} */ (result.data ?? {}).product
    if (product) {
      setInitial(productToFormValues(product))
    }
    return { ok: true }
  }

  async function handleSubmit(values) {
    if (submitting) return
    setServerError(null)
    setServerFields(null)
    clearFlash()

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
    const body = buildProductPayload(values)
    delete body.id
    const result = await updateAdminProduct(productId, body)
    if (!result.ok) {
      setSubmitting(false)
      setServerError(result.message)
      setServerFields(result.fields ?? null)
      return
    }
    if (showSensitiveColumns) {
      if (adminRateFieldChanged(initial.x4SellingPriceInr, values.x4SellingPriceInr)) {
        const x4Inr = getX4SellingInrFromForm(values)
        if (x4Inr !== null && Number.isFinite(x4Inr)) {
          const rateRes = await updateAdminX4SellingRate(productId, x4Inr)
          if (!rateRes.ok) {
            setSubmitting(false)
            setServerError(rateRes.message)
            setServerFields(rateRes.fields ?? null)
            return
          }
        }
      }
      if (adminRateFieldChanged(initial.purchaseRateInr, values.purchaseRateInr)) {
        const purchaseInr = getPurchaseRateInrFromForm(values)
        if (purchaseInr !== null && Number.isFinite(purchaseInr)) {
          const purchaseRes = await updateAdminPurchaseRate(productId, purchaseInr)
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
    const refreshed = await fetchAdminProduct(productId)
    if (refreshed.ok) {
      setInitial(productToFormValues(/** @type {Record<string, unknown>} */ (refreshed.product)))
    }
    setFlash({ type: 'success', message: 'Changes saved successfully.' })
  }

  if (loading) {
    return (
      <div className="admin-page">
        <p className="admin-page__subtitle">Loading product…</p>
      </div>
    )
  }

  if (loadError || !initial) {
    return (
      <div className="admin-page">
        <div className="admin-alert admin-alert--error" role="alert">
          {loadError ?? 'Product could not be loaded.'}
        </div>
        <button type="button" className="admin-link-button" onClick={() => navigate('/admin/products')}>
          Back to products
        </button>
      </div>
    )
  }

  async function handleStatusToggle() {
    const result = await patchAdminProductStatus(productId, !initial.active)
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    const product = /** @type {{ product?: Record<string, unknown> }} */ (result.data ?? {}).product
    if (product) setInitial(productToFormValues(product))
  }

  async function handleDeleteConfirm() {
    if (deleting) return
    setDeleting(true)
    setServerError(null)
    const result = await deleteAdminProduct(productId)
    setDeleting(false)
    if (!result.ok) {
      setDeleteOpen(false)
      setServerError(result.message)
      return
    }
    navigate('/admin/products', { replace: true })
  }

  return (
    <div className="admin-page admin-page--wide">
      <div className="admin-page__head">
        <div>
          <h2 className="admin-page__title">Edit {productId}</h2>
          <p className="admin-page__subtitle">
            {showSensitiveColumns
              ? 'Edit catalogue fields, purchase rate (Excel Rate), and selling price independently.'
              : 'Edit catalogue fields and product images.'}
          </p>
        </div>
      </div>
      <AdminFeedbackBanner variant={flash?.type ?? 'success'} message={flash?.message} onDismiss={clearFlash} />
      <ProductForm
        mode="edit"
        initial={initial}
        categories={categories}
        submitting={submitting}
        serverError={serverError}
        serverFields={serverFields}
        onSubmit={handleSubmit}
        onCancel={() => navigate('/admin/products')}
        resolvedProductId={productId}
        onEnsureProduct={ensureProduct}
        onPersistImages={persistImages}
        uploadCoordinatorRef={uploadCoordinatorRef}
        onUploadBusyChange={setImageUploadBusy}
        showSensitiveColumns={showSensitiveColumns}
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="secondary" disabled={submitting || deleting} onClick={handleStatusToggle}>
          {initial.active ? 'Deactivate' : 'Activate'}
        </Button>
        <Button type="button" variant="ghost" disabled={submitting || deleting} onClick={() => setDeleteOpen(true)}>
          Delete
        </Button>
      </div>
      <AdminConfirmDialog
        open={deleteOpen}
        title={`Delete “${initial.name.trim() || productId}”?`}
        description="Permanent deletion cannot be undone. If this product appears on customer requests, quotations, or family packs, deletion will be blocked — deactivate the product instead."
        cancelLabel="Keep product"
        confirmLabel="Delete permanently"
        confirming={deleting}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false)
        }}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
