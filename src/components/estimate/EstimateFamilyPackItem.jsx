import { Gift, Trash2 } from 'lucide-react'
import QuantityControl from '../QuantityControl'
import { formatINR } from '../../utils/currency'

const ICON = { strokeWidth: 1.8 }

export default function EstimateFamilyPackItem({ row, onIncrease, onDecrease, onRemove }) {
  const { name, quantity, unitPriceInr, unavailable } = row
  const imageUrl = row.pack?.coverImageUrl ?? row.pack?.images?.[0]?.url ?? ''

  return (
    <article className="p-4 sm:p-5">
      <div className="flex gap-3 sm:items-start">
        <div className="product-image-well flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] sm:h-[4.5rem] sm:w-[4.5rem]">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="max-h-full max-w-full object-contain p-1" loading="lazy" decoding="async" />
          ) : (
            <Gift className="h-5 w-5 text-[var(--color-gold)]" {...ICON} aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-snug text-[var(--color-charcoal)]">{name}</h2>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-red)]">
            Family pack
          </p>
          {unavailable ? (
            <p className="mt-1 text-xs text-[var(--color-red)]">This pack is no longer available for new orders.</p>
          ) : null}
          {unitPriceInr > 0 ? (
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Pack price: <span className="font-semibold tabular-nums text-[var(--color-charcoal)]">{formatINR(unitPriceInr)}</span>
            </p>
          ) : null}
        </div>

        <div className="hidden shrink-0 text-right text-sm sm:block sm:min-w-[5rem]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Qty</p>
          <p className="mt-0.5 font-semibold tabular-nums text-[var(--color-charcoal)]">{quantity}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <QuantityControl
          quantity={quantity}
          productName={name}
          onIncrease={() => onIncrease(row.familyPackId)}
          onDecrease={() => onDecrease(row.familyPackId)}
        />
      </div>

      <button
        type="button"
        className="focus-ring mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-red)]"
        onClick={() => onRemove(row.familyPackId)}
      >
        <Trash2 className="h-3.5 w-3.5" {...ICON} aria-hidden="true" />
        Remove
      </button>
    </article>
  )
}
