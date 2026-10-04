import { CalendarDays, Clock3, ExternalLink, MapPin } from 'lucide-react'
import PageContainer from '../components/PageContainer'
import Button from '../components/ui/Button'
import WhatsAppButton from '../components/WhatsAppButton'
import { usePageTitle } from '../hooks/usePageTitle'
import { hasLocation, hasStallDates, siteConfig } from '../data/siteConfig'

const ICON = { strokeWidth: 1.8 }

export default function Location() {
  usePageTitle('Diwali stall location')
  const mapsUrl = siteConfig.googleMapsUrl?.trim()

  return (
    <PageContainer>
      <header className="mb-8 max-w-xl md:mb-10">
        <p className="editorial-label">Visit us</p>
        <h1 className="editorial-title mt-2">Visit our stall</h1>
      </header>

      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-2 lg:gap-14">
        <div className="order-2 lg:order-1">
          <dl className="space-y-6">
            <div className="surface-card p-4 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
              <dt className="editorial-label mb-2 flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-[var(--color-red)]" {...ICON} aria-hidden="true" />
                Location
              </dt>
              <dd className="text-base leading-relaxed text-[var(--color-charcoal)]">
                {hasLocation() ? (
                  siteConfig.location.trim()
                ) : (
                  <span className="text-[var(--color-muted)]">Coming soon</span>
                )}
              </dd>
            </div>
            <div className="surface-card p-4 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
              <dt className="editorial-label mb-2 flex items-center gap-2">
                <CalendarDays className="h-3.5 w-3.5 text-[var(--color-red)]" {...ICON} aria-hidden="true" />
                Dates
              </dt>
              <dd className="text-base text-[var(--color-charcoal)]">
                {hasStallDates() ? (
                  siteConfig.stallDates.trim()
                ) : (
                  <span className="text-[var(--color-muted)]">Coming soon</span>
                )}
              </dd>
            </div>
            <div className="surface-card p-4 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
              <dt className="editorial-label mb-2 flex items-center gap-2">
                <Clock3 className="h-3.5 w-3.5 text-[var(--color-red)]" {...ICON} aria-hidden="true" />
                Timings
              </dt>
              <dd className="text-base text-[var(--color-charcoal)]">
                {siteConfig.stallTimings?.trim() ? (
                  siteConfig.stallTimings.trim()
                ) : (
                  <span className="text-[var(--color-muted)]">Coming soon</span>
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-8 flex max-w-[360px] flex-col gap-3 sm:max-w-none md:flex-row lg:flex-col">
            {mapsUrl ? (
              <Button
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                icon={MapPin}
                iconRight={ExternalLink}
                fullWidth
                className="md:!w-auto lg:!w-full"
              >
                View on Google Maps
              </Button>
            ) : null}
            <WhatsAppButton variant="secondary" label="Message us on WhatsApp" fullWidth className="md:!w-auto lg:!w-full" />
          </div>
        </div>

        <div
          className="order-1 flex aspect-[4/3] items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-white)] lg:order-2 lg:aspect-[16/10]"
          aria-hidden="true"
        >
          <MapPin className="h-12 w-12 text-[var(--color-gold)] md:h-14 md:w-14" {...ICON} />
        </div>
      </div>
    </PageContainer>
  )
}
