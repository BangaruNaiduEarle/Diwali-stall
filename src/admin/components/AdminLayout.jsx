import { useEffect, useId, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import FloatingWhatsAppButton from '../../components/FloatingWhatsAppButton.jsx'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { adminRoleDisplayLabel, canManageAdminUsers } from '../lib/adminRoles.js'
import { closeMobileNavForSignOut } from './adminSignOut.js'

function navLinkClass(isActive) {
  return `admin-header__link${isActive ? ' admin-header__link--active' : ''}`
}

export default function AdminLayout() {
  const { email, role, logout } = useAdminSession()
  const [navOpen, setNavOpen] = useState(false)
  const [signOutLoading, setSignOutLoading] = useState(false)
  const navId = useId()
  const location = useLocation()
  const navigate = useNavigate()

  async function handleSignOut() {
    if (signOutLoading) return
    setSignOutLoading(true)
    closeMobileNavForSignOut({ setNavOpen })
    const outcome = await logout()
    setSignOutLoading(false)
    if (outcome.skipped) return
    navigate('/admin/login', {
      replace: true,
      state: outcome.notice ? { logoutNotice: outcome.notice } : undefined,
    })
  }

  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!navOpen) return
    function onKey(e) {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <div className="admin-shell min-h-svh bg-[var(--color-page)] text-[var(--color-charcoal)]">
      <header className="admin-header">
        <div className="admin-header__inner">
          <div className="admin-header__brand">
            <span className="admin-header__eyebrow">Diwali crackers</span>
            <h1 className="admin-header__title">Admin</h1>
          </div>
          <button
            type="button"
            className="admin-header__menu-btn"
            aria-expanded={navOpen}
            aria-controls={navId}
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? (
              <>
                <X size={22} aria-hidden="true" />
                <span>Close menu</span>
              </>
            ) : (
              <>
                <Menu size={22} aria-hidden="true" />
                <span>Menu</span>
              </>
            )}
          </button>
          <nav
            id={navId}
            className={`admin-header__nav admin-header__nav--panel${navOpen ? ' admin-header__nav--open' : ''}`}
            aria-label="Admin"
          >
            <NavLink to="/admin/products" className={({ isActive }) => navLinkClass(isActive)} end={false}>
              Products
            </NavLink>
            <NavLink to="/admin/family-packs" className={({ isActive }) => navLinkClass(isActive)}>
              Family packs
            </NavLink>
            <NavLink to="/admin/quick-bill" className={({ isActive }) => navLinkClass(isActive)}>
              Quick bill
            </NavLink>
            <NavLink to="/admin/customer-requests" className={({ isActive }) => navLinkClass(isActive)}>
              Requests
            </NavLink>
            {canManageAdminUsers(role) ? (
              <NavLink to="/admin/users" className={({ isActive }) => navLinkClass(isActive)}>
                Users
              </NavLink>
            ) : null}
            <a href="/" className="admin-header__link admin-header__link--muted">
              Public site
            </a>
            <div className="admin-header__account admin-header__account--mobile">
              {email ? (
                <p className="admin-header__user" title={adminRoleDisplayLabel(role)}>
                  {email}
                </p>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                surface="dark"
                size="sm"
                loading={signOutLoading}
                disabled={signOutLoading}
                onClick={() => handleSignOut()}
              >
                Sign out
              </Button>
            </div>
          </nav>
          <div className="admin-header__account admin-header__account--desktop">
            {email ? (
              <p className="admin-header__user" title={adminRoleDisplayLabel(role)}>
                {email}
              </p>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              surface="dark"
              size="sm"
              loading={signOutLoading}
              disabled={signOutLoading}
              onClick={() => handleSignOut()}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
      <FloatingWhatsAppButton />
    </div>
  )
}
