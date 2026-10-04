import { Link } from 'react-router-dom'
import { CalendarDays, Clock3, MessageCircle } from 'lucide-react'
import {
  getBrandDisplayName,
  getPhoneDisplayNumber,
  getWhatsAppDisplayNumber,
  hasPhone,
  hasStallDates,
  hasWhatsApp,
  siteConfig,
} from '../data/siteConfig'
import { getWhatsAppEnquiryUrl } from '../utils/whatsapp'

const ICON = { strokeWidth: 1.8 }

export default function Footer() {
  const year = new Date().getFullYear()
  const brandName = getBrandDisplayName()
  const whatsAppUrl = getWhatsAppEnquiryUrl()
  const waDisplay = getWhatsAppDisplayNumber()

  return (
    <footer className="mt-auto bg-[var(--color-maroon-deep)] text-[var(--color-ivory)]/80">
      <div className="container-page py-10 sm:py-12 md:py-14">
        <div className="max-w-md">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-white)]">
            {brandName}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ivory)]/65">Celebrate beautifully.</p>
        </div>

        <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:mt-10 lg:grid-cols-4 lg:gap-8">
          <div>
            <h2 className="editorial-label text-[var(--color-gold)]">Explore</h2>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li>
                <Link to="/crackers" className="focus-ring inline-flex min-h-11 items-center transition-ui hover:text-[var(--color-gold)] sm:min-h-0">
                  Crackers
                </Link>
              </li>
              <li>
                <Link to="/crackers" className="focus-ring inline-flex min-h-11 items-center transition-ui hover:text-[var(--color-gold)] sm:min-h-0">
                  Categories
                </Link>
              </li>
              <li>
                <Link to="/estimate" className="focus-ring inline-flex min-h-11 items-center transition-ui hover:text-[var(--color-gold)] sm:min-h-0">
                  My estimate
                </Link>
              </li>
              <li>
                <Link to="/faq" className="focus-ring inline-flex min-h-11 items-center transition-ui hover:text-[var(--color-gold)] sm:min-h-0">
                  FAQ
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="editorial-label text-[var(--color-gold)]">Visit</h2>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li>
                <Link to="/location" className="focus-ring inline-flex min-h-11 items-center transition-ui hover:text-[var(--color-gold)] sm:min-h-0">
                  Location
                </Link>
              </li>
              {hasStallDates() ? (
                <li className="flex min-h-11 items-center gap-2 text-[var(--color-ivory)]/65 sm:min-h-0">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--color-gold)]" {...ICON} aria-hidden="true" />
                  {siteConfig.stallDates.trim()}
                </li>
              ) : null}
              {siteConfig.stallTimings?.trim() ? (
                <li className="flex min-h-11 items-center gap-2 text-[var(--color-ivory)]/65 sm:min-h-0">
                  <Clock3 className="h-3.5 w-3.5 shrink-0 text-[var(--color-gold)]" {...ICON} aria-hidden="true" />
                  {siteConfig.stallTimings.trim()}
                </li>
              ) : null}
            </ul>
          </div>

          <div className="sm:col-span-2 lg:col-span-1">
            <h2 className="editorial-label text-[var(--color-gold)]">Connect</h2>
            <ul className="mt-3 space-y-2.5 text-sm">
              {hasWhatsApp() && whatsAppUrl ? (
                <li>
                  <a
                    href={whatsAppUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring inline-flex min-h-11 max-w-full flex-wrap items-center gap-2 break-all transition-ui hover:text-[var(--color-gold)] sm:min-h-0 sm:break-normal"
                  >
                    <MessageCircle className="h-4 w-4 shrink-0 text-[var(--color-red)]" {...ICON} aria-hidden="true" />
                    <span>WhatsApp · {waDisplay}</span>
                  </a>
                </li>
              ) : null}
              {hasPhone() ? (
                <li className="min-h-11 text-[var(--color-ivory)]/65 sm:min-h-0">
                  Phone · {getPhoneDisplayNumber()}
                </li>
              ) : null}
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-[var(--color-gold)]/30 pt-5 text-xs text-[var(--color-ivory)]/50 md:mt-12 md:pt-6">
          © {year} {brandName}
        </div>
      </div>
    </footer>
  )
}
