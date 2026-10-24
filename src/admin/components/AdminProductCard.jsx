import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { formatINR } from '../../utils/currency.js'
import AdminProductTableThumb from './AdminProductTableThumb.jsx'
import {
  adminProductListSellingPriceView,
  formatAdminProductCompany,
  formatAdminProductPack,
} from '../lib/adminProductTableDisplay.js'

/** @param {{ active?: boolean }} props */
function StatusBadge({ active = true }) {
  return (
    <span className={`admin-product-card__status${active ? '' : ' admin-product-card__status--muted'}`}>
      {active ? 'Active' : 'Inactive'}
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

/** @param {{ product: Record<string, unknown>, showSensitiveColumns?: boolean, showUnitInSummary?: boolean, onDelete?: (target: { id: string, name: string }) => void }} props */
export default function AdminProductCard({
  product,
  showSensitiveColumns = true,
  showUnitInSummary = showSensitiveColumns,
  onDelete,
}) {
  const id = String(product.id ?? '')
  const name = String(product.name ?? '')
  const category = String(product.categoryLabel ?? product.categorySlug ?? '')
  const company = product.company ? formatAdminProductCompany(product.company) : ''
  const pack = product.pack ? formatAdminProductPack(product.pack) : ''
  const extras = [
    company !== '—' ? company : '',
    showUnitInSummary && pack !== '—' ? pack : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const editLabel = `Edit ${name}`
  const sellingView = adminProductListSellingPriceView(product)

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
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="admin-product-card__edit-icon"
              aria-label={`Delete ${name}`}
              title={`Delete ${name}`}
              onClick={() => onDelete({ id, name: name.trim() || id })}
            >
              <Trash2 size={18} aria-hidden="true" />
            </Button>
          ) : null}
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
        {showSensitiveColumns ? (
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
        ) : null}
        <div>
          <dt>Selling Price</dt>
          <dd className="tabular-nums">
            {sellingView.kind === 'value' ? (
              formatOptionalInr(sellingView.inr)
            ) : (
              <span className="admin-table__meta admin-table__meta--warn">Missing</span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  )
}
