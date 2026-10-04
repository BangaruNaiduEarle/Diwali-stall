import { Clock, ExternalLink, MapPin } from 'lucide-react'
import {
  hasLocation,
  hasStallDates,
  siteConfig,
} from '../data/siteConfig'
import SectionHeading from './SectionHeading'

export default function StallLocation() {
  const location = siteConfig.location?.trim()
  const dates = siteConfig.stallDates?.trim()
  const timings = siteConfig.stallTimings?.trim()
  const mapsUrl = siteConfig.googleMapsUrl?.trim()

  return (
    <section
      id="location"
      className="scroll-mt-28 py-10 sm:py-14"
      aria-labelledby="location-heading"
    >
      <div className="container-page">
        <SectionHeading
          id="location-heading"
          eyebrow="Visit us"
          title="Stall location & pickup"
          description="Collect your order at the stall. Details below come from your site configuration."
        />

        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,18rem)] lg:items-start">
          <dl className="space-y-5 rounded-2xl border border-diwali-border bg-white p-6 shadow-sm sm:p-8">
            <div>
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-diwali-muted">
                <MapPin className="h-4 w-4 text-diwali-gold" aria-hidden="true" />
                Location
              </dt>
              <dd className="mt-2 text-base font-medium text-diwali-navy">
                {hasLocation() ? (
                  location
                ) : (
                  <span className="font-normal text-diwali-muted">
                    Add location in siteConfig
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-diwali-muted">
                <Clock className="h-4 w-4 text-diwali-gold" aria-hidden="true" />
                Stall dates
              </dt>
              <dd className="mt-2 text-base text-diwali-navy">
                {hasStallDates() ? (
                  dates
                ) : (
                  <span className="text-diwali-muted">
                    Add stallDates in siteConfig
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-diwali-muted">
                Opening hours
              </dt>
              <dd className="mt-2 text-base text-diwali-navy">
                {timings ? (
                  timings
                ) : (
                  <span className="text-diwali-muted">
                    Add stallTimings in siteConfig
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-3">
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-diwali-navy px-5 py-3 text-sm font-semibold text-diwali-cream hover:bg-diwali-navy-muted"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Get directions
              </a>
            ) : (
              <p className="rounded-xl border border-dashed border-diwali-border bg-white px-4 py-3 text-sm text-diwali-muted">
                Maps link will appear when googleMapsUrl is set in siteConfig.
              </p>
            )}
            <a
              href="#crackers"
              className="focus-ring inline-flex min-h-12 items-center justify-center rounded-xl border border-diwali-navy/15 bg-white px-5 py-3 text-sm font-semibold text-diwali-navy hover:border-diwali-gold/50"
            >
              Browse crackers
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
