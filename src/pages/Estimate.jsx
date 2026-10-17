import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, MessageCircle, ReceiptText } from 'lucide-react'
import { submitPublicCustomerRequest } from '../api/publicCustomerRequests'
import CustomerDetailsForm from '../components/CustomerDetailsForm'
import EmptyState from '../components/EmptyState'
import EstimateItem from '../components/estimate/EstimateItem'
import EstimateProgress from '../components/estimate/EstimateProgress'
import EstimateSummaryPanel from '../components/estimate/EstimateSummaryPanel'
import PageContainer from '../components/PageContainer'
import ComplimentaryGiftPromo from '../components/promo/ComplimentaryGiftPromo'
import Button from '../components/ui/Button'
import { useCustomerDetails } from '../context/CustomerDetailsContext'
import { useEstimate } from '../context/EstimateContext'
import { usePageTitle } from '../hooks/usePageTitle'
import { getMobileDigits, validateCustomerDetails } from '../utils/customerDetailsHelpers'
import {
  buildCustomerRequestBody,
  buildSubmissionFingerprint,
  createSubmitGuard,
  idempotencyKeyFromFingerprint,
} from '../utils/customerRequestPayload'
import { getEstimateProducts } from '../utils/estimateHelpers'
import { getWhatsAppEstimateUrl } from '../utils/whatsapp'

function displayUnit(product) {
  const pack = product?.pack?.trim()
  return pack || '—'
}

function ReviewSection({
  rows,
  details,
  onEditDetails,
  onSend,
  onSendAttempt,
  canSend,
  submitting,
  sendError,
}) {
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
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[280px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                <th className="pb-2 pr-3 font-semibold">Item</th>
                <th className="pb-2 pr-3 text-right font-semibold">Qty</th>
                <th className="pb-2 font-semibold">Unit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ product, quantity }) => (
                <tr key={product.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-2.5 pr-3 text-[var(--color-charcoal)]">{product.name}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{quantity}</td>
                  <td className="py-2.5 text-[var(--color-muted)]">{displayUnit(product)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <Button
          type="button"
          variant="primary"
          icon={MessageCircle}
          fullWidth
          loading={submitting}
          disabled={!canSend && !submitting}
          onClick={canSend ? onSend : onSendAttempt}
        >
          {submitting ? 'Saving your request…' : 'Send estimate on WhatsApp'}
        </Button>
        {sendError ? (
          <p className="mt-3 text-center text-sm text-[var(--color-maroon)]" role="alert">
            {sendError}
          </p>
        ) : null}
        <p className="mt-2 text-center text-xs text-[var(--color-muted)]">
          Your list is saved with our stall team first, then WhatsApp opens with the same details — no prices included.
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
    uniqueProductCount,
    increaseQuantity,
    decreaseQuantity,
    removeFromEstimate,
    clearEstimate,
  } = useEstimate()
  const { details, isValid, markTouched } = useCustomerDetails()
  const [submitting, setSubmitting] = useState(false)
  const [sendError, setSendError] = useState('')

  const fingerprintRef = useRef('')
  const idempotencyKeyRef = useRef(/** @type {string | null} */ (null))
  const submitGuardRef = useRef(/** @type {ReturnType<typeof createSubmitGuard> | null} */ (null))
  if (!submitGuardRef.current) {
    submitGuardRef.current = createSubmitGuard()
  }

  const rows = getEstimateProducts(estimateItems)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  useEffect(() => {
    if (step !== 'review') return
    const fingerprint = buildSubmissionFingerprint(details, estimateItems)
    if (fingerprint !== fingerprintRef.current) {
      fingerprintRef.current = fingerprint
      idempotencyKeyRef.current = null
      setSendError('')
    }
  }, [step, details, estimateItems])

  const ensureIdempotencyKey = useCallback(async () => {
    if (idempotencyKeyRef.current) return idempotencyKeyRef.current
    const key = await idempotencyKeyFromFingerprint(fingerprintRef.current)
    idempotencyKeyRef.current = key
    return key
  }, [])

  const handleSendEstimate = useCallback(async () => {
    markTouched()
    if (!isValid) {
      setStep('details')
      return
    }
    if (!submitGuardRef.current.tryBegin()) return

    setSubmitting(true)
    setSendError('')

    try {
      if (!fingerprintRef.current) {
        fingerprintRef.current = buildSubmissionFingerprint(details, estimateItems)
      }
      const body = buildCustomerRequestBody(details, estimateItems)
      const idempotencyKey = await ensureIdempotencyKey()
      const result = await submitPublicCustomerRequest(body, idempotencyKey)

      if (!result.ok) {
        setSendError(result.message || 'Could not save your request. Please try again.')
        return
      }

      const whatsAppUrl = getWhatsAppEstimateUrl(estimateItems, details)
      if (whatsAppUrl) {
        window.open(whatsAppUrl, '_blank', 'noopener,noreferrer')
      }
    } catch {
      setSendError('Could not save your request. Please try again.')
    } finally {
      submitGuardRef.current.end()
      setSubmitting(false)
    }
  }, [details, estimateItems, ensureIdempotencyKey, isValid, markTouched])

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
    const fingerprint = buildSubmissionFingerprint(details, estimateItems)
    fingerprintRef.current = fingerprint
    idempotencyKeyRef.current = null
    setSendError('')
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
        {step === 'estimate' ? <ComplimentaryGiftPromo variant="inline" className="mt-4 max-w-md" /> : null}
        <EstimateProgress currentStep={step} />
      </header>

      {step === 'estimate' ? (
        <div className="mt-6 grid gap-8 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_min(18rem,30%)] lg:items-start lg:gap-10">
          <section aria-labelledby="estimate-items-heading" className="min-w-0">
            <h2 id="estimate-items-heading" className="sr-only">
              Selected products
            </h2>

            <div className="hidden overflow-x-auto rounded-t-[var(--radius-lg)] border border-b-0 border-[var(--color-border)] bg-[var(--color-ivory)]/60 px-4 py-2 sm:block">
              <div className="grid grid-cols-[minmax(0,1fr)_5rem_6rem] gap-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span>Unit</span>
              </div>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] sm:rounded-t-none sm:border-t-0">
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

            <div className="mt-6 border-t border-[var(--color-border)] pt-6 lg:hidden">
              <p className="text-xs leading-relaxed text-[var(--color-muted)]">
                Pricing is confirmed on WhatsApp after we review your list.
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
            details={details}
            onEditDetails={() => setStep('details')}
            canSend={isValid}
            onSend={handleSendEstimate}
            onSendAttempt={handleSendAttempt}
            submitting={submitting}
            sendError={sendError}
          />
          <Button type="button" variant="ghost" icon={ArrowLeft} onClick={() => setStep('details')}>
            Edit details
          </Button>
        </div>
      ) : null}
    </PageContainer>
  )
}
