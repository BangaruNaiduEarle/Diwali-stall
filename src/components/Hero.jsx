import { MapPin, Sparkles, Star } from 'lucide-react'
import {
  getBrandDisplayName,
  getLocationHeroLine,
  getStallDatesSummary,
  hasLocation,
  hasStallDates,
  hasWhatsApp,
} from '../data/siteConfig'
import { getWhatsAppEnquiryUrl } from '../utils/whatsapp'

export default function Hero() {
  const brandName = getBrandDisplayName()
  const whatsAppUrl = getWhatsAppEnquiryUrl()

  return (
    <section
      id="top"
      className="relative w-full overflow-hidden bg-diwali-navy text-diwali-cream"
      aria-labelledby="hero-heading"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-35"
        aria-hidden="true"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 70% 55% at 50% 0%, rgba(244, 185, 66, 0.2) 0%, transparent 60%)',
        }}
      />

      <Star
        className="pointer-events-none absolute left-[8%] top-[18%] h-4 w-4 text-diwali-gold/30 max-sm:hidden"
        aria-hidden="true"
      />
      <Sparkles
        className="pointer-events-none absolute right-[10%] top-[22%] h-5 w-5 text-diwali-gold/25"
        aria-hidden="true"
      />
      <Star
        className="pointer-events-none absolute bottom-[28%] right-[18%] h-3 w-3 text-diwali-gold/20 max-sm:hidden"
        aria-hidden="true"
      />

      <div className="container-page relative py-10 sm:py-14 md:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-diwali-gold sm:text-sm">
            Diwali 2026
          </p>

          <h1
            id="hero-heading"
            className="mt-3 text-[1.65rem] font-bold leading-tight tracking-tight sm:text-4xl md:text-[2.75rem]"
          >
            Celebrate Diwali with the crackers you love.
          </h1>

          <p className="mt-4 text-sm leading-relaxed text-diwali-cream/85 sm:text-base md:text-lg">
            Browse the catalogue, note what you need, and share your list on
            WhatsApp when you are ready. This site helps you plan—not place a
            confirmed order online.
          </p>

          {(brandName || hasLocation() || hasStallDates()) && (
            <ul className="mt-5 flex flex-col items-center gap-2 text-xs text-diwali-cream/75 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-5 sm:text-sm">
              <li className="inline-flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-diwali-gold" aria-hidden="true" />
                <span>{brandName}</span>
              </li>
              {hasLocation() && (
                <li className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-diwali-gold" aria-hidden="true" />
                  <span>{getLocationHeroLine()}</span>
                </li>
              )}
              {hasStallDates() && (
                <li>
                  <span className="rounded-full border border-diwali-gold/35 px-3 py-0.5 text-diwali-gold">
                    {getStallDatesSummary()}
                  </span>
                </li>
              )}
            </ul>
          )}

          <div className="mt-8 flex flex-col items-stretch gap-3 sm:mt-10 sm:flex-row sm:justify-center">
            <a
              href="#crackers"
              className="focus-ring inline-flex min-h-12 items-center justify-center rounded-xl bg-diwali-gold px-8 py-3 text-sm font-semibold uppercase tracking-wide text-diwali-navy transition-colors hover:bg-diwali-gold-dark sm:text-base"
            >
              Explore crackers
            </a>
            {hasWhatsApp() && whatsAppUrl ? (
              <a
                href={whatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex min-h-12 items-center justify-center rounded-xl border border-diwali-cream/25 bg-white/5 px-8 py-3 text-sm font-semibold uppercase tracking-wide text-diwali-cream transition-colors hover:bg-white/10 sm:text-base"
              >
                WhatsApp enquiry
              </a>
            ) : (
              <span
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-diwali-cream/15 px-6 py-3 text-xs text-diwali-cream/50 sm:text-sm"
                role="status"
              >
                WhatsApp — add number in siteConfig
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
