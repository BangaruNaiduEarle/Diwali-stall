import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { formatINR } from '../../utils/currency.js'
import AdminProductTableInlineCell from './AdminProductTableInlineCell.jsx'
import AdminProductTableInlineYesNo from './AdminProductTableInlineYesNo.jsx'
import AdminProductTableThumb from './AdminProductTableThumb.jsx'
import {
  adminProductListSellingPriceView,
  formatAdminProductCompany,
  formatAdminProductPack,
  formatAdminProductPiecesPerPack,
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

/** @param {{ product: Record<string, unknown>, showSensitiveColumns?: boolean, showUnitInSummary?: boolean, activeInlineEdit?: { id: string, field: import('../lib/adminProductInlineSave.js').AdminProductInlineField } | null, onActivateInlineEdit?: (state: { id: string, field: import('../lib/adminProductInlineSave.js').AdminProductInlineField } | null) => void, onInlineSaved?: (field: import('../lib/adminProductInlineSave.js').AdminProductInlineField, result: Awaited<ReturnType<typeof import('../lib/adminProductInlineSave.js').saveAdminProductInlineField>>, draft: string) => void, onDelete?: (target: { id: string, name: string }) => void }} props */
export default function AdminProductCard({
  product,
  showSensitiveColumns = true,
  showUnitInSummary = showSensitiveColumns,
  activeInlineEdit = null,
  onActivateInlineEdit,
  onInlineSaved,
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
  const inlineEnabled = typeof onInlineSaved === 'function' && typeof onActivateInlineEdit === 'function'
  const isEditing = (field) =>
    inlineEnabled && activeInlineEdit?.id === id && activeInlineEdit?.field === field
  const finalSeed =
    product.hasFinalPrice ||
    (Number.isFinite(Number(product.finalPriceInr)) && Number(product.finalPriceInr) > 0)
      ? String(product.finalPriceInr)
      : ''
  const piecesSeed =
    product.piecesPerPack != null && Number.isInteger(Number(product.piecesPerPack))
      ? String(product.piecesPerPack)
      : ''

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
        {showSensitiveColumns ? (
          <div>
            <dt>Final Price</dt>
            <dd className="tabular-nums">
              {inlineEnabled ? (
                <AdminProductTableInlineCell
                  productId={id}
                  field="finalPriceInr"
                  editable={showSensitiveColumns}
                  inputMode="decimal"
                  draftSeed={finalSeed}
                  isActive={isEditing('finalPriceInr')}
                  onActivate={() => onActivateInlineEdit?.({ id, field: 'finalPriceInr' })}
                  onDeactivate={() => onActivateInlineEdit?.(null)}
                  onSaved={(result, draft) => onInlineSaved?.('finalPriceInr', result, draft)}
                  display={
                    product.hasFinalPrice ||
                    (Number.isFinite(Number(product.finalPriceInr)) && Number(product.finalPriceInr) > 0) ? (
                      formatOptionalInr(product.finalPriceInr)
                    ) : (
                      <span className="admin-table__meta">—</span>
                    )
                  }
                />
              ) : product.hasFinalPrice ||
                (Number.isFinite(Number(product.finalPriceInr)) && Number(product.finalPriceInr) > 0) ? (
                formatOptionalInr(product.finalPriceInr)
              ) : (
                <span className="admin-table__meta">—</span>
              )}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Pieces per Pack</dt>
          <dd className="tabular-nums">
            {inlineEnabled ? (
              <AdminProductTableInlineCell
                productId={id}
                field="piecesPerPack"
                editable
                inputMode="numeric"
                draftSeed={piecesSeed}
                isActive={isEditing('piecesPerPack')}
                onActivate={() => onActivateInlineEdit?.({ id, field: 'piecesPerPack' })}
                onDeactivate={() => onActivateInlineEdit?.(null)}
                onSaved={(result, draft) => onInlineSaved?.('piecesPerPack', result, draft)}
                display={formatAdminProductPiecesPerPack(product.piecesPerPack)}
              />
            ) : (
              formatAdminProductPiecesPerPack(product.piecesPerPack)
            )}
          </dd>
        </div>
        <div>
          <dt>Allow Loose Sale</dt>
          <dd>
            {inlineEnabled ? (
              <AdminProductTableInlineYesNo
                productId={id}
                field="allowLooseSale"
                value={product.allowLooseSale === true}
                onSaved={(result, draft) => onInlineSaved?.('allowLooseSale', result, draft)}
              />
            ) : product.allowLooseSale === true ? (
              'Yes'
            ) : (
              'No'
            )}
          </dd>
        </div>
      </dl>
    </article>
  )
}
