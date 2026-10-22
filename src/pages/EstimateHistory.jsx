import { ArrowLeft, ReceiptText } from 'lucide-react'
import { Link } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PageContainer from '../components/PageContainer'
import Button from '../components/ui/Button'
import { useEstimate } from '../context/EstimateContext'
import { formatINR } from '../utils/currency.js'
import { paiseToInr } from '../utils/currencyPaise.js'
import { getProductById } from '../utils/estimateHelpers'
import { getFamilyPackById } from '../utils/familyPackCatalogue.js'
import { historyLineKey } from '../utils/estimateHistory.js'
import { usePageTitle } from '../hooks/usePageTitle'

function formatSharedDate(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function lineUnit(storedUnit, product) {
  if (storedUnit) return storedUnit
  const pack = product?.pack?.trim()
  return pack || '—'
}

function isFamilyPackHistoryLine(line) {
  return line.lineType === 'family_pack' || Boolean(line.familyPackId)
}

function historyLineDisplayName(line) {
  if (isFamilyPackHistoryLine(line)) {
    const fromLabel = typeof line.label === 'string' && line.label.trim() ? line.label.trim() : null
    if (fromLabel) return fromLabel
    const catalogue = getFamilyPackById(line.familyPackId)
    if (catalogue?.name) return String(catalogue.name)
    return line.familyPackId ?? 'Family pack'
  }
  const product = getProductById(line.productId)
  return product?.name ?? line.productId
}

function historyLinePriceHint(line) {
  if (!isFamilyPackHistoryLine(line)) return null
  const paise = Number(line.snapshotPricePaise)
  if (!Number.isInteger(paise) || paise <= 0) return null
  const unitInr = paiseToInr(paise)
  const totalInr = paiseToInr(paise * line.quantity)
  return `${formatINR(unitInr)} each · ${formatINR(totalInr)} line`
}

export default function EstimateHistory() {
  usePageTitle('Previous estimates')
  const { sharedHistory } = useEstimate()

  if (!sharedHistory.length) {
    return (
      <PageContainer>
        <header className="max-w-xl">
          <p className="editorial-label-festive text-[var(--color-maroon)]">My estimates</p>
          <h1 className="editorial-title mt-2">No previous estimates yet</h1>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            After you submit an estimate request, a copy appears here for your reference.
          </p>
        </header>
        <EmptyState
          icon={ReceiptText}
          title=""
          description=""
          action={
            <Button to="/estimate" variant="primary" fullWidth className="max-w-sm sm:!w-auto">
              Back to draft estimate
            </Button>
          }
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <header className="max-w-2xl">
        <p className="editorial-label-festive text-[var(--color-maroon)]">My estimates</p>
        <h1 className="editorial-title mt-2">Previous estimates</h1>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Read-only copies of estimates you submitted. They are not added to your current draft.
        </p>
        <Button to="/estimate" variant="ghost" icon={ArrowLeft} className="mt-4">
          Back to draft estimate
        </Button>
      </header>

      <ul className="mt-8 space-y-4">
        {sharedHistory.map((record) => {
          const itemCount = record.items.reduce((sum, line) => sum + line.quantity, 0)
          return (
            <li
              key={record.id}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] p-5 sm:p-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--color-charcoal)]">{record.reference}</h2>
                <span className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--color-muted)]">
                  {record.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--color-muted)]">{formatSharedDate(record.sharedAt)}</p>
              <p className="mt-2 text-sm text-[var(--color-charcoal)]">
                {record.items.length} lines · {itemCount} items
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[260px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                      <th className="pb-2 pr-3">Item</th>
                      <th className="pb-2 pr-3 text-right">Qty</th>
                      <th className="pb-2">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.items.map((line) => {
                      const isPack = isFamilyPackHistoryLine(line)
                      const product = isPack ? null : getProductById(line.productId)
                      const name = historyLineDisplayName(line)
                      const priceHint = historyLinePriceHint(line)
                      return (
                        <tr key={historyLineKey(line)} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="py-2 pr-3 text-[var(--color-charcoal)]">
                            <span>{name}</span>
                            {isPack ? (
                              <span className="ml-1 text-xs font-medium text-[var(--color-muted)]">(Family pack)</span>
                            ) : null}
                            {priceHint ? (
                              <p className="mt-0.5 text-xs text-[var(--color-muted)]">{priceHint}</p>
                            ) : null}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums font-medium">{line.quantity}</td>
                          <td className="py-2 text-[var(--color-muted)]">
                            {isPack ? lineUnit(line.unit, null) : lineUnit(line.unit, product)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-6 text-xs text-[var(--color-muted)]">
        Need a fresh list?{' '}
        <Link to="/estimate" className="focus-ring font-medium text-[var(--color-brand)] underline-offset-2 hover:underline">
          Return to your draft estimate
        </Link>{' '}
        and use Start new estimate after sharing.
      </p>
    </PageContainer>
  )
}
