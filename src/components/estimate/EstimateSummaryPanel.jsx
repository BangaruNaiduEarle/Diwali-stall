import Button from '../ui/Button'
import ComplimentaryGiftPromo from '../promo/ComplimentaryGiftPromo'
import { formatINR } from '../../utils/currency.js'
import FreeDoorDeliveryNotice from './FreeDoorDeliveryNotice.jsx'

/** Desktop-only sticky summary for step 1. */
export default function EstimateSummaryPanel({
  uniqueProductCount,
  estimateCount,
  qualifyingTotalInr = 0,
  deliveryMessage = '',
  deliveryQualified = false,
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
      {qualifyingTotalInr > 0 ? (
        <p className="mt-3 text-sm font-semibold tabular-nums text-[var(--color-charcoal)]">
          Estimated total (listed prices): {formatINR(qualifyingTotalInr)}
        </p>
      ) : null}
      <FreeDoorDeliveryNotice
        message={deliveryMessage}
        qualified={deliveryQualified}
        qualifyingTotalInr={qualifyingTotalInr}
      />
      <ComplimentaryGiftPromo variant="inline" className="mt-4" />
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">
        We&apos;ll confirm availability and pricing with you on WhatsApp. No prices are shown here by design.
      </p>
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
