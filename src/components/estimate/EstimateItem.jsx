import { Package, Trash2 } from 'lucide-react'
import QuantityControl from '../QuantityControl'
import { resolveProductImageList } from '../../utils/productImage'

const ICON = { strokeWidth: 1.8 }

export default function EstimateItem({ row, onIncrease, onDecrease, onRemove }) {
  const { product, quantity } = row
  const imageUrl = resolveProductImageList(product)[0]

  return (
    <article className="p-4 sm:p-5">
      <div className="flex gap-3 sm:items-start">
        <div className="product-image-well flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] sm:h-[4.5rem] sm:w-[4.5rem]">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="max-h-full max-w-full object-contain p-1"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <Package className="h-5 w-5 text-[var(--color-gold)]" {...ICON} aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-snug text-[var(--color-charcoal)]">{product.name}</h2>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-red)]">
            {product.category}
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm sm:hidden">
            <dt className="text-[var(--color-muted)]">Qty</dt>
            <dd className="font-medium tabular-nums text-[var(--color-charcoal)]">{quantity}</dd>
          </dl>
        </div>

        <div className="hidden shrink-0 text-right text-sm sm:block sm:min-w-[5rem]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Qty</p>
          <p className="mt-0.5 font-semibold tabular-nums text-[var(--color-charcoal)]">{quantity}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <QuantityControl
          quantity={quantity}
          productName={product.name}
          onIncrease={() => onIncrease(product.id)}
          onDecrease={() => onDecrease(product.id)}
        />
      </div>

      <button
        type="button"
        className="focus-ring mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-red)]"
        onClick={() => onRemove(product.id)}
      >
        <Trash2 className="h-3.5 w-3.5" {...ICON} aria-hidden="true" />
        Remove
      </button>
    </article>
  )
}
