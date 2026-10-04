import { CalendarClock, MapPin, Sparkles } from 'lucide-react'
import {
  hasLocation,
  hasStallDates,
  siteConfig,
} from '../data/siteConfig'

function ConfigPlaceholder({ children }) {
  return (
    <span className="text-diwali-muted italic">{children}</span>
  )
}

export default function SaleAnnouncement() {
  const dates = siteConfig.stallDates?.trim()
  const timings = siteConfig.stallTimings?.trim()
  const location = siteConfig.location?.trim()

  return (
    <section
      className="bg-diwali-cream"
      aria-labelledby="sale-announcement-heading"
    >
      <div className="container-page py-8 sm:py-10">
        <div className="overflow-hidden rounded-2xl border border-diwali-border bg-diwali-cream shadow-sm">
          <div className="grid gap-0 md:grid-cols-[1fr_auto]">
            <div className="border-b border-diwali-border p-6 sm:p-8 md:border-b-0 md:border-r">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-diwali-navy text-diwali-gold">
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-diwali-gold">
                    Diwali special
                  </p>
                  <h2
                    id="sale-announcement-heading"
                    className="mt-1 text-xl font-semibold text-diwali-navy sm:text-2xl"
                  >
                    Temporary stall — plan your list early
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-diwali-muted sm:text-base">
                    Browse crackers, build your estimate, and share it on
                    WhatsApp. Pickup details below when configured.
                  </p>
                </div>
              </div>
            </div>

            <ul className="grid gap-px bg-diwali-border sm:grid-cols-3 md:w-[min(100%,28rem)] md:grid-cols-1">
              <li className="bg-diwali-cream p-5 sm:p-6">
                <div className="flex gap-3">
                  <CalendarClock
                    className="mt-0.5 h-5 w-5 shrink-0 text-diwali-gold"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-diwali-navy/70">
                      Dates
                    </p>
                    <p className="mt-1 text-sm font-medium text-diwali-navy">
                      {hasStallDates() ? (
                        dates
                      ) : (
                        <ConfigPlaceholder>Add stall dates in siteConfig</ConfigPlaceholder>
                      )}
                    </p>
                  </div>
                </div>
              </li>
              <li className="bg-diwali-cream p-5 sm:p-6">
                <div className="flex gap-3">
                  <CalendarClock
                    className="mt-0.5 h-5 w-5 shrink-0 text-diwali-gold"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-diwali-navy/70">
                      Timings
                    </p>
                    <p className="mt-1 text-sm font-medium text-diwali-navy">
                      {timings ? (
                        timings
                      ) : (
                        <ConfigPlaceholder>Add stall timings in siteConfig</ConfigPlaceholder>
                      )}
                    </p>
                  </div>
                </div>
              </li>
              <li className="bg-diwali-cream p-5 sm:p-6">
                <div className="flex gap-3">
                  <MapPin
                    className="mt-0.5 h-5 w-5 shrink-0 text-diwali-gold"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-diwali-navy/70">
                      Pickup / location
                    </p>
                    <p className="mt-1 text-sm font-medium text-diwali-navy">
                      {hasLocation() ? (
                        location
                      ) : (
                        <ConfigPlaceholder>Add location in siteConfig</ConfigPlaceholder>
                      )}
                    </p>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
