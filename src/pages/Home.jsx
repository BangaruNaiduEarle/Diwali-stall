import { Link } from 'react-router-dom'
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock3,
  Grid3x3,
  HelpCircle,
  MapPin,
  MessageCircle,
  Navigation,
  ReceiptText,
  Search,
  Send,
  Sparkles,
  Store,
  Tag,
} from 'lucide-react'
import { CATALOG_CATEGORIES } from '../data/categories'
import { BUDGET_RANGES } from '../data/budgetRanges'
import FestiveHero from '../components/hero/FestiveHero'
import Button from '../components/ui/Button'
import { usePageTitle } from '../hooks/usePageTitle'
import { getCategoryProductCounts } from '../utils/categoryCounts'
import { getCategoryIcon } from '../utils/categoryIcons'
import { cataloguePath } from '../utils/catalogueRoutes'
import { countActiveProducts } from '../utils/filterProducts'
import { products } from '../data/products'
import { hasLocation, hasStallDates, siteConfig } from '../data/siteConfig'
import { getWhatsAppEnquiryUrl } from '../utils/whatsapp'

const ICON = { strokeWidth: 1.8 }

const WHY_SHOP = [
  {
    icon: Tag,
    title: 'Festive pricing',
    text: 'Clear selling prices and reference rates so you can plan before you visit.',
  },
  {
    icon: ReceiptText,
    title: 'Easy estimate',
    text: 'Build a list on your phone, review totals, then send a WhatsApp request.',
  },
  {
    icon: Grid3x3,
    title: 'Wide selection',
    text: `${countActiveProducts(products)} crackers across gift boxes, sparklers, shots, and more.`,
  },
  {
    icon: CalendarDays,
    title: '3-day stall',
    text: 'A focused Diwali pop-up — browse online, collect at the stall.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp assistance',
    text: 'Questions about products, availability, or directions? Message us anytime.',
  },
]

const HOW_IT_WORKS = [
  { step: '1', title: 'Browse', text: 'Search or filter the catalogue by category and budget.', icon: Search },
  { step: '2', title: 'Add to estimate', text: 'Tap Add to estimate and adjust quantities.', icon: ClipboardList },
  { step: '3', title: 'Review', text: 'Check your list and estimated total on My Estimate.', icon: ReceiptText },
  { step: '4', title: 'Send on WhatsApp', text: 'Share your request — the stall confirms on WhatsApp.', icon: Send },
]

function stallLine(value, fallback) {
  const text = value?.trim()
  return text || fallback
}

export default function Home() {
  usePageTitle('Diwali Crackers')
  const whatsAppUrl = getWhatsAppEnquiryUrl()
  const counts = getCategoryProductCounts()
  const categories = CATALOG_CATEGORIES.filter((c) => c.slug !== 'all')
  const mapsUrl = siteConfig.googleMapsUrl?.trim()

  return (
    <>
      <FestiveHero whatsAppUrl={whatsAppUrl} />

      <section className="section-y-compact border-b border-[var(--color-border)] bg-[var(--color-white)]">
        <div className="container-page">
          <p className="editorial-label">Why shop here</p>
          <h2 className="editorial-title mt-2 max-w-xl">Plan your Diwali crackers with confidence</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_SHOP.map(({ icon: ItemIcon, title, text }) => (
              <li key={title} className="surface-card p-4">
                <ItemIcon className="h-5 w-5 text-[var(--color-red)]" {...ICON} aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold text-[var(--color-charcoal)]">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section-y-compact hairline-b">
        <div className="container-page">
          <p className="editorial-label">How it works</p>
          <h2 className="editorial-title mt-2">From browsing to WhatsApp in four steps</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map(({ step, title, text, icon: StepIcon }) => (
              <li key={step} className="relative surface-card p-4">
                <span className="text-xs font-bold tabular-nums text-[var(--color-gold)]">Step {step}</span>
                <StepIcon className="mt-2 h-5 w-5 text-[var(--color-red)]" {...ICON} aria-hidden="true" />
                <h3 className="mt-2 text-sm font-semibold text-[var(--color-charcoal)]">{title}</h3>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{text}</p>
              </li>
            ))}
          </ol>
          <Button to="/crackers" variant="primary" size="md" icon={Sparkles} className="mt-8 w-full max-w-[360px]">
            Start browsing crackers
          </Button>
        </div>
      </section>

      <section className="section-y">
        <div className="container-page">
          <p className="editorial-label">Explore the collection</p>
          <h2 className="editorial-title mt-2 max-w-lg">Shop by category</h2>
          <ul className="mt-6 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] md:mt-8">
            {categories.map(({ slug, label }) => {
              const count = counts[slug] ?? 0
              const productLabel = count === 1 ? 'product' : 'products'
              const CatIcon = getCategoryIcon(slug)
              return (
                <li key={slug}>
                  <Link
                    to={`/crackers/${slug}`}
                    className="focus-ring group flex min-h-16 items-center justify-between gap-3 py-3 transition-ui hover:bg-[var(--color-white)] md:gap-4 md:px-2 md:py-4"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-ivory)] text-[var(--color-red)]">
                        <CatIcon className="h-5 w-5" {...ICON} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <span className="block text-base font-semibold tracking-tight text-[var(--color-charcoal)] transition-ui group-hover:text-[var(--color-maroon)]">
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
          <Button to="/crackers" variant="ghost" size="sm" iconRight={ChevronRight} className="mt-6">
            View full catalogue
          </Button>
        </div>
      </section>

      <section className="section-y bg-[var(--color-white)]">
        <div className="container-page">
          <p className="editorial-label">Shop by budget</p>
          <h2 className="editorial-title mt-2">Find your range</h2>
          <nav className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Budget ranges">
            {BUDGET_RANGES.map(({ id, label }) => (
              <Link
                key={id}
                to={cataloguePath('all', id)}
                className="focus-ring surface-card flex min-h-14 items-center px-4 text-sm font-medium text-[var(--color-charcoal)] transition-ui hover:border-[var(--color-gold)]"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <section className="section-maroon">
        <div className="container-page section-y-compact">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-16">
            <div>
              <p className="editorial-label text-[var(--color-gold)]">Visit us</p>
              <h2 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-tight text-[var(--color-white)] sm:text-3xl">
                Your Diwali celebration
                <span className="mt-1 block text-[var(--color-ivory)]">starts at our stall.</span>
              </h2>
              <dl className="mt-8 grid gap-5 sm:grid-cols-3 sm:gap-6">
                <div>
                  <dt className="editorial-label flex items-center gap-2 text-[var(--color-gold)]">
                    <MapPin className="h-3.5 w-3.5" {...ICON} aria-hidden="true" />
                    Location
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-[var(--color-ivory)]/90">
                    {stallLine(siteConfig.location, 'Address will be shared on the Location page and WhatsApp.')}
                  </dd>
                </div>
                <div>
                  <dt className="editorial-label flex items-center gap-2 text-[var(--color-gold)]">
                    <CalendarDays className="h-3.5 w-3.5" {...ICON} aria-hidden="true" />
                    Dates
                  </dt>
                  <dd className="mt-2 text-sm text-[var(--color-ivory)]/90">
                    {hasStallDates()
                      ? siteConfig.stallDates.trim()
                      : 'Dates will be posted on the Location page when confirmed.'}
                  </dd>
                </div>
                <div>
                  <dt className="editorial-label flex items-center gap-2 text-[var(--color-gold)]">
                    <Clock3 className="h-3.5 w-3.5" {...ICON} aria-hidden="true" />
                    Timings
                  </dt>
                  <dd className="mt-2 text-sm text-[var(--color-ivory)]/90">
                    {stallLine(siteConfig.stallTimings, 'Timings will be posted when the stall schedule is final.')}
                  </dd>
                </div>
              </dl>
              {hasLocation() ? (
                <p className="mt-4 flex items-start gap-2 text-sm text-[var(--color-ivory)]/80">
                  <Store className="mt-0.5 h-4 w-4 shrink-0" {...ICON} aria-hidden="true" />
                  Pickup at the stall — no delivery through this website.
                </p>
              ) : null}
            </div>
            <div className="flex max-w-[360px] flex-col gap-3 sm:max-w-none md:flex-row lg:max-w-[280px] lg:flex-col">
              <Button to="/location" variant="secondary" surface="dark" size="md" icon={MapPin} fullWidth className="md:!w-auto lg:!w-full">
                View location
              </Button>
              {mapsUrl ? (
                <Button
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="primary"
                  surface="dark"
                  size="md"
                  icon={Navigation}
                  fullWidth
                  className="md:!w-auto lg:!w-full"
                >
                  Get directions
                </Button>
              ) : null}
              {whatsAppUrl ? (
                <Button
                  href={whatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="secondary"
                  surface="dark"
                  size="md"
                  icon={MessageCircle}
                  fullWidth
                  className="md:!w-auto lg:!w-full"
                >
                  Message us on WhatsApp
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="section-y-compact hairline-t">
        <div className="container-page text-center md:text-left">
          <p className="editorial-label">Help</p>
          <h2 className="editorial-title mt-2">Questions before you visit?</h2>
          <p className="mt-2 max-w-xl text-sm text-[var(--color-muted)]">
            Learn how estimates, WhatsApp confirmation, and stall pickup work.
          </p>
          <Button to="/faq" variant="secondary" size="md" icon={HelpCircle} className="mt-6 w-full max-w-[360px] md:w-auto">
            Read frequently asked questions
          </Button>
        </div>
      </section>
    </>
  )
}
