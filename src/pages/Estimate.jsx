import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, MessageCircle, Pencil, ReceiptText, Trash2 } from 'lucide-react'
import CustomerDetailsForm from '../components/CustomerDetailsForm'
import EmptyState from '../components/EmptyState'
import PageContainer from '../components/PageContainer'
import QuantityControl from '../components/QuantityControl'
import Button from '../components/ui/Button'
import { useCustomerDetails } from '../context/CustomerDetailsContext'
import { useEstimate } from '../context/EstimateContext'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatINR } from '../utils/currency'
import { getEstimateProducts } from '../utils/estimateHelpers'
import { getWhatsAppEstimateUrl } from '../utils/whatsapp'

const ICON = { strokeWidth: 1.8 }

function EstimateLineRow({ row, onIncrease, onDecrease, onRemove }) {
  const { product, quantity, lineTotal } = row

  return (
    <article className="estimate-line-card surface-card mb-3 p-4 md:mb-0 md:rounded-none md:border-0 md:border-b md:bg-transparent md:p-0 md:shadow-none md:py-6">
      <h2 className="text-base font-semibold leading-snug text-[var(--color-charcoal)]">{product.name}</h2>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-red)]">
        {product.category}
      </p>
      {product.pack?.trim() ? (
        <p className="mt-1 text-xs text-[var(--color-muted)]">{product.pack.trim()}</p>
      ) : null}
      <p className="mt-2 text-[15px] font-bold text-[var(--color-maroon)]">{formatINR(product.price)} each</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <QuantityControl
          quantity={quantity}
          productName={product.name}
          onIncrease={() => onIncrease(product.id)}
          onDecrease={() => onDecrease(product.id)}
        />
        <p className="text-lg font-semibold tabular-nums text-[var(--color-maroon)]">{formatINR(lineTotal)}</p>
      </div>

      <button
        type="button"
        className="focus-ring mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--color-muted)] transition-ui hover:text-[var(--color-red)]"
        onClick={() => onRemove(product.id)}
      >
        <Trash2 className="h-4 w-4" {...ICON} aria-hidden="true" />
        Remove
      </button>
    </article>
  )
}

function EstimateReview({ rows, subtotal, details, canSend, whatsAppUrl, onSendAttempt }) {
  return (
    <section className="surface-card p-5 md:p-6" aria-labelledby="estimate-review-heading">
      <h2 id="estimate-review-heading" className="text-base font-semibold text-[var(--color-charcoal)]">
        Review before WhatsApp
      </h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        This is a request for confirmation — not a confirmed order or payment.
      </p>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">Your estimate</h3>
        <ul className="mt-3 space-y-2 text-sm text-[var(--color-charcoal)]">
          {rows.map(({ product, quantity, lineTotal }) => (
            <li key={product.id} className="flex justify-between gap-3">
              <span>
                {quantity} × {product.name}
              </span>
              <span className="shrink-0 tabular-nums">{formatINR(lineTotal)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm font-semibold text-[var(--color-charcoal)]">
          Estimated total:{' '}
          <span className="text-lg tabular-nums text-[var(--color-maroon)]">{formatINR(subtotal)}</span>
        </p>
      </div>

      <div className="mt-5 hairline-t pt-5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">Customer</h3>
        <dl className="mt-2 space-y-1 text-sm text-[var(--color-charcoal)]">
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted)]">Name</dt>
            <dd>{details.name || '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted)]">Mobile</dt>
            <dd>{details.mobile || '—'}</dd>
          </div>
          {details.area ? (
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted)]">Area</dt>
              <dd>{details.area}</dd>
            </div>
          ) : null}
          {details.pickupDate ? (
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted)]">Pickup</dt>
              <dd>{details.pickupDate}</dd>
            </div>
          ) : null}
          {details.note ? (
            <div className="gap-2 sm:flex">
              <dt className="shrink-0 text-[var(--color-muted)]">Note</dt>
              <dd className="min-w-0 break-words">{details.note}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Link to="/crackers" className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--color-brand)]">
          <Pencil className="h-4 w-4" {...ICON} aria-hidden="true" />
          Edit estimate (browse catalogue)
        </Link>
        <a
          href="#customer-details"
          className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--color-brand)]"
        >
          <Pencil className="h-4 w-4" {...ICON} aria-hidden="true" />
          Edit details
        </a>

        {whatsAppUrl && canSend ? (
          <Button
            href={whatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="primary"
            size="md"
            icon={MessageCircle}
            fullWidth
          >
            Send request on WhatsApp
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="md"
            icon={MessageCircle}
            fullWidth
            onClick={onSendAttempt}
          >
            Send request on WhatsApp
          </Button>
        )}
        {!canSend ? (
          <p className="text-xs text-[var(--color-muted)]">Enter your name and mobile number above to continue.</p>
        ) : null}
      </div>
    </section>
  )
}

export default function Estimate() {
  usePageTitle('My estimate')
  const {
    estimateItems,
    estimateCount,
    estimateSubtotal,
    uniqueProductCount,
    increaseQuantity,
    decreaseQuantity,
    removeFromEstimate,
    clearEstimate,
  } = useEstimate()
  const { details, isValid, markTouched } = useCustomerDetails()

  const rows = getEstimateProducts(estimateItems)
  const whatsAppUrl = useMemo(
    () => (isValid ? getWhatsAppEstimateUrl(estimateItems, details) : null),
    [estimateItems, details, isValid],
  )

  const handleSendAttempt = () => {
    markTouched()
    document.getElementById('customer-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleClear = () => {
    if (window.confirm('Clear your entire estimate? This cannot be undone.')) {
      clearEstimate()
    }
  }

  if (rows.length === 0) {
    return (
      <PageContainer>
        <header className="mb-4 max-w-xl">
          <p className="editorial-label-festive text-[var(--color-maroon)]">My estimate</p>
          <h1 className="editorial-title mt-3">Your estimate is empty</h1>
        </header>
        <EmptyState
          icon={ReceiptText}
          title=""
          description="Browse the catalogue and add products you are interested in."
          action={
            <Button to="/crackers" variant="primary" iconRight={ArrowRight} fullWidth className="max-w-[360px] sm:!w-auto">
              Browse crackers
            </Button>
          }
        />
      </PageContainer>
    )
  }

  const productLabel = uniqueProductCount === 1 ? 'product' : 'products'
  const itemLabel = estimateCount === 1 ? 'item' : 'items'

  return (
    <PageContainer>
      <header className="mb-6 max-w-2xl md:mb-8">
        <p className="editorial-label-festive text-[var(--color-maroon)]">My estimate</p>
        <h1 className="editorial-title mt-2">My estimate</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {uniqueProductCount} {productLabel} · {estimateCount} {itemLabel}
        </p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Review your list, add your contact details, then send a WhatsApp request for the stall to confirm availability
          and final price.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_min(340px,100%)] lg:items-start lg:gap-10">
        <div className="space-y-8">
          <section aria-labelledby="estimate-items-heading">
            <h2 id="estimate-items-heading" className="sr-only">
              Estimate items
            </h2>
            <div className="min-w-0 md:divide-y md:divide-[var(--color-border)] md:border-y md:border-[var(--color-border)]">
              {rows.map((row) => (
                <EstimateLineRow
                  key={row.productId}
                  row={row}
                  onIncrease={increaseQuantity}
                  onDecrease={decreaseQuantity}
                  onRemove={removeFromEstimate}
                />
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" className="mt-4" onClick={handleClear}>
              Clear estimate
            </Button>
          </section>

          <CustomerDetailsForm />
        </div>

        <EstimateReview
          rows={rows}
          subtotal={estimateSubtotal}
          details={details}
          canSend={isValid}
          whatsAppUrl={whatsAppUrl}
          onSendAttempt={handleSendAttempt}
        />
      </div>
    </PageContainer>
  )
}
