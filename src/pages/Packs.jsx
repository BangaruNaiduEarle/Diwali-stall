import { Link } from 'react-router-dom'
import Breadcrumbs from '../components/Breadcrumbs'
import PackPreviewCard from '../components/packs/PackPreviewCard'
import PageContainer from '../components/PageContainer'
import ComplimentaryGiftPromo from '../components/promo/ComplimentaryGiftPromo'
import { usePageTitle } from '../hooks/usePageTitle'
import { getResolvedCrackerPacks } from '../utils/crackerPacks'

export default function Packs() {
  usePageTitle('Family Packs')
  const packs = getResolvedCrackerPacks()

  return (
    <PageContainer className="py-5 sm:py-10 md:py-12 lg:py-14">
      <Breadcrumbs editorial items={[{ label: 'Home', to: '/' }, { label: 'Family Packs' }]} />
      <p className="editorial-label mt-4">Ready-made value</p>
      <h1 className="editorial-title mt-2 max-w-xl">Family Packs</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-muted)]">
        Fixed bundle prices with item lists taken from our Excel pack sheets. Your estimate uses catalogue prices for each
        included product.
      </p>

      <ComplimentaryGiftPromo variant="strip" className="mt-5" />

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        {packs.map((pack) => (
          <li key={pack.slug}>
            <PackPreviewCard pack={pack} />
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm text-[var(--color-muted)]">
        Prefer item-by-item shopping?{' '}
        <Link to="/crackers" className="focus-ring font-semibold text-[var(--color-maroon)] underline-offset-2 hover:underline">
          Open the full catalogue
        </Link>
        .
      </p>
    </PageContainer>
  )
}
