import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchAdminCategories, fetchAdminProduct, updateAdminProduct } from '../api/adminApi.js'
import { updateAdminPurchaseRate, updateAdminX4SellingRate } from '../api/adminApi.js'
import ProductForm, {
  adminRateFieldChanged,
  buildProductPayload,
  getPurchaseRateInrFromForm,
  getX4SellingInrFromForm,
  productToFormValues,
} from '../components/ProductForm.jsx'

const PRODUCT_ID_RE = /^P\d{3,}$/

export default function AdminProductEditPage() {
  const { id: routeId } = useParams()
  const productId = String(routeId ?? '').trim()
  const navigate = useNavigate()

  const [initial, setInitial] = useState(/** @type {import('../components/ProductForm.jsx').ProductFormValues | null} */ (null))
  const [categories, setCategories] = useState(/** @type {{ slug: string, label: string }[]} */ ([]))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(/** @type {string | null} */ (null))
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState(/** @type {string | null} */ (null))
  const [serverFields, setServerFields] = useState(/** @type {Record<string, string> | null} */ (null))

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
    setSubmitting(true)
    setServerError(null)
    setServerFields(null)
    const body = buildProductPayload(values)
    delete body.id
    const result = await updateAdminProduct(productId, body)
    if (!result.ok) {
      setSubmitting(false)
      setServerError(result.message)
      setServerFields(result.fields ?? null)
      return
    }
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
    setSubmitting(false)
    const refreshed = await fetchAdminProduct(productId)
    if (refreshed.ok) {
      setInitial(productToFormValues(/** @type {Record<string, unknown>} */ (refreshed.product)))
    }
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

  return (
    <div className="admin-page admin-page--wide">
      <div className="admin-page__head">
        <div>
          <h2 className="admin-page__title">Edit {productId}</h2>
          <p className="admin-page__subtitle">
            Edit catalogue fields, purchase rate (Excel Rate), and X4 selling price independently.
          </p>
        </div>
      </div>
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
      />
    </div>
  )
}
