import Button from '../ui/Button'
import { formatINR } from '../../utils/currency'

/** Desktop-only sticky summary for step 1. */
export default function EstimateSummaryPanel({
  uniqueProductCount,
  estimateCount,
  subtotal,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  helperText,
}) {
  const productLabel = uniqueProductCount === 1 ? 'product' : 'products'
  const itemLabel = estimateCount === 1 ? 'item' : 'items'

  return (
    <aside
      className="hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] p-5 lg:block lg:sticky lg:top-24 lg:p-6"
      aria-labelledby="estimate-summary-heading"
    >
      <h2 id="estimate-summary-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
        Your estimate
      </h2>
      <p className="mt-3 text-sm text-[var(--color-charcoal)]">
        {uniqueProductCount} {productLabel} · {estimateCount} {itemLabel}
      </p>
      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Estimated total</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--color-maroon)]">{formatINR(subtotal)}</p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">
          Final availability and price will be confirmed by the stall.
        </p>
      </div>
      {primaryLabel ? (
        <Button
          type="button"
          variant="primary"
          fullWidth
          className="mt-6"
          onClick={onPrimary}
          disabled={primaryDisabled}
        >
          {primaryLabel}
        </Button>
      ) : null}
      {helperText ? <p className="mt-3 text-xs text-[var(--color-muted)]">{helperText}</p> : null}
    </aside>
  )
}
