import { Link, NavLink, useLocation } from 'react-router-dom'
import { MapPin, MessageCircle, Phone } from 'lucide-react'
import {
  getBrandDisplayName,
  getPhoneDisplayNumber,
  getWhatsAppDisplayNumber,
  hasPhone,
  hasWhatsApp,
  siteConfig,
} from '../data/siteConfig'
import { getWhatsAppEnquiryUrl } from '../utils/whatsapp'

const ICON = { strokeWidth: 1.8 }
const ICON_CLASS = 'h-4 w-4 shrink-0'

function footerLinkClass({ isActive }) {
  return ['footer-link focus-ring', isActive ? 'footer-link--active' : ''].filter(Boolean).join(' ')
}

function phoneTelHref() {
  const digits = siteConfig.phone?.replace(/\D/g, '') ?? ''
  if (!digits) return ''
  if (digits.length === 10) return `tel:+91${digits}`
  if (digits.startsWith('91')) return `tel:+${digits}`
  return `tel:${digits}`
}

export default function Footer() {
  const { pathname } = useLocation()
  const year = new Date().getFullYear()
  const brandName = getBrandDisplayName()
  const whatsAppUrl = getWhatsAppEnquiryUrl()
  const waDisplay = getWhatsAppDisplayNumber()
  const phoneDisplay = getPhoneDisplayNumber()
  const phoneHref = phoneTelHref()

  return (
    <footer className="site-footer mt-auto border-t border-[var(--color-gold)]/25 bg-[var(--color-maroon-deep)] text-[var(--color-ivory)]">
      <div className="container-page py-10 md:py-12">
        <div className="grid gap-8 md:grid-cols-2 md:gap-10 lg:grid-cols-[1.35fr_1fr_1fr] lg:gap-12">
          <div className="max-w-md">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-white)]">{brandName}</p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-ivory)]/75">
              Celebrate safely. Choose your favourites, build your estimate, and reach us on WhatsApp when you are ready.
            </p>
          </div>

          <div>
            <h2 className="footer-heading">Quick links</h2>
            <ul className="flex flex-col">
              <li>
                <NavLink to="/" end className={footerLinkClass}>
                  Home
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/crackers"
                  end
                  className={() => footerLinkClass({ isActive: pathname === '/crackers' })}
                >
                  Crackers
                </NavLink>
              </li>
              <li>
                <Link
                  to="/crackers"
                  className={[
                    'footer-link focus-ring',
                    /^\/crackers\/.+/.test(pathname) ? 'footer-link--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={/^\/crackers\/.+/.test(pathname) ? 'page' : undefined}
                >
                  By category
                </Link>
              </li>
              <li>
                <NavLink to="/location" className={footerLinkClass}>
                  Location
                </NavLink>
              </li>
              <li>
                <NavLink to="/faq" className={footerLinkClass}>
                  FAQ
                </NavLink>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="footer-heading">Contact</h2>
            <ul className="flex flex-col">
              {hasWhatsApp() && whatsAppUrl ? (
                <li>
                  <a
                    href={whatsAppUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="footer-link focus-ring max-w-full flex-wrap items-center gap-2 break-all sm:break-normal"
                  >
                    <MessageCircle className={`${ICON_CLASS} text-[var(--color-gold)]`} {...ICON} aria-hidden="true" />
                    <span>
                      WhatsApp
                      {waDisplay ? ` · ${waDisplay}` : ''}
                    </span>
                  </a>
                </li>
              ) : null}
              {hasPhone() && phoneHref ? (
                <li>
                  <a href={phoneHref} className="footer-link focus-ring items-center gap-2">
                    <Phone className={`${ICON_CLASS} text-[var(--color-ivory)]/85`} {...ICON} aria-hidden="true" />
                    <span>Phone · {phoneDisplay}</span>
                  </a>
                </li>
              ) : null}
              <li>
                <Link to="/location" className="footer-link focus-ring items-center gap-2">
                  <MapPin className={`${ICON_CLASS} text-[var(--color-gold)]`} {...ICON} aria-hidden="true" />
                  Stall location
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-[var(--color-gold)]/25 pt-6 text-xs leading-snug text-[var(--color-ivory)]/55 sm:flex-row sm:items-center sm:justify-between md:mt-10">
          <p>
            © {year} {brandName}
          </p>
          <p>All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
