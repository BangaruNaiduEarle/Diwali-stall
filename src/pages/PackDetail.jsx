import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Check, Plus } from 'lucide-react'
import { fetchPublicFamilyPackBySlug } from '../api/publicFamilyPacks.js'
import Breadcrumbs from '../components/Breadcrumbs'
import PackContentsTable from '../components/packs/PackContentsTable'
import PageContainer from '../components/PageContainer'
import ComplimentaryGiftPromo from '../components/promo/ComplimentaryGiftPromo'
import Button from '../components/ui/Button'
import { useEstimate } from '../context/EstimateContext'
import { useProductImageLightbox } from '../context/ProductImageLightboxContext'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatINR } from '../utils/currency'
import { applyPackToEstimate, getPackAddBlockers } from '../utils/crackerPacks'

export default function PackDetail() {
  const { packSlug } = useParams()
  const { addFamilyPackToEstimate } = useEstimate()
  const { openLightbox } = useProductImageLightbox()
  const [pack, setPack] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')
  const [addedNotice, setAddedNotice] = useState(false)
  const [adding, setAdding] = useState(false)
  const [activeImage, setActiveImage] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      setNotFound(false)
      const result = await fetchPublicFamilyPackBySlug(String(packSlug ?? ''))
      if (cancelled) return
      if (!result.ok) {
        setPack(null)
        setNotFound(Boolean(result.notFound))
        setError(result.message)
        setLoading(false)
        return
      }
      setPack(result.familyPack)
      setActiveImage(0)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [packSlug])

  const viewPack = useMemo(() => {
    if (!pack) return null
    return {
      id: String(pack.id),
      slug: String(pack.slug),
      displayName: String(pack.name),
      description: String(pack.shortDescription ?? ''),
      price: Number(pack.sellingPriceInr ?? 0),
      items: (pack.items ?? []).map((row) => ({
        itemName: row.name,
        quantity: row.quantity,
        unit: row.unit,
      })),
    }
  }, [pack])

  const imageUrls = useMemo(() => {
    if (!pack?.images?.length) {
      return pack?.coverImageUrl ? [String(pack.coverImageUrl)] : []
    }
    return pack.images.map((img) => String(img.url ?? '')).filter(Boolean)
  }, [pack])

  usePageTitle(viewPack ? viewPack.displayName : loading ? 'Loading pack' : 'Pack not found')

  if (loading) {
    return (
      <PageContainer className="py-10">
        <p className="text-sm text-[var(--color-muted)]" aria-busy="true">
          Loading pack…
        </p>
      </PageContainer>
    )
  }

  if (notFound || !viewPack) {
    return <Navigate to="/404" replace />
  }

  if (error && !viewPack) {
    return (
      <PageContainer className="py-10">
        <p className="text-sm text-[var(--color-red)]" role="alert">
          {error}
        </p>
      </PageContainer>
    )
  }

  const blockers = getPackAddBlockers(viewPack)
  const canAdd = blockers.length === 0
  const heroUrl = imageUrls[activeImage] ?? imageUrls[0] ?? ''

  const handleAddPack = () => {
    if (!canAdd || adding) return
    setAdding(true)
    applyPackToEstimate(viewPack, { addFamilyPackToEstimate })
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
          { label: viewPack.displayName },
        ]}
      />

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div>
          <div className="product-image-well flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-image-well)]">
            {heroUrl ? (
              <button
                type="button"
                className="product-image-zoom-trigger focus-ring h-full w-full cursor-zoom-in p-4"
                aria-label={`View larger image of ${viewPack.displayName}`}
                onClick={() =>
                  openLightbox({
                    productName: viewPack.displayName,
                    images: imageUrls,
                    startIndex: activeImage,
                  })
                }
              >
                <img src={heroUrl} alt="" className="max-h-full max-w-full object-contain" />
              </button>
            ) : (
              <span className="text-sm text-[var(--color-muted)]">No image</span>
            )}
          </div>
          {imageUrls.length > 1 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {imageUrls.map((url, index) => (
                <button
                  key={url}
                  type="button"
                  className={`focus-ring h-14 w-14 overflow-hidden rounded-[var(--radius-sm)] border ${
                    index === activeImage ? 'border-[var(--color-maroon)]' : 'border-[var(--color-border)]'
                  }`}
                  aria-label={`Show image ${index + 1}`}
                  onClick={() => setActiveImage(index)}
                >
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="max-w-3xl">
          <p className="editorial-label">Family pack</p>
          <h1 className="editorial-title mt-2">{viewPack.displayName}</h1>
          <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--color-maroon)]">{formatINR(viewPack.price)}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{viewPack.description}</p>

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
              Family pack added to your estimate.
              <Link to="/estimate" className="focus-ring underline underline-offset-2">
                Review estimate
              </Link>
            </p>
          ) : null}

          <PackContentsTable items={viewPack.items} />

          <p className="mt-6 text-sm">
            <Link to="/packs" className="focus-ring font-semibold text-[var(--color-maroon)] underline-offset-2 hover:underline">
              ← Back to packs
            </Link>
          </p>
        </div>
      </div>
    </PageContainer>
  )
}
