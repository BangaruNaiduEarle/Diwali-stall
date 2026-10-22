import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, MessageCircle, ReceiptText, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { submitPublicCustomerRequest } from '../api/publicCustomerRequests'
import CustomerDetailsForm from '../components/CustomerDetailsForm'
import EmptyState from '../components/EmptyState'
import EstimateItem from '../components/estimate/EstimateItem'
import EstimateFamilyPackItem from '../components/estimate/EstimateFamilyPackItem'
import EstimateProgress from '../components/estimate/EstimateProgress'
import EstimateConfirmDialog from '../components/estimate/EstimateConfirmDialog'
import EstimateSummaryPanel from '../components/estimate/EstimateSummaryPanel'
import FreeDoorDeliveryNotice from '../components/estimate/FreeDoorDeliveryNotice.jsx'
import PageContainer from '../components/PageContainer'
import ComplimentaryGiftPromo from '../components/promo/ComplimentaryGiftPromo'
import Button from '../components/ui/Button'
import CatalogueProductsGate from '../components/catalogue/CatalogueProductsGate'
import { useCatalogueProducts } from '../context/CatalogueProductsContext'
import { useCustomerDetails } from '../context/CustomerDetailsContext'
import { useEstimate } from '../context/EstimateContext'
import { usePageTitle } from '../hooks/usePageTitle'
import { getMobileDigits, validateCustomerDetails } from '../utils/customerDetailsHelpers'
import { formatINR } from '../utils/currency.js'
import {
  computeQualifyingOrderTotalInr,
  getFreeDoorDeliveryUiMessage,
  isFreeDoorDeliveryEligibleInr,
} from '../utils/freeDoorDelivery.js'
import {
  buildCustomerRequestBody,
  buildSubmissionFingerprint,
  createSubmitGuard,
  idempotencyKeyFromFingerprint,
} from '../utils/customerRequestPayload'
import {
  getEstimateDisplayRows,
  getProductById,
  isFamilyPackEstimateItem,
} from '../utils/estimateHelpers'
import { getWhatsAppEstimateUrl } from '../utils/whatsapp'

/** @param {Array<Record<string, unknown>>} items */
function snapshotEstimateLinesForHistory(items) {
  return items.map((entry) => {
    if (isFamilyPackEstimateItem(entry)) {
      const snapshotPricePaise = Number(entry.snapshotPricePaise)
      return {
        lineType: 'family_pack',
        familyPackId: entry.familyPackId,
        quantity: entry.quantity,
        unit: 'Family pack',
        label: entry.snapshotName ?? null,
        ...(Number.isInteger(snapshotPricePaise) && snapshotPricePaise > 0
          ? { snapshotPricePaise }
          : {}),
      }
    }
    const product = getProductById(entry.productId)
    const pack = product?.pack?.trim()
    return {
      lineType: 'product',
      productId: entry.productId,
      quantity: entry.quantity,
      unit: pack || null,
    }
  })
}

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
              {rows.map((row) =>
                row.lineType === 'family_pack' ? (
                  <tr key={row.familyPackId} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2.5 pr-3 text-[var(--color-charcoal)]">{row.name}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{row.quantity}</td>
                    <td className="py-2.5 text-[var(--color-muted)]">Family pack</td>
                  </tr>
                ) : (
                  <tr key={row.product.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2.5 pr-3 text-[var(--color-charcoal)]">{row.product.name}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{row.quantity}</td>
                    <td className="py-2.5 text-[var(--color-muted)]">{displayUnit(row.product)}</td>
                  </tr>
                ),
              )}
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

function ConfirmSentSection({ publicReference, onConfirmSent, onNotYet }) {
  return (
    <div className="space-y-6">
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] p-5 sm:p-6"
        aria-labelledby="confirm-sent-heading"
      >
        <h2 id="confirm-sent-heading" className="text-lg font-semibold text-[var(--color-charcoal)]">
          Did you send this estimate on WhatsApp?
        </h2>
        {publicReference ? (
          <p className="mt-4 text-sm font-semibold text-[var(--color-maroon)]" role="status">
            Your estimate reference is {publicReference}. It is included in your WhatsApp message — quote it if you
            contact us again.
          </p>
        ) : null}
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          WhatsApp should have opened with your list. We cannot tell whether the message was sent — confirm only after
          you tap send in WhatsApp.
        </p>
        <p className="mt-3 text-sm text-[var(--color-charcoal)]">
          Your cart was cleared after we saved your request. Start a new estimate when you want to build another list.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="primary" fullWidth onClick={onConfirmSent}>
            Yes, I sent it on WhatsApp
          </Button>
          <Button type="button" variant="secondary" surface="light" fullWidth onClick={onNotYet}>
            Not yet
          </Button>
        </div>
      </section>
    </div>
  )
}

function PostShareSection({ onStartNewEstimate, historyCount, lastSavedReference }) {
  return (
    <div className="space-y-6">
      <section
        className="rounded-[var(--radius-lg)] border border-[var(--color-gold)]/40 bg-[var(--color-ivory)] p-5 sm:p-6"
        aria-labelledby="post-share-heading"
      >
        <h2 id="post-share-heading" className="text-lg font-semibold text-[var(--color-charcoal)]">
          Thanks — your draft is still on this device
        </h2>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          When you start a new estimate, we&apos;ll save a copy of this list to your history and clear the active draft
          so old and new items do not mix.
        </p>
        {lastSavedReference ? (
          <p className="mt-4 text-sm font-medium text-[var(--color-maroon)]" role="status">
            Saved to history as {lastSavedReference}.
          </p>
        ) : null}
        <Button type="button" variant="primary" icon={Sparkles} fullWidth className="mt-6" onClick={onStartNewEstimate}>
          Start new estimate
        </Button>
        {historyCount > 0 ? (
          <Button to="/estimate/history" variant="secondary" surface="light" fullWidth className="mt-3">
            View previous estimates ({historyCount})
          </Button>
        ) : null}
        <Button to="/crackers" variant="ghost" fullWidth className="mt-3">
          Keep browsing crackers
        </Button>
      </section>
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
    removeFamilyPackFromEstimate,
    setFamilyPackQuantity,
    clearEstimate,
    startNewDraftEstimate,
    archiveSharedEstimate,
    sharedHistory,
  } = useEstimate()
  const { details, isValid, markTouched, setRequireDeliveryLocation } = useCustomerDetails()
  const [submitting, setSubmitting] = useState(false)
  const [sendError, setSendError] = useState('')
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [startNewDialogOpen, setStartNewDialogOpen] = useState(false)
  const [clearNotice, setClearNotice] = useState('')
  const [lastSavedReference, setLastSavedReference] = useState('')
  const [savedPublicReference, setSavedPublicReference] = useState('')
  const whatsappSentConfirmedRef = useRef(false)
  const whatsAppOpenedForReferenceRef = useRef(false)
  const pendingShareRef = useRef(
    /** @type {{ fingerprint: string, items: { productId: string, quantity: number }[] } | null} */ (null),
  )

  const fingerprintRef = useRef('')
  const idempotencyKeyRef = useRef(/** @type {string | null} */ (null))
  const submitGuardRef = useRef(/** @type {ReturnType<typeof createSubmitGuard> | null} */ (null))
  if (!submitGuardRef.current) {
    submitGuardRef.current = createSubmitGuard()
  }

  const { loading: catalogueLoading, error: catalogueError, refresh: refreshCatalogue } = useCatalogueProducts()
  const rows = getEstimateDisplayRows(estimateItems)
  const qualifyingTotalInr = useMemo(
    () => computeQualifyingOrderTotalInr(estimateItems),
    [estimateItems],
  )
  const deliveryUi = useMemo(
    () => getFreeDoorDeliveryUiMessage(qualifyingTotalInr),
    [qualifyingTotalInr],
  )

  useEffect(() => {
    setRequireDeliveryLocation(isFreeDoorDeliveryEligibleInr(qualifyingTotalInr))
  }, [qualifyingTotalInr, setRequireDeliveryLocation])

  const adjustFamilyPackQuantity = useCallback(
    (familyPackId, delta) => {
      const current =
        estimateItems.find((i) => isFamilyPackEstimateItem(i) && i.familyPackId === familyPackId)?.quantity ?? 0
      setFamilyPackQuantity(familyPackId, current + delta)
    },
    [estimateItems, setFamilyPackQuantity],
  )
  const draftLineCount = estimateItems.length
  const isShareFollowUp = step === 'confirm-sent' || step === 'post-share'

  useEffect(() => {
    if (!clearNotice) return
    const t = window.setTimeout(() => setClearNotice(''), 4000)
    return () => window.clearTimeout(t)
  }, [clearNotice])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  useEffect(() => {
    if (step !== 'confirm-sent') return
    if (whatsAppOpenedForReferenceRef.current) return
    const shareItems = pendingShareRef.current?.items?.length ? pendingShareRef.current.items : estimateItems
    const url = getWhatsAppEstimateUrl(shareItems, details, savedPublicReference || null)
    if (!url) return
    whatsAppOpenedForReferenceRef.current = true
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [step, savedPublicReference, estimateItems, details])

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

      const requestPayload =
        result.request && typeof result.request === 'object'
          ? /** @type {Record<string, unknown>} */ (result.request)
          : {}
      const publicReference =
        typeof requestPayload.publicReference === 'string' ? requestPayload.publicReference.trim() : ''

      const fingerprint = fingerprintRef.current
      const itemsSnapshot = snapshotEstimateLinesForHistory(estimateItems)

      pendingShareRef.current = {
        fingerprint,
        items: [...estimateItems],
      }

      if (fingerprint && itemsSnapshot.length) {
        const archived = archiveSharedEstimate({
          submissionFingerprint: fingerprint,
          items: itemsSnapshot,
          ...(publicReference ? { reference: publicReference } : {}),
        })
        if (archived.record?.reference) {
          setLastSavedReference(archived.record.reference)
        }
      }

      clearEstimate()

      whatsappSentConfirmedRef.current = false
      whatsAppOpenedForReferenceRef.current = false
      setLastSavedReference('')
      setSavedPublicReference(publicReference)
      setStep('confirm-sent')
    } catch {
      setSendError('Could not save your request. Please try again.')
    } finally {
      submitGuardRef.current.end()
      setSubmitting(false)
    }
  }, [
    archiveSharedEstimate,
    clearEstimate,
    details,
    estimateItems,
    ensureIdempotencyKey,
    isValid,
    markTouched,
  ])

  const handleClearRequest = () => setClearDialogOpen(true)

  const handleClearConfirm = () => {
    clearEstimate()
    pendingShareRef.current = null
    whatsappSentConfirmedRef.current = false
    whatsAppOpenedForReferenceRef.current = false
    setLastSavedReference('')
    setSavedPublicReference('')
    setStep('estimate')
    setClearDialogOpen(false)
    setClearNotice('Your draft estimate was cleared.')
  }

  const handleConfirmSent = useCallback(() => {
    whatsappSentConfirmedRef.current = true
    setStep('post-share')
  }, [])

  const handleStartNewRequest = () => setStartNewDialogOpen(true)

  const handleStartNewConfirm = useCallback(() => {
    const pending = pendingShareRef.current
    if (whatsappSentConfirmedRef.current && pending?.fingerprint && pending.items.length) {
      const result = archiveSharedEstimate({
        submissionFingerprint: pending.fingerprint,
        items: snapshotEstimateLinesForHistory(pending.items),
        ...(savedPublicReference ? { reference: savedPublicReference } : {}),
      })
      if (result.record?.reference) {
        setLastSavedReference(result.record.reference)
      }
    }
    startNewDraftEstimate()
    pendingShareRef.current = null
    whatsappSentConfirmedRef.current = false
    whatsAppOpenedForReferenceRef.current = false
    setSavedPublicReference('')
    setStartNewDialogOpen(false)
    setStep('estimate')
    setClearNotice('Your new draft estimate is ready — add products when you are ready.')
  }, [archiveSharedEstimate, savedPublicReference, startNewDraftEstimate])

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

  if (catalogueLoading && estimateItems.length > 0) {
    return (
      <PageContainer>
        <CatalogueProductsGate
          loading
          error={null}
          onRetry={refreshCatalogue}
        />
      </PageContainer>
    )
  }

  if (catalogueError && estimateItems.length > 0) {
    return (
      <PageContainer>
        <CatalogueProductsGate loading={false} error={catalogueError} onRetry={refreshCatalogue} />
      </PageContainer>
    )
  }

  if (!isShareFollowUp && draftLineCount === 0) {
    return (
      <PageContainer>
        <header className="max-w-xl">
          <p className="editorial-label-festive text-[var(--color-maroon)]">My estimate</p>
          <h1 className="editorial-title mt-2">Your draft estimate is empty</h1>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Start exploring our crackers and add your favourites here. Your draft is saved on this device as you browse.
          </p>
          {clearNotice ? (
            <p className="mt-3 text-sm font-medium text-[var(--color-maroon)]" role="status">
              {clearNotice}
            </p>
          ) : null}
          {sharedHistory.length > 0 ? (
            <Link
              to="/estimate/history"
              className="focus-ring mt-4 inline-block text-sm font-medium text-[var(--color-brand)] underline-offset-2 hover:underline"
            >
              View previous estimates ({sharedHistory.length})
            </Link>
          ) : null}
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
        <EstimateConfirmDialog
          open={clearDialogOpen}
          title="Clear draft estimate?"
          description="This removes every item from your active draft on this device. Previous estimates in history are not affected."
          cancelLabel="Keep estimate"
          confirmLabel="Clear estimate"
          onCancel={() => setClearDialogOpen(false)}
          onConfirm={handleClearConfirm}
        />
      </PageContainer>
    )
  }

  if (!isShareFollowUp && draftLineCount > 0 && rows.length === 0 && !catalogueLoading) {
    return (
      <PageContainer>
        <header className="max-w-xl">
          <p className="editorial-label-festive text-[var(--color-maroon)]">My estimate</p>
          <h1 className="editorial-title mt-2">Some saved items are unavailable</h1>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Your draft still has {estimateCount} saved {estimateCount === 1 ? 'item' : 'items'}, but they cannot be shown
            in the catalogue right now. Clear the draft to reset, or try again after refreshing the catalogue.
          </p>
        </header>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="primary" onClick={handleClearRequest}>
            Clear estimate
          </Button>
          <Button type="button" variant="secondary" surface="light" onClick={() => refreshCatalogue()}>
            Refresh catalogue
          </Button>
        </div>
        <EstimateConfirmDialog
          open={clearDialogOpen}
          title="Clear draft estimate?"
          description="This removes every item from your active draft on this device. Previous estimates in history are not affected."
          cancelLabel="Keep estimate"
          confirmLabel="Clear estimate"
          onCancel={() => setClearDialogOpen(false)}
          onConfirm={handleClearConfirm}
        />
      </PageContainer>
    )
  }

  const productLabel = uniqueProductCount === 1 ? 'product' : 'products'
  const itemLabel = estimateCount === 1 ? 'item' : 'items'

  const headerEyebrow =
    step === 'estimate'
      ? 'Draft estimate'
      : step === 'details'
        ? 'Your details'
        : step === 'review'
          ? 'Review your request'
          : step === 'confirm-sent'
            ? 'WhatsApp'
            : 'Next steps'
  const headerTitle =
    step === 'estimate'
      ? 'Your Diwali picks'
      : step === 'details'
        ? 'Almost there'
        : step === 'review'
          ? 'Everything looks good?'
          : step === 'confirm-sent'
            ? 'Confirm your WhatsApp message'
            : 'Ready for a new list?'
  const headerSupport =
    step === 'estimate'
      ? "Review the crackers you've selected before sharing your request with us."
      : step === 'details'
        ? 'Tell us where we can reach you.'
        : step === 'review'
          ? 'Check your estimate and contact details before sending your WhatsApp request.'
          : step === 'confirm-sent'
            ? 'Confirm whether you sent the message in WhatsApp.'
            : 'Start a new estimate when ready — we save to history only when you confirm below.'

  return (
    <PageContainer>
      {clearNotice ? (
        <p className="mb-4 text-sm font-medium text-[var(--color-maroon)]" role="status">
          {clearNotice}
        </p>
      ) : null}
      <header className="max-w-2xl">
        <p className="editorial-label-festive text-[var(--color-maroon)]">{headerEyebrow}</p>
        <h1 className="editorial-title mt-2">{headerTitle}</h1>
        {step === 'estimate' ? (
          <p className="mt-2 text-sm font-medium text-[var(--color-charcoal)]">
            {uniqueProductCount} {productLabel} · {estimateCount} {itemLabel}
          </p>
        ) : null}
        <p className="mt-2 text-sm text-[var(--color-muted)]">{headerSupport}</p>
        {sharedHistory.length > 0 && (step === 'estimate' || step === 'review') ? (
          <Link
            to="/estimate/history"
            className="focus-ring mt-3 inline-block text-sm font-medium text-[var(--color-brand)] underline-offset-2 hover:underline"
          >
            View previous estimates ({sharedHistory.length})
          </Link>
        ) : null}
        {step === 'estimate' ? <ComplimentaryGiftPromo variant="inline" className="mt-4 max-w-md" /> : null}
        {step === 'estimate' || step === 'details' || step === 'review' ? (
          <EstimateProgress currentStep={step} />
        ) : null}
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
                {rows.map((row) =>
                  row.lineType === 'family_pack' ? (
                    <li key={row.familyPackId}>
                      <EstimateFamilyPackItem
                        row={row}
                        onIncrease={(id) => adjustFamilyPackQuantity(id, 1)}
                        onDecrease={(id) => adjustFamilyPackQuantity(id, -1)}
                        onRemove={removeFamilyPackFromEstimate}
                      />
                    </li>
                  ) : (
                    <li key={row.productId}>
                      <EstimateItem
                        row={row}
                        onIncrease={increaseQuantity}
                        onDecrease={decreaseQuantity}
                        onRemove={removeFromEstimate}
                      />
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div className="mt-6 border-t border-[var(--color-border)] pt-6 lg:hidden">
              {qualifyingTotalInr > 0 ? (
                <p className="text-sm font-semibold tabular-nums text-[var(--color-charcoal)]">
                  Estimated total (listed prices): {formatINR(qualifyingTotalInr)}
                </p>
              ) : null}
              <FreeDoorDeliveryNotice
                message={deliveryUi.message}
                qualified={deliveryUi.qualified}
                qualifyingTotalInr={qualifyingTotalInr}
              />
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">
                Pricing is confirmed on WhatsApp after we review your list.
              </p>
              <Button type="button" variant="primary" iconRight={ArrowRight} fullWidth className="mt-5" onClick={goToDetails}>
                Continue to your details
              </Button>
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                We&apos;ll use these details to send your estimate request on WhatsApp.
              </p>
              <Button type="button" variant="ghost" size="sm" className="mt-4" onClick={handleClearRequest}>
                Clear estimate
              </Button>
            </div>

            <div className="mt-6 hidden lg:block">
              <Button type="button" variant="ghost" size="sm" onClick={handleClearRequest}>
                Clear estimate
              </Button>
            </div>
          </section>

          <EstimateSummaryPanel
            uniqueProductCount={uniqueProductCount}
            estimateCount={estimateCount}
            qualifyingTotalInr={qualifyingTotalInr}
            deliveryMessage={deliveryUi.message}
            deliveryQualified={deliveryUi.qualified}
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

      {step === 'confirm-sent' ? (
        <div className="mt-6 max-w-2xl lg:mt-8">
          <ConfirmSentSection
            publicReference={savedPublicReference}
            onConfirmSent={handleConfirmSent}
            onNotYet={() => setStep('review')}
          />
        </div>
      ) : null}

      {step === 'post-share' ? (
        <div className="mt-6 max-w-2xl lg:mt-8">
          <PostShareSection
            onStartNewEstimate={handleStartNewRequest}
            historyCount={sharedHistory.length}
            lastSavedReference={lastSavedReference}
          />
        </div>
      ) : null}

      <EstimateConfirmDialog
        open={clearDialogOpen}
        title="Clear draft estimate?"
        description="This removes every item from your active draft on this device. Previous estimates in history are not affected."
        cancelLabel="Keep estimate"
        confirmLabel="Clear estimate"
        onCancel={() => setClearDialogOpen(false)}
        onConfirm={handleClearConfirm}
      />

      <EstimateConfirmDialog
        open={startNewDialogOpen}
        title="Start a new estimate?"
        description="We will save this list to your estimate history (once), then clear the active draft so your next selections start fresh."
        cancelLabel="Keep current draft"
        confirmLabel="Start new estimate"
        onCancel={() => setStartNewDialogOpen(false)}
        onConfirm={handleStartNewConfirm}
      />
    </PageContainer>
  )
}
