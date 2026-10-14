import { useEffect, useId, useRef, useState } from 'react'
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
const HOVER_OPEN_MS = 75
const HOVER_CLOSE_MS = 100
const PANEL_ANIM_MS = 180

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
    activeWhen: (pathname) => pathname === '/crackers' || pathname.startsWith('/crackers/'),
  },
  { to: '/location', label: 'Location', end: true, icon: MapPin },
  { to: '/faq', label: 'FAQ', end: true, icon: CircleHelp },
]

function DesktopCategoriesNav({ open, setOpen, categoryLinks, categoriesNavActive, pathname }) {
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const openTimer = useRef(null)
  const closeTimer = useRef(null)
  const menuId = useId()
  const [panelMounted, setPanelMounted] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)

  const clearHoverTimers = () => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
  }

  const scheduleOpen = () => {
    clearHoverTimers()
    openTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_MS)
  }

  const scheduleClose = () => {
    clearHoverTimers()
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
  }

  useEffect(() => {
    if (open) {
      setPanelMounted(true)
      const frame = requestAnimationFrame(() => setPanelVisible(true))
      return () => cancelAnimationFrame(frame)
    }
    setPanelVisible(false)
    const t = setTimeout(() => setPanelMounted(false), PANEL_ANIM_MS)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen])

  useEffect(() => () => clearHoverTimers(), [])

  const focusFirstItem = () => {
    requestAnimationFrame(() => {
      menuRef.current?.querySelector('a')?.focus()
    })
  }

  return (
    <div ref={rootRef} className="relative" onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose}>
      <button
        type="button"
        className={`nav-link ${categoriesNavActive ? 'nav-link--active' : ''} ${open ? 'nav-categories-trigger--open' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((prev) => {
              const next = !prev
              if (next) focusFirstItem()
              return next
            })
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            focusFirstItem()
          }
          if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      >
        Categories
        <ChevronDown
          className={`nav-categories-chevron h-4 w-4 shrink-0 ${open ? 'nav-categories-chevron--open' : ''}`}
          {...ICON}
          aria-hidden="true"
        />
      </button>

      {panelMounted ? (
        <div className="absolute left-0 top-full z-[60] pt-1" onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose}>
          <ul
            ref={menuRef}
            id={menuId}
            role="menu"
            className={`nav-categories-panel list-none p-0 ${panelVisible ? 'nav-categories-panel--visible' : ''}`}
          >
            {categoryLinks.map(({ slug, label }) => {
              const href = `/crackers/${slug}`
              const active = pathname === href
              return (
                <li key={slug} role="none">
                  <Link
                    to={href}
                    role="menuitem"
                    className={`nav-categories-item focus-ring ${active ? 'nav-categories-item--active' : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    {label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function MobileCategoriesAccordion({ categoryLinks, pathname, categoriesNavActive, onClose }) {
  const [expanded, setExpanded] = useState(categoriesNavActive)
  const panelId = useId()

  useEffect(() => {
    if (categoriesNavActive) setExpanded(true)
  }, [categoriesNavActive, pathname])

  return (
    <li>
      <button
        type="button"
        className={[
          'nav-drawer-link focus-ring w-full justify-between',
          categoriesNavActive ? 'nav-drawer-link--current' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="inline-flex items-center gap-4">
          <LayoutGrid className="nav-drawer-icon h-5 w-5 shrink-0" {...ICON} aria-hidden="true" />
          <span>Categories</span>
        </span>
        <ChevronDown
          className={`nav-categories-chevron h-4 w-4 shrink-0 ${expanded ? 'nav-categories-chevron--open' : ''}`}
          {...ICON}
          aria-hidden="true"
        />
      </button>
      <div
        id={panelId}
        className={`nav-drawer-categories-panel ${expanded ? 'nav-drawer-categories-panel--open' : 'nav-drawer-categories-panel--closed'}`}
      >
        <ul className="min-h-0 overflow-hidden pb-1">
          {categoryLinks.map(({ slug, label }) => {
            const href = `/crackers/${slug}`
            const active = pathname === href
            return (
              <li key={slug}>
                <Link
                  to={href}
                  className={`nav-drawer-category-link focus-ring ${active ? 'nav-drawer-category-link--active' : ''}`}
                  onClick={onClose}
                >
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </li>
  )
}

function MobileNavDrawer({ open, onClose, brandName, estimateCount, categoryLinks, categoriesNavActive }) {
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

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
          <nav aria-label="Mobile primary">
            <ul className="flex flex-col gap-0.5">
              {MOBILE_NAV.slice(0, 2).map((item) => {
                const ItemIcon = item.icon
                return (
                  <li key={`${item.to}-${item.label}`}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => {
                        const active = item.activeWhen ? item.activeWhen(pathname) : isActive
                        return ['nav-drawer-link focus-ring', active ? 'nav-drawer-link--current' : '']
                          .filter(Boolean)
                          .join(' ')
                      }}
                      onClick={onClose}
                    >
                      <ItemIcon className="nav-drawer-icon h-5 w-5 shrink-0" {...ICON} aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                )
              })}

              <MobileCategoriesAccordion
                categoryLinks={categoryLinks}
                pathname={pathname}
                categoriesNavActive={categoriesNavActive}
                onClose={onClose}
              />

              {MOBILE_NAV.slice(2).map((item) => {
                const ItemIcon = item.icon
                return (
                  <li key={`${item.to}-${item.label}`}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        ['nav-drawer-link focus-ring', isActive ? 'nav-drawer-link--current' : '']
                          .filter(Boolean)
                          .join(' ')
                      }
                      onClick={onClose}
                    >
                      <ItemIcon className="nav-drawer-icon h-5 w-5 shrink-0" {...ICON} aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                )
              })}

              <li className="my-2 border-t border-[var(--color-border)] pt-2" aria-hidden="true" />
              <li>
                <NavLink
                  to="/estimate"
                  className={({ isActive }) =>
                    ['nav-drawer-link focus-ring justify-between', isActive ? 'nav-drawer-link--current' : '']
                      .filter(Boolean)
                      .join(' ')
                  }
                  end
                  onClick={onClose}
                >
                  <span className="inline-flex items-center gap-4">
                    <ReceiptText className="nav-drawer-icon h-5 w-5 shrink-0" {...ICON} aria-hidden="true" />
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
    setCategoriesOpen(false)
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
  const categoriesNavActive = /^\/crackers\/.+/.test(pathname)
  const estimateAria = `My estimate, ${estimateCount} items`

  const mobileDrawer =
    typeof document !== 'undefined'
      ? createPortal(
          <MobileNavDrawer
            open={menuOpen}
            onClose={closeMobileMenu}
            brandName={brandName}
            estimateCount={estimateCount}
            categoryLinks={categoryLinks}
            categoriesNavActive={categoriesNavActive}
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
          className="header-brand focus-ring col-start-2 flex min-w-0 items-center justify-self-center truncate whitespace-nowrap text-center text-[11px] font-semibold uppercase leading-none tracking-[0.08em] text-[var(--color-charcoal)] min-[360px]:text-[12px] min-[360px]:tracking-[0.1em] sm:text-[13px] sm:tracking-[0.12em] lg:col-start-auto lg:shrink-0 lg:justify-self-start lg:text-left lg:text-sm"
        >
          {brandName}
        </Link>

        <nav className="col-span-3 hidden items-center gap-1 lg:col-span-1 lg:flex lg:flex-1 lg:justify-center" aria-label="Main">
          {DESKTOP_NAV.slice(0, 2).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
              {item.label}
            </NavLink>
          ))}

          <DesktopCategoriesNav
            open={categoriesOpen}
            setOpen={setCategoriesOpen}
            categoryLinks={categoryLinks}
            categoriesNavActive={categoriesNavActive}
            pathname={pathname}
          />

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
