import { CalendarDays, MapPin, MessageCircle, Navigation } from 'lucide-react'
import Button from '../ui/Button'
import {
  getLocationHeroLine,
  getLocationMapUrl,
  getStallDatesSummary,
  hasStallDates,
} from '../../data/siteConfig'

const ICON = { strokeWidth: 1.8 }

function stallLine(value, fallback) {
  const text = value?.trim()
  return text || fallback
}

export default function HomeStallSection({ whatsAppUrl }) {
  const mapsUrl = getLocationMapUrl()

  return (
    <section className="section-maroon">
      <div className="container-page py-8 sm:py-10 md:py-12">
        <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-10">
          <div>
            <p className="editorial-label text-[var(--color-gold)]">Visit us</p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-[var(--color-white)] sm:text-[1.75rem]">
              Your Diwali celebration
              <span className="mt-0.5 block text-[var(--color-ivory)]">starts at our stall.</span>
            </h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2 sm:gap-5">
              <div>
                <dt className="editorial-label flex items-center gap-2 text-[var(--color-gold)]">
                  <MapPin className="h-3.5 w-3.5" {...ICON} aria-hidden="true" />
                  Location
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-[var(--color-ivory)]/90">
                  {stallLine(getLocationHeroLine(), 'Address will be shared on the Location page and WhatsApp.')}
                </dd>
              </div>
              <div>
                <dt className="editorial-label flex items-center gap-2 text-[var(--color-gold)]">
                  <CalendarDays className="h-3.5 w-3.5" {...ICON} aria-hidden="true" />
                  Dates
                </dt>
                <dd className="mt-1.5 text-sm text-[var(--color-ivory)]/90">
                  {hasStallDates()
                    ? getStallDatesSummary()
                    : 'Dates will be posted on the Location page when confirmed.'}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-ivory)]/75">
              We&apos;ll update the stall number soon!
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-ivory)]/80">
              Free door delivery is available on qualifying website orders of ₹1,000 or more, subject to delivery
              coverage in your area.
            </p>
          </div>
          <div className="flex max-w-[360px] flex-col gap-2.5 sm:max-w-none md:flex-row lg:max-w-[280px] lg:flex-col">
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
  )
}
