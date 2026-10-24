import {
  ArrowRight,
  CalendarDays,
  Map,
  MapPin,
  Navigation,
  Sparkles,
} from 'lucide-react'
import PageContainer from '../components/PageContainer'
import ComplimentaryGiftPromo from '../components/promo/ComplimentaryGiftPromo'
import Button from '../components/ui/Button'
import WhatsAppButton from '../components/WhatsAppButton'
import {
  getLocationHeroLine,
  getLocationMapUrl,
  getStallDatesList,
  getStallDatesSummary,
  hasGoogleMapsUrl,
  hasStallDates,
} from '../data/siteConfig'
import { usePageTitle } from '../hooks/usePageTitle'

const ICON = { strokeWidth: 1.8 }

const HOME_STALL_LOCATION_FALLBACK =
  'Address will be shared on the Location page and WhatsApp.'
const HOME_STALL_DATES_FALLBACK = 'Dates will be posted on the Location page when confirmed.'
const HOME_STALL_NUMBER_NOTE = "We'll update the stall number soon!"
const HOME_FREE_DOOR_DELIVERY_NOTE =
  'Free door delivery is available on qualifying website orders of ₹1,000 or more, subject to delivery coverage in your area.'

function stallLine(value, fallback) {
  const text = value?.trim()
  return text || fallback
}

function formatDateCardHeading(dateLabel) {
  const match = dateLabel.match(/^(\w+)\s+(\d{1,2})/)
  if (match) return `${match[1]} ${match[2]}`
  return dateLabel
}

export default function Location() {
  usePageTitle('Diwali stall location')
  const mapsUrl = getLocationMapUrl()
  const stallDates = getStallDatesList()
  const locationLine = stallLine(getLocationHeroLine(), HOME_STALL_LOCATION_FALLBACK)
  const datesLine = hasStallDates() ? getStallDatesSummary() : HOME_STALL_DATES_FALLBACK

  return (
    <PageContainer className="pb-12 md:pb-16">
      {/* Hero */}
      <header className="relative mb-8 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] px-5 py-8 sm:px-8 sm:py-10 md:mb-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          aria-hidden="true"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(201, 164, 92, 0.18) 0%, transparent 55%)',
          }}
        />
        <Sparkles
          className="pointer-events-none absolute right-6 top-6 h-5 w-5 text-[var(--color-gold)]/50 max-sm:hidden"
          {...ICON}
          aria-hidden="true"
        />
        <p className="editorial-label-festive relative text-[var(--color-maroon)]">Visit us</p>
        <h1 className="editorial-title relative mt-3 max-w-2xl">
          Your Diwali celebration
          <span className="mt-1 block">starts at our stall.</span>
        </h1>
        <p className="relative mt-4 max-w-xl text-sm leading-relaxed text-[var(--color-muted)] sm:text-base">
          {locationLine}
        </p>
        <p className="relative mt-3 max-w-xl text-sm leading-relaxed text-[var(--color-muted)]">{HOME_STALL_NUMBER_NOTE}</p>
        <p className="relative mt-2 max-w-xl text-sm leading-relaxed text-[var(--color-muted)]">
          {HOME_FREE_DOOR_DELIVERY_NOTE}
        </p>
      </header>

      <ComplimentaryGiftPromo variant="strip" className="mb-6" />

      {/* Location + map panel */}
      <section className="grid gap-6 lg:grid-cols-2 lg:gap-8" aria-labelledby="location-main-heading">
        <h2 id="location-main-heading" className="sr-only">
          Stall location and directions
        </h2>

        <article className="surface-card flex flex-col p-5 sm:p-6 md:p-7">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-ivory)] text-[var(--color-red)]">
              <MapPin className="h-5 w-5" {...ICON} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="editorial-label text-[var(--color-red)]">Location</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-charcoal)] sm:text-base">{locationLine}</p>
            </div>
          </div>

          <dl className="mt-6 space-y-4 border-t border-[var(--color-border)] pt-6">
            <div className="flex gap-3">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-gold)]" {...ICON} aria-hidden="true" />
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Dates</dt>
                <dd className="mt-1 text-base font-semibold text-[var(--color-maroon)]">{datesLine}</dd>
              </div>
            </div>
          </dl>

          {hasGoogleMapsUrl() ? (
            <Button
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="primary"
              icon={Navigation}
              className="mt-8 w-full sm:w-auto"
            >
              Get Directions
            </Button>
          ) : null}
        </article>

        <aside
          className="relative flex min-h-[240px] flex-col items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] p-6 text-center sm:min-h-[280px] sm:p-8"
          aria-label="Map preview"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            aria-hidden="true"
            style={{
              backgroundImage: `
                linear-gradient(to right, var(--color-border-faint) 1px, transparent 1px),
                linear-gradient(to bottom, var(--color-border-faint) 1px, transparent 1px)
              `,
              backgroundSize: '24px 24px',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--color-ivory)]/80 via-transparent to-[var(--color-ivory)]/60"
            aria-hidden="true"
          />
          <div className="relative z-[1] flex flex-col items-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-ivory)] text-[var(--color-red)] shadow-sm">
              <MapPin className="h-7 w-7" {...ICON} aria-hidden="true" />
            </span>
            <p className="mt-4 text-lg font-semibold text-[var(--color-charcoal)]">{locationLine}</p>
            {hasGoogleMapsUrl() ? (
              <Button
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                size="sm"
                icon={Map}
                className="mt-6"
              >
                Get Directions
              </Button>
            ) : null}
          </div>
        </aside>
      </section>

      {/* Calendar */}
      <section className="mt-10 md:mt-12" aria-labelledby="calendar-heading">
        <p className="editorial-label">Dates</p>
        <h2 id="calendar-heading" className="editorial-title mt-2">
          Mark Your Calendar
        </h2>
        <p className="mt-2 max-w-lg text-sm text-[var(--color-muted)] sm:text-base">{datesLine}</p>

        <ul className="mt-6 grid gap-3 sm:grid-cols-3 sm:gap-4">
          {stallDates.map((dateLabel) => (
            <li
              key={dateLabel}
              className="surface-card relative overflow-hidden p-4 sm:p-5"
            >
              <div
                className="pointer-events-none absolute right-0 top-0 h-12 w-12 opacity-30"
                aria-hidden="true"
                style={{
                  background: 'radial-gradient(circle at 100% 0%, var(--color-gold) 0%, transparent 70%)',
                }}
              />
              <CalendarDays className="h-4 w-4 text-[var(--color-red)]" {...ICON} aria-hidden="true" />
              <h3 className="mt-3 text-base font-semibold text-[var(--color-charcoal)]">
                {formatDateCardHeading(dateLabel)}
              </h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">{dateLabel}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Planning visit */}
      <section
        className="surface-card mt-8 p-5 sm:mt-10 sm:p-6 md:p-7"
        aria-labelledby="plan-visit-heading"
      >
        <h2 id="plan-visit-heading" className="text-lg font-semibold text-[var(--color-charcoal)] sm:text-xl">
          Planning a visit?
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-muted)] sm:text-base">
          Visit during our stall dates ({datesLine}). {HOME_FREE_DOOR_DELIVERY_NOTE} Browse the catalogue before visiting and build your{' '}
          <span className="font-medium text-[var(--color-maroon)]">My Estimate</span> so you know what you&apos;d like
          to purchase, or collect at the stall.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button to="/crackers" variant="primary" iconRight={ArrowRight} className="w-full sm:w-auto">
            View Crackers
          </Button>
          <Button to="/estimate" variant="secondary" className="w-full sm:w-auto">
            My Estimate
          </Button>
        </div>
      </section>

      {/* WhatsApp */}
      <section
        className="mt-8 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] p-5 sm:mt-10 sm:p-6 md:p-7"
        aria-labelledby="whatsapp-visit-heading"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 id="whatsapp-visit-heading" className="text-lg font-semibold text-[var(--color-charcoal)]">
              Have a question before visiting?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)] sm:text-base">
              Contact us on WhatsApp for product availability or stall-related queries.
            </p>
          </div>
          <WhatsAppButton variant="primary" label="Chat on WhatsApp" fullWidth className="md:max-w-xs md:shrink-0" />
        </div>
      </section>
    </PageContainer>
  )
}
