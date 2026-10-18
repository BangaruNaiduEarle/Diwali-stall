import { Link } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { formatINR } from '../../utils/currency.js'
import AdminProductTableThumb from './AdminProductTableThumb.jsx'
import { formatAdminProductCompany, formatAdminProductPack } from '../lib/adminProductTableDisplay.js'

/** @param {{ active?: boolean }} props */
function StatusBadge({ active = true }) {
  return (
    <span className={`admin-product-card__status${active ? '' : ' admin-product-card__status--muted'}`}>
      {active ? 'Active' : 'Archived'}
    </span>
  )
}

/** @param {unknown} value */
function formatOptionalInr(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return formatINR(n)
}

/** @param {{ product: Record<string, unknown> }} props */
export default function AdminProductCard({ product }) {
  const id = String(product.id ?? '')
  const name = String(product.name ?? '')
  const category = String(product.categoryLabel ?? product.categorySlug ?? '')
  const company = product.company ? formatAdminProductCompany(product.company) : ''
  const pack = product.pack ? formatAdminProductPack(product.pack) : ''
  const extras = [company !== '—' ? company : '', pack !== '—' ? pack : ''].filter(Boolean).join(' · ')
  const editLabel = `Edit ${name}`

  return (
    <article className="admin-card admin-product-card">
      <div className="admin-product-card__head">
        <AdminProductTableThumb images={product.images} name={name} />
        <div className="admin-product-card__intro">
          <h3 className="admin-product-card__name">{name}</h3>
          <p className="admin-product-card__idline">
            <span className="admin-product-card__id">{id}</span>
            {category ? (
              <>
                <span className="admin-product-card__sep" aria-hidden="true">
                  ·
                </span>
                <span className="admin-product-card__category">{category}</span>
              </>
            ) : null}
          </p>
          {extras ? <p className="admin-product-card__meta">{extras}</p> : null}
        </div>
        <div className="admin-product-card__actions">
          <StatusBadge active={product.active !== false} />
          <Link
            to={`/admin/products/${encodeURIComponent(id)}/edit`}
            className="admin-product-card__edit-icon"
            aria-label={editLabel}
            title={editLabel}
          >
            <Pencil size={18} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <dl className="admin-product-card__rates">
        <div>
          <dt>Purchase</dt>
          <dd className="tabular-nums">
            {product.hasPurchaseRate ? (
              formatOptionalInr(product.purchaseRateInr)
            ) : (
              <span className="admin-table__meta admin-table__meta--warn">Missing</span>
            )}
          </dd>
        </div>
        <div>
          <dt>X4</dt>
          <dd className="tabular-nums">
            {product.hasX4SellingRate || product.hasPrivateX4Rate ? (
              formatOptionalInr(product.x4SellingPriceInr ?? product.privateX4Inr)
            ) : (
              <span className="admin-table__meta admin-table__meta--warn">Missing</span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  )
}
