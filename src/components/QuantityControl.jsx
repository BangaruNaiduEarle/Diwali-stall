import { Minus, Plus } from 'lucide-react'
import { ESTIMATE_MAX_QUANTITY } from '../utils/estimateHelpers'

const ICON = { strokeWidth: 1.8 }

export default function QuantityControl({
  quantity = 1,
  onIncrease,
  onDecrease,
  disabled = false,
  size = 'default',
  productName = 'item',
}) {
  const compact = size === 'compact'
  const btnClass = compact ? 'min-h-10 min-w-10' : 'min-h-11 min-w-11'

  return (
    <div
      className="inline-flex items-center overflow-hidden rounded-[var(--btn-radius)] border border-[var(--color-border-warm)] bg-[var(--color-ivory)]"
      role="group"
      aria-label={`Quantity for ${productName}`}
    >
      <button
        type="button"
        className={`focus-ring ${btnClass} inline-flex items-center justify-center text-[var(--color-brand-deep)] transition-ui hover:bg-[var(--color-white)] disabled:opacity-40`}
        onClick={onDecrease}
        disabled={disabled}
        aria-label="Decrease quantity"
      >
        <Minus className="h-4 w-4" {...ICON} aria-hidden="true" />
      </button>
      <span
        className={`min-w-8 text-center text-sm font-semibold tabular-nums text-[var(--color-charcoal)] ${compact ? 'px-1' : 'px-2'}`}
        aria-live="polite"
      >
        {quantity}
      </span>
      <button
        type="button"
        className={`focus-ring ${btnClass} inline-flex items-center justify-center text-[var(--color-brand-deep)] transition-ui hover:bg-[var(--color-white)] disabled:opacity-40`}
        onClick={onIncrease}
        disabled={disabled || quantity >= ESTIMATE_MAX_QUANTITY}
        aria-label="Increase quantity"
      >
        <Plus className="h-4 w-4" {...ICON} aria-hidden="true" />
      </button>
    </div>
  )
}
