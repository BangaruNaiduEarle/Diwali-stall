import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Check, Plus } from 'lucide-react'
import Breadcrumbs from '../components/Breadcrumbs'
import PackContentsTable from '../components/packs/PackContentsTable'
import PageContainer from '../components/PageContainer'
import ComplimentaryGiftPromo from '../components/promo/ComplimentaryGiftPromo'
import Button from '../components/ui/Button'
import { useEstimate } from '../context/EstimateContext'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatINR } from '../utils/currency'
import {
  applyPackToEstimate,
  getPackAddBlockers,
  getResolvedCrackerPackBySlug,
} from '../utils/crackerPacks'

export default function PackDetail() {
  const { packSlug } = useParams()
  const pack = getResolvedCrackerPackBySlug(packSlug)
  const { getQuantity, updateQuantity } = useEstimate()
  const [addedNotice, setAddedNotice] = useState(false)
  const [adding, setAdding] = useState(false)

  usePageTitle(pack ? pack.displayName : 'Pack not found')

  if (!pack) {
    return <Navigate to="/404" replace />
  }

  const blockers = getPackAddBlockers(pack)
  const canAdd = blockers.length === 0

  const handleAddPack = () => {
    if (!canAdd || adding) return
    setAdding(true)
    applyPackToEstimate(pack, { getQuantity, setQuantity: updateQuantity })
    setAddedNotice(true)
    window.setTimeout(() => setAdding(false), 400)
  }

  return (
    <PageContainer className="py-5 sm:py-10 md:py-12 lg:py-14">
      <Breadcrumbs
        editorial
        items={[
          { label: 'Home', to: '/' },
          { label: 'Family Packs', to: '/packs' },
          { label: pack.displayName },
        ]}
      />

      <div className="mt-4 max-w-3xl">
        <p className="editorial-label">Family pack</p>
        <h1 className="editorial-title mt-2">{pack.displayName}</h1>
        <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--color-maroon)]">{formatINR(pack.price)}</p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{pack.description}</p>
        <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">
          {pack.distinctTypes} distinct product types · {pack.billUnits} total bill units (boxes/packets/pieces as listed).
        </p>

        <ComplimentaryGiftPromo variant="inline" className="mt-5" />

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Button type="button" variant="primary" size="md" icon={Plus} disabled={!canAdd || adding} onClick={handleAddPack}>
            Add to Estimate
          </Button>
          <Button to="/estimate" variant="secondary" size="md">
            View estimate
          </Button>
        </div>

        {blockers.length ? (
          <p className="mt-3 text-sm text-[var(--color-red)]" role="alert">
            {blockers[0]}
          </p>
        ) : null}

        {addedNotice ? (
          <p
            className="mt-3 flex items-center gap-2 text-sm font-medium text-[var(--color-maroon)]"
            role="status"
            aria-live="polite"
          >
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            Pack items added to your estimate.
            <Link to="/estimate" className="focus-ring underline underline-offset-2">
              Review estimate
            </Link>
          </p>
        ) : null}

        <PackContentsTable items={pack.items} />

        <p className="mt-6 text-sm">
          <Link to="/packs" className="focus-ring font-semibold text-[var(--color-maroon)] underline-offset-2 hover:underline">
            ← Back to packs
          </Link>
        </p>
      </div>
    </PageContainer>
  )
}
