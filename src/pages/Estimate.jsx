import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, MessageCircle, ReceiptText } from 'lucide-react'
import CustomerDetailsForm from '../components/CustomerDetailsForm'
import EmptyState from '../components/EmptyState'
import EstimateItem from '../components/estimate/EstimateItem'
import EstimateProgress from '../components/estimate/EstimateProgress'
import EstimateSummaryPanel from '../components/estimate/EstimateSummaryPanel'
import PageContainer from '../components/PageContainer'
import Button from '../components/ui/Button'
import { useCustomerDetails } from '../context/CustomerDetailsContext'
import { useEstimate } from '../context/EstimateContext'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatINR } from '../utils/currency'
import { getMobileDigits, validateCustomerDetails } from '../utils/customerDetailsHelpers'
import { getEstimateProducts } from '../utils/estimateHelpers'
import { getWhatsAppEstimateUrl } from '../utils/whatsapp'

function ReviewSection({ rows, subtotal, details, onEditDetails, whatsAppUrl, onSendAttempt, canSend }) {
  const mobileDisplay = details.mobile
    ? `+91 ${getMobileDigits(details.mobile).replace(/(\d{5})(\d{5})/, '$1 $2')}`
    : '—'

  return (
    <div className="space-y-6">
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] p-5 sm:p-6"
        aria-labelledby="review-estimate-heading"
      >
        <h2 id="review-estimate-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
          Your estimate
        </h2>
        <ul className="mt-4 space-y-2 text-sm text-[var(--color-charcoal)]">
          {rows.map(({ product, quantity, lineTotal }) => (
            <li key={product.id} className="flex justify-between gap-3">
              <span>
                {quantity} × {product.name}
              </span>
              <span className="shrink-0 tabular-nums font-medium">{formatINR(lineTotal)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex justify-between gap-3 border-t border-[var(--color-border)] pt-4 text-sm font-semibold">
          <span>Estimated total</span>
          <span className="text-lg tabular-nums text-[var(--color-maroon)]">{formatINR(subtotal)}</span>
        </p>
      </section>

      <section
        className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] p-5 sm:p-6"
        aria-labelledby="review-details-heading"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="review-details-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
            Your details
          </h2>
          <button type="button" className="focus-ring text-sm font-medium text-[var(--color-brand)]" onClick={onEditDetails}>
            Edit details
          </button>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-[var(--color-muted)]">Name</dt>
            <dd className="mt-0.5 font-medium">{details.name || '—'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Mobile</dt>
            <dd className="mt-0.5 font-medium">{mobileDisplay}</dd>
          </div>
          {details.area ? (
            <div>
              <dt className="text-[var(--color-muted)]">Area</dt>
              <dd className="mt-0.5 font-medium">{details.area}</dd>
            </div>
          ) : null}
          {details.pickupDate ? (
            <div>
              <dt className="text-[var(--color-muted)]">Preferred pickup</dt>
              <dd className="mt-0.5 font-medium">{details.pickupDate}</dd>
            </div>
          ) : null}
          {details.note ? (
            <div>
              <dt className="text-[var(--color-muted)]">Note</dt>
              <dd className="mt-0.5 break-words font-medium">{details.note}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-ivory)] p-4 text-sm" role="note">
        <p className="font-semibold text-[var(--color-maroon)]">This is an estimate request, not a confirmed order.</p>
        <p className="mt-2 text-[var(--color-muted)]">
          We&apos;ll confirm product availability and final pricing with you on WhatsApp.
        </p>
      </div>

      <div>
        {whatsAppUrl && canSend ? (
          <Button href={whatsAppUrl} target="_blank" rel="noopener noreferrer" variant="primary" icon={MessageCircle} fullWidth>
            Send request on WhatsApp
          </Button>
        ) : (
          <Button type="button" variant="primary" icon={MessageCircle} fullWidth onClick={onSendAttempt}>
            Send request on WhatsApp
          </Button>
        )}
        <p className="mt-2 text-center text-xs text-[var(--color-muted)]">
          Your selected products and details will be shared with our stall team.
        </p>
      </div>
    </div>
  )
}

export default function Estimate() {
  usePageTitle('My estimate')
  const [step, setStep] = useState('estimate')
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  const handleClear = () => {
    if (window.confirm('Clear your entire estimate? This cannot be undone.')) {
      clearEstimate()
      setStep('estimate')
    }
  }

  const goToDetails = () => setStep('details')
  const goToReview = () => {
    markTouched()
    if (Object.keys(validateCustomerDetails(details)).length > 0) return
    setStep('review')
  }

  const handleSendAttempt = () => {
    markTouched()
    if (!isValid) setStep('details')
  }

  if (rows.length === 0) {
    return (
      <PageContainer>
        <header className="max-w-xl">
          <p className="editorial-label-festive text-[var(--color-maroon)]">My estimate</p>
          <h1 className="editorial-title mt-2">Your estimate is empty</h1>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Start exploring our crackers and add your favourites here.
          </p>
        </header>
        <EmptyState
          icon={ReceiptText}
          title=""
          description=""
          action={
            <Button to="/crackers" variant="primary" iconRight={ArrowRight} fullWidth className="max-w-sm sm:!w-auto">
              Browse crackers
            </Button>
          }
        />
      </PageContainer>
    )
  }

  const productLabel = uniqueProductCount === 1 ? 'product' : 'products'
  const itemLabel = estimateCount === 1 ? 'item' : 'items'

  const headerEyebrow =
    step === 'estimate' ? 'My estimate' : step === 'details' ? 'Your details' : 'Review your request'
  const headerTitle =
    step === 'estimate' ? 'Your Diwali picks' : step === 'details' ? 'Almost there' : 'Everything looks good?'
  const headerSupport =
    step === 'estimate'
      ? "Review the crackers you've selected before sharing your request with us."
      : step === 'details'
        ? 'Tell us where we can reach you.'
        : 'Check your estimate and contact details before sending your WhatsApp request.'

  return (
    <PageContainer>
      <header className="max-w-2xl">
        <p className="editorial-label-festive text-[var(--color-maroon)]">{headerEyebrow}</p>
        <h1 className="editorial-title mt-2">{headerTitle}</h1>
        {step === 'estimate' ? (
          <p className="mt-2 text-sm font-medium text-[var(--color-charcoal)]">
            {uniqueProductCount} {productLabel} · {estimateCount} {itemLabel}
          </p>
        ) : null}
        <p className="mt-2 text-sm text-[var(--color-muted)]">{headerSupport}</p>
        <EstimateProgress currentStep={step} />
      </header>

      {step === 'estimate' ? (
        <div className="mt-6 grid gap-8 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_min(18rem,30%)] lg:items-start lg:gap-10">
          <section aria-labelledby="estimate-items-heading" className="min-w-0">
            <h2 id="estimate-items-heading" className="sr-only">
              Selected products
            </h2>

            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)]">
              <ul className="divide-y divide-[var(--color-border)]">
                {rows.map((row) => (
                  <li key={row.productId}>
                    <EstimateItem
                      row={row}
                      onIncrease={increaseQuantity}
                      onDecrease={decreaseQuantity}
                      onRemove={removeFromEstimate}
                    />
                  </li>
                ))}
              </ul>
            </div>

            {/* Mobile: scroll to continue — no fixed sidebar */}
            <div className="mt-6 border-t border-[var(--color-border)] pt-6 lg:hidden">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Estimated total</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--color-maroon)]">{formatINR(estimateSubtotal)}</p>
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                Final availability and price will be confirmed by the stall.
              </p>
              <Button type="button" variant="primary" iconRight={ArrowRight} fullWidth className="mt-5" onClick={goToDetails}>
                Continue to your details
              </Button>
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                We&apos;ll use these details to send your estimate request on WhatsApp.
              </p>
              <Button type="button" variant="ghost" size="sm" className="mt-4" onClick={handleClear}>
                Clear estimate
              </Button>
            </div>

            <div className="mt-6 hidden lg:block">
              <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
                Clear estimate
              </Button>
            </div>
          </section>

          <EstimateSummaryPanel
            uniqueProductCount={uniqueProductCount}
            estimateCount={estimateCount}
            subtotal={estimateSubtotal}
            primaryLabel="Continue to your details"
            onPrimary={goToDetails}
            helperText="We'll use these details to send your estimate request on WhatsApp."
          />
        </div>
      ) : null}

      {step === 'details' ? (
        <div className="mt-6 max-w-2xl space-y-6 lg:mt-8">
          <CustomerDetailsForm showIntro={false} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" icon={ArrowLeft} onClick={() => setStep('estimate')}>
              Back to estimate
            </Button>
            <Button type="button" variant="primary" iconRight={ArrowRight} onClick={goToReview} className="sm:min-w-[12rem]">
              Continue to review
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="mt-6 max-w-2xl space-y-6 lg:mt-8">
          <ReviewSection
            rows={rows}
            subtotal={estimateSubtotal}
            details={details}
            onEditDetails={() => setStep('details')}
            whatsAppUrl={whatsAppUrl}
            canSend={isValid}
            onSendAttempt={handleSendAttempt}
          />
          <Button type="button" variant="ghost" icon={ArrowLeft} onClick={() => setStep('details')}>
            Edit details
          </Button>
        </div>
      ) : null}
    </PageContainer>
  )
}
