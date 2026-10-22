import PageContainer from '../components/PageContainer'
import PackPreviewCard from '../components/packs/PackPreviewCard'
import { useFamilyPacks } from '../context/FamilyPacksContext.jsx'
import { usePageTitle } from '../hooks/usePageTitle'
import { mapPublicPackForCard } from '../utils/familyPackCatalogue.js'

export default function Packs() {
  usePageTitle('Family Packs')
  const { familyPacks, loading, error, refresh } = useFamilyPacks()
  const packs = familyPacks.map(mapPublicPackForCard)

  return (
    <PageContainer className="py-5 sm:py-10 md:py-12 lg:py-14">
      <p className="editorial-label">Value bundles</p>
      <h1 className="editorial-title mt-2">Family Packs</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-muted)]">
        Each pack is one line on your estimate at the listed pack price. Contents are shown for reference — included
        products are not added separately.
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-[var(--color-muted)]" aria-busy="true">
          Loading packs…
        </p>
      ) : null}

      {error ? (
        <div className="mt-8 rounded-[var(--radius-lg)] border border-[var(--color-red)]/30 bg-[var(--color-white)] p-4">
          <p className="text-sm text-[var(--color-red)]" role="alert">
            {error}
          </p>
          <button type="button" className="focus-ring mt-3 text-sm font-semibold text-[var(--color-maroon)]" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : null}

      {!loading && !error && !packs.length ? (
        <p className="mt-8 text-sm text-[var(--color-muted)]">No family packs are available right now. Check back soon.</p>
      ) : null}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => (
          <PackPreviewCard key={pack.slug} pack={pack} />
        ))}
      </div>
    </PageContainer>
  )
}
