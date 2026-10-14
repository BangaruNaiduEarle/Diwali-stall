import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useEstimate } from '../context/EstimateContext'
import { formatINR } from '../utils/currency'

const ICON = { strokeWidth: 1.8 }

export default function MobileStickyEstimateBar() {
  const { pathname } = useLocation()
  const { estimateCount, estimateSubtotal } = useEstimate()

  if (estimateCount <= 0 || pathname === '/estimate') return null

  const itemLabel = estimateCount === 1 ? 'item' : 'items'

  return (
    <div
      className="mobile-sticky-estimate fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-white)]/95 backdrop-blur-md lg:hidden"
      role="region"
      aria-label="Estimate quick view"
    >
      <Link
        to="/estimate"
        className="focus-ring container-page flex min-h-[52px] items-center justify-between gap-3 py-2 text-sm font-medium text-[var(--color-charcoal)]"
      >
        <span className="tabular-nums text-[var(--color-muted)]">
          {estimateCount} {itemLabel}
        </span>
        <span className="text-base font-semibold tabular-nums text-[var(--color-maroon)]">
          {formatINR(estimateSubtotal)}
        </span>
        <span className="inline-flex items-center gap-1 text-[var(--color-brand)]">
          View estimate
          <ChevronRight className="h-4 w-4 shrink-0" {...ICON} aria-hidden="true" />
        </span>
      </Link>
    </div>
  )
}
