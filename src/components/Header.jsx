import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  ChevronDown,
  CircleHelp,
  Home,
  LayoutGrid,
  MapPin,
  Menu,
  ReceiptText,
  Sparkles,
  X,
} from 'lucide-react'
import EstimateCountBadge from './EstimateCountBadge'
import WhatsAppButton from './WhatsAppButton'
import Button from './ui/Button'
import { useEstimate } from '../context/EstimateContext'
import { CATALOG_CATEGORIES } from '../data/categories'
import { getBrandDisplayName, getWhatsAppDisplayNumber, hasWhatsApp } from '../data/siteConfig'

const ICON = { strokeWidth: 1.8 }

const DESKTOP_NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/crackers', label: 'Crackers', end: false },
  { to: '/location', label: 'Location', end: true },
  { to: '/faq', label: 'FAQ', end: true },
]

const MOBILE_NAV = [
  { to: '/', label: 'Home', end: true, icon: Home },
  {
    to: '/crackers',
    label: 'Crackers',
    end: false,
    icon: Sparkles,
    activeWhen: (pathname) => pathname === '/crackers',
  },
  {
    to: '/crackers',
    label: 'Categories',
    end: false,
    icon: LayoutGrid,
    activeWhen: (pathname) => /^\/crackers\/.+/.test(pathname),
  },
  { to: '/location', label: 'Location', end: true, icon: MapPin },
  { to: '/faq', label: 'FAQ', end: true, icon: CircleHelp },
]

function mobileNavLinkClass({ isActive }) {
  return [
    'focus-ring flex min-h-[52px] items-center gap-4 rounded-xl px-4 text-base font-medium transition-colors',
    isActive
      ? 'bg-[var(--color-ivory)] text-[var(--color-brand-text)] [&_.mobile-nav-icon]:text-[var(--color-red)]'
      : 'text-[var(--color-charcoal)] hover:bg-[#f7f2e9]',
  ].join(' ')
}

function MobileNavDrawer({ open, onClose, brandName, estimateCount }) {
  const { pathname } = useLocation()
  const waDisplay = getWhatsAppDisplayNumber()

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation menu"
        className={`fixed inset-0 z-[90] bg-black/40 transition-opacity duration-300 ease-out lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        tabIndex={-1}
        aria-hidden={!open}
        onClick={onClose}
      />

      <aside
        id="mobile-navigation"
        aria-label="Mobile navigation"
        aria-hidden={!open}
        className={`safe-bottom fixed inset-y-0 left-0 z-[100] flex w-[min(86vw,360px)] flex-col border-r border-[var(--color-border)] bg-[var(--color-ivory)] shadow-[var(--shadow-hover)] transition-transform duration-300 ease-out lg:hidden ${
          open ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4">
          <span className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-charcoal)]">
            {brandName}
          </span>
          <button
            type="button"
            className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--color-charcoal)]"
            aria-label="Close navigation menu"
            onClick={onClose}
          >
            <X className="h-5 w-5" {...ICON} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <nav aria-label="Mobile primary">
            <ul className="flex flex-col gap-1">
              {MOBILE_NAV.map((item) => {
                const ItemIcon = item.icon
                return (
                  <li key={`${item.to}-${item.label}`}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        mobileNavLinkClass({
                          isActive: item.activeWhen ? item.activeWhen(pathname) : isActive,
                        })
                      }
                      onClick={onClose}
                    >
                      <ItemIcon
                        className="mobile-nav-icon h-5 w-5 shrink-0 text-[var(--color-gold)]"
                        {...ICON}
                        aria-hidden="true"
                      />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                )
              })}
              <li>
                <NavLink
                  to="/estimate"
                  className={({ isActive }) => `${mobileNavLinkClass({ isActive })} justify-between`}
                  onClick={onClose}
                >
                  <span className="inline-flex items-center gap-4">
                    <ReceiptText
                      className="mobile-nav-icon h-5 w-5 shrink-0 text-[var(--color-gold)]"
                      {...ICON}
                      aria-hidden="true"
                    />
                    <span>My estimate</span>
                  </span>
                  <EstimateCountBadge count={estimateCount} />
                </NavLink>
              </li>
            </ul>
          </nav>
        </div>

        {hasWhatsApp() ? (
          <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-5">
            <p className="text-sm font-medium text-[var(--color-charcoal)]">Need help?</p>
            <div className="mt-3">
              <WhatsAppButton variant="primary" label="Message us on WhatsApp" fullWidth />
            </div>
            {waDisplay ? (
              <p className="mt-2 text-center text-sm text-[var(--color-muted)]">{waDisplay}</p>
            ) : null}
          </div>
        ) : null}
      </aside>
    </>
  )
}

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const { pathname } = useLocation()
  const brandName = getBrandDisplayName()
  const { estimateCount } = useEstimate()

  const closeMobileMenu = () => setMenuOpen(false)

  useEffect(() => {
    closeMobileMenu()
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return

    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeMobileMenu()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [menuOpen])

  const categoryLinks = CATALOG_CATEGORIES.filter((c) => c.slug !== 'all')
  const estimateAria = `My estimate, ${estimateCount} items`

  const mobileDrawer =
    typeof document !== 'undefined'
      ? createPortal(
          <MobileNavDrawer
            open={menuOpen}
            onClose={closeMobileMenu}
            brandName={brandName}
            estimateCount={estimateCount}
          />,
          document.body,
        )
      : null

  return (
    <header className="safe-top sticky top-0 z-50 hairline-b bg-[var(--color-ivory)]/95 backdrop-blur-md">
      <div className="container-page grid h-14 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-2 sm:h-16 lg:flex lg:h-[4.25rem] lg:justify-between lg:gap-4">
        <button
          type="button"
          className="focus-ring col-start-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-charcoal)] lg:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          aria-label="Open navigation menu"
          onClick={() => setMenuOpen(true)}
        >
          <Menu className="h-5 w-5" {...ICON} />
        </button>

        <Link
          to="/"
          className="header-brand focus-ring col-start-2 min-w-0 justify-self-center truncate whitespace-nowrap text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-charcoal)] min-[360px]:text-[12px] min-[360px]:tracking-[0.1em] sm:text-[13px] sm:tracking-[0.12em] lg:col-start-auto lg:shrink-0 lg:justify-self-start lg:text-left lg:text-sm"
        >
          {brandName}
        </Link>

        <nav className="col-span-3 hidden items-center gap-0.5 lg:col-span-1 lg:flex lg:flex-1 lg:justify-center" aria-label="Main">
          {DESKTOP_NAV.slice(0, 2).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
              {item.label}
            </NavLink>
          ))}

          <div className="relative">
            <button
              type="button"
              className="nav-link inline-flex items-center gap-0.5"
              aria-expanded={categoriesOpen}
              onClick={() => setCategoriesOpen((o) => !o)}
            >
              Categories
              <ChevronDown
                className={`h-3.5 w-3.5 transition-ui ${categoriesOpen ? 'rotate-180' : ''}`}
                {...ICON}
                aria-hidden="true"
              />
            </button>
            {categoriesOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default bg-[var(--color-charcoal)]/15"
                  aria-label="Close categories menu"
                  onClick={() => setCategoriesOpen(false)}
                />
                <ul className="absolute left-0 top-full z-50 mt-3 max-h-80 w-56 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-white)] py-2 shadow-[var(--shadow-hover)]">
                  {categoryLinks.map(({ slug, label }) => (
                    <li key={slug}>
                      <Link
                        to={`/crackers/${slug}`}
                        className="focus-ring block px-4 py-2.5 text-sm text-[var(--color-charcoal)] transition-ui hover:bg-[var(--color-ivory)] hover:text-[var(--color-maroon)]"
                        onClick={() => setCategoriesOpen(false)}
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          {DESKTOP_NAV.slice(2).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="col-start-3 flex shrink-0 items-center justify-self-end lg:col-start-auto">
          <Button
            to="/estimate"
            variant="secondary"
            size="sm"
            icon={ReceiptText}
            aria-label={estimateAria}
            className="header-estimate-btn shrink-0 max-[360px]:!h-11 max-[360px]:!min-w-11 max-[360px]:!px-2 min-[431px]:max-lg:!px-3.5"
          >
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap min-[431px]:gap-2 lg:gap-2">
              <span className="hidden min-[431px]:inline lg:hidden">Estimate</span>
              <span className="hidden lg:inline">My estimate</span>
              <EstimateCountBadge count={estimateCount} />
            </span>
          </Button>
        </div>
      </div>

      {mobileDrawer}
    </header>
  )
}
