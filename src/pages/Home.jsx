import { Link } from 'react-router-dom'
import { ChevronRight, HelpCircle } from 'lucide-react'
import { CATALOG_CATEGORIES } from '../data/categories'
import FestiveHero from '../components/hero/FestiveHero'
import ComplimentaryGiftPromo from '../components/promo/ComplimentaryGiftPromo'
import HomeStallSection from '../components/home/HomeStallSection'
import CrackerPacksSection from '../components/packs/CrackerPacksSection'
import Button from '../components/ui/Button'
import { usePageTitle } from '../hooks/usePageTitle'
import { getCategoryProductCounts } from '../utils/categoryCounts'
import { getCategoryIcon } from '../utils/categoryIcons'
import { getWhatsAppEnquiryUrl } from '../utils/whatsapp'

const ICON = { strokeWidth: 1.8 }
const HOME_CATEGORY_SLUGS = [
  'gift-boxes',
  'sparklers',
  'flower-pots-fountains',
  'chakkars-wheels',
  'bombs',
  'bijili',
]

function Home() {
  usePageTitle('Diwali Crackers')
  const whatsAppUrl = getWhatsAppEnquiryUrl()
  const counts = getCategoryProductCounts()
  const categories = CATALOG_CATEGORIES.filter(
    (c) => c.slug !== 'all' && HOME_CATEGORY_SLUGS.includes(c.slug),
  )

  return (
    <>
      <FestiveHero />

      <ComplimentaryGiftPromo variant="marquee" />

      <CrackerPacksSection />

      <section className="section-y-compact hairline-t">
        <div className="container-page">
          <p className="editorial-label">Explore the collection</p>
          <h2 className="editorial-title mt-2 max-w-lg">Shop by category</h2>
          <ul className="mt-4 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] md:mt-6">
            {categories.map(({ slug, label }) => {
              const count = counts[slug] ?? 0
              const productLabel = count === 1 ? 'product' : 'products'
              const CatIcon = getCategoryIcon(slug)
              return (
                <li key={slug}>
                  <Link
                    to={`/crackers/${slug}`}
                    className="focus-ring group flex min-h-[3.75rem] items-center justify-between gap-3 py-2.5 transition-ui hover:bg-[var(--color-white)] md:min-h-16 md:gap-4 md:px-2 md:py-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-ivory)] text-[var(--color-red)] md:h-10 md:w-10">
                        <CatIcon className="h-5 w-5" {...ICON} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <span className="block text-sm font-semibold tracking-tight text-[var(--color-charcoal)] transition-ui group-hover:text-[var(--color-maroon)] md:text-base">
                          {label}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                          {count} {productLabel}
                        </span>
                      </div>
                    </div>
                    <ChevronRight
                      className="h-5 w-5 shrink-0 text-[var(--color-red)] transition-ui group-hover:translate-x-0.5"
                      {...ICON}
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
          <Button to="/crackers" variant="ghost" size="sm" iconRight={ChevronRight} className="mt-4 md:mt-6">
            View All Categories
          </Button>
        </div>
      </section>

      <HomeStallSection whatsAppUrl={whatsAppUrl} />

      <section className="hairline-t py-6 md:py-8">
        <div className="container-page flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-muted)]">Questions about estimates, WhatsApp confirmation, or pickup?</p>
          <Link
            to="/faq"
            className="focus-ring inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-maroon)]"
          >
            <HelpCircle className="h-4 w-4 shrink-0" {...ICON} aria-hidden="true" />
            Read FAQ
          </Link>
        </div>
      </section>
    </>
  )
}

export default Home
