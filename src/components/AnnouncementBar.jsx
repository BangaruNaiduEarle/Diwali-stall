import { CalendarDays } from 'lucide-react'
import { getStallDatesSummary, hasStallDates } from '../data/siteConfig'

export default function AnnouncementBar() {
  const dates = getStallDatesSummary()

  return (
    <div
      className="border-b border-diwali-gold/30 bg-diwali-navy text-center text-sm text-diwali-cream"
      role="region"
      aria-label="Stall announcement"
    >
      <div className="container-page flex min-h-10 items-center justify-center gap-2 py-2">
        <CalendarDays
          className="hidden h-4 w-4 shrink-0 text-diwali-gold sm:block"
          aria-hidden="true"
        />
        <p className="leading-snug">
          <span className="font-semibold text-diwali-gold">Diwali sale</span>
          <span className="text-diwali-cream/90" aria-hidden="true">
            {' '}
            •{' '}
          </span>
          {hasStallDates() ? (
            <span>{dates}</span>
          ) : (
            <span className="text-diwali-cream/80">
              Stall dates — configure in site settings
            </span>
          )}
          <span className="hidden sm:inline text-diwali-cream/70">
            {' '}
            • Limited stock • Visit our stall
          </span>
        </p>
      </div>
    </div>
  )
}
