import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ClipboardList, Gift, LayoutDashboard, Menu, Package, Settings, ShoppingCart, Tags, Users, X } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import FloatingWhatsAppButton from '../../components/FloatingWhatsAppButton.jsx'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { closeAdminDrawer, dailyAdminLinks, handleAdminDrawerKeyDown, isDrawerBackdropClick, openAdminDrawer, workspaceMenuLinks } from '../lib/adminNavigation.js'
import AdminSeasonSelector from './AdminSeasonSelector.jsx'
import AdminArchivedSeasonBanner from './AdminArchivedSeasonBanner.jsx'
import { useOptionalStallSettings } from '../context/AdminStallSettingsContext.jsx'
import { stallWhatsAppUrl } from '../lib/stallSettings.js'
import '../../styles/admin-workspace.css'

const navigationIcons = {
  '/admin/quick-bill': ShoppingCart,
  '/admin/customer-requests': ClipboardList,
  '/admin/products': Package,
  '/admin/categories': Tags,
  '/admin/family-packs': Gift,
  '/admin/users': Users,
  '/admin/platform': LayoutDashboard,
  '/admin/settings': Settings,
}

export default function AdminWorkspaceShell({ platform = false }) {
  const session = useAdminSession()
  const settingsState = useOptionalStallSettings()
  const selectedSettings = settingsState?.displaySettings
  const { email, logout, contextKey, seasonSwitching, locationModeEnabled } = session
  const location = useLocation()
  const navigate = useNavigate()
  const dialogRef = useRef(null)
  const triggerRef = useRef(null)
  const accountRef = useRef(null)
  const unlockScrollRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const signingOutRef = useRef(false)
  const id = useId()
  const operational = !platform && !['/admin/business', '/admin/context', '/admin'].includes(location.pathname.replace(/\/$/, ''))
  const blocked = locationModeEnabled && operational && seasonSwitching
  const links = platform ? [{ to: '/admin/platform', label: 'Platform overview' }] : dailyAdminLinks(session)
  function closeMenu() { closeAdminDrawer(dialogRef.current, triggerRef.current) }

  useEffect(() => {
    closeAdminDrawer(dialogRef.current, triggerRef.current)
    if (accountRef.current) accountRef.current.open = false
  }, [location.key])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => { if (desktop.matches) closeAdminDrawer(dialogRef.current, triggerRef.current) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => {
      desktop.removeEventListener('change', closeOnDesktop)
      unlockScrollRef.current?.()
    }
  }, [])

  async function handleSignOut() {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    closeMenu()
    const outcome = await logout()
    signingOutRef.current = false
    setSigningOut(false)
    if (!outcome.skipped) navigate('/admin/login', { replace: true, state: outcome.notice ? { logoutNotice: outcome.notice } : undefined })
  }

  function navigation(label) {
    return <nav className="workspace-navigation" aria-label={label}>
      {links.map(link => {
        const Icon = navigationIcons[link.to]
        return <NavLink key={link.to} to={link.to} onClick={closeMenu}
          className={({ isActive }) => `workspace-navigation__link${isActive ? ' workspace-navigation__link--active' : ''}`}>
          {Icon ? <Icon size={18} aria-hidden="true" /> : null}<span>{link.label}</span>
        </NavLink>
      })}
      {!platform && locationModeEnabled ? <NavLink className="workspace-navigation__link" to="/admin/offline" onClick={closeMenu}>Offline billing</NavLink> : null}
      {!links.length ? <p className="text-sm text-[var(--color-muted)]">Choose an authorized stall using the selectors.</p> : null}
    </nav>
  }

  return (
    <div className={`admin-shell workspace-shell${platform ? ' workspace-shell--platform' : ''}`}>
      <a className="skip-link" href="#admin-main">Skip to content</a>
      <header className="workspace-header">
        <div className="workspace-header__brand"><span>{platform ? 'Platform administration' : 'Shop workspace'}</span><strong>{selectedSettings?.profile.brandName || 'Diwali Billing'}</strong></div>
        <button ref={triggerRef} type="button" className="workspace-menu-button" aria-label="Open navigation menu"
          aria-expanded={menuOpen} aria-controls={`${id}-drawer`} aria-haspopup="dialog"
          onClick={() => {
            const unlockScroll = openAdminDrawer(dialogRef.current, document.body)
            if (unlockScroll) {
              unlockScrollRef.current = unlockScroll
              setMenuOpen(true)
            }
          }}><Menu size={22} aria-hidden="true" /><span>Menu</span></button>
        <details ref={accountRef} className="workspace-account">
          <summary><span>Account / workspace</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="workspace-account__panel">
            <p className="workspace-account__email">{email}</p>
            <nav aria-label="Switch workspace">{workspaceMenuLinks(session).map(link => <NavLink key={link.to} to={link.to}>{link.label}</NavLink>)}</nav>
            <a href="/">Public site</a>
            <Button variant="secondary" loading={signingOut} onClick={handleSignOut} fullWidth>Sign out</Button>
          </div>
        </details>
        <div className="workspace-selectors"><AdminSeasonSelector /></div>
      </header>
      <aside className="workspace-sidebar" aria-label={platform ? 'Platform navigation' : 'Stall navigation'}>{navigation(platform ? 'Platform' : 'Stall operations')}</aside>
      <dialog ref={dialogRef} id={`${id}-drawer`} className="workspace-drawer" aria-labelledby={`${id}-title`} aria-modal="true"
        onKeyDown={event => handleAdminDrawerKeyDown(event, dialogRef.current)}
        onClose={() => { unlockScrollRef.current?.(); unlockScrollRef.current = null; setMenuOpen(false); triggerRef.current?.focus() }}
        onClick={event => { if (isDrawerBackdropClick(event, dialogRef.current)) closeMenu() }}>
        <div className="workspace-drawer__head"><h2 id={`${id}-title`}>{platform ? 'Platform navigation' : 'Stall operations'}</h2>
          <button type="button" aria-label="Close navigation menu" onClick={closeMenu} autoFocus><X size={22} aria-hidden="true" /></button></div>
        <AdminSeasonSelector />
        {navigation(platform ? 'Mobile platform' : 'Mobile stall operations')}
      </dialog>
      <main id="admin-main" tabIndex={-1} className="admin-main workspace-main">
        {!locationModeEnabled || operational ? <AdminArchivedSeasonBanner /> : null}
        {blocked ? <p className="admin-state" role="status">Switching stall…</p> : null}
        <div inert={blocked} aria-busy={seasonSwitching}><Fragment key={operational ? contextKey : 'workspace'}><Outlet /></Fragment></div>
      </main>
      <FloatingWhatsAppButton hrefOverride={!platform && locationModeEnabled ? stallWhatsAppUrl(selectedSettings) : undefined} />
    </div>
  )
}
