import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import PackPreviewCard from './PackPreviewCard'
import { getResolvedCrackerPacks } from '../../utils/crackerPacks'

const ICON = { strokeWidth: 1.8 }

export default function CrackerPacksSection() {
  const packs = getResolvedCrackerPacks()
  if (!packs.length) return null

  return (
    <section
      className="family-packs-section section-y-compact hairline-t bg-[var(--color-white)]"
      aria-labelledby="family-packs-heading"
    >
      <div className="container-page family-packs-section__container">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-lg">
            <p className="editorial-label">Ready-made value</p>
            <h2 id="family-packs-heading" className="editorial-title mt-2">
              Family Packs
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
              Seven fixed-price combinations from our stall list. View exact contents, then add every item to your estimate.
            </p>
          </div>
          <Link
            to="/packs"
            className="focus-ring hidden items-center gap-1 text-sm font-semibold text-[var(--color-maroon)] md:inline-flex"
          >
            View All Packs
            <ChevronRight className="h-4 w-4" {...ICON} aria-hidden="true" />
          </Link>
        </div>

        <div className="pack-carousel pack-carousel--animated mt-5 md:mt-6">
          <div className="pack-carousel__track scroll-chips md:grid md:grid-cols-3 md:gap-4 md:overflow-visible lg:grid-cols-4 lg:gap-5">
            {packs.map((pack) => (
              <PackPreviewCard key={pack.slug} pack={pack} className="pack-carousel__slide" />
            ))}
          </div>
        </div>

        <Link
          to="/packs"
          className="focus-ring mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-maroon)] md:hidden"
        >
          View All Packs
          <ChevronRight className="h-4 w-4" {...ICON} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}
