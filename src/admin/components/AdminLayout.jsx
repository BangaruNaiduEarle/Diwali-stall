import { NavLink, Outlet } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import { useAdminSession } from '../context/AdminSessionContext.jsx'

export default function AdminLayout() {
  const { email, role, logout } = useAdminSession()

  return (
    <div className="admin-shell min-h-svh bg-[var(--color-page)] text-[var(--color-charcoal)]">
      <header className="admin-header">
        <div className="admin-header__inner">
          <div className="admin-header__brand">
            <span className="admin-header__eyebrow">Diwali crackers</span>
            <h1 className="admin-header__title">Admin</h1>
          </div>
          <nav className="admin-header__nav" aria-label="Admin">
            <NavLink
              to="/admin/products"
              className={({ isActive }) =>
                `admin-header__link${isActive ? ' admin-header__link--active' : ''}`
              }
              end={false}
            >
              Products
            </NavLink>
            <NavLink
              to="/admin/customer-requests"
              className={({ isActive }) =>
                `admin-header__link${isActive ? ' admin-header__link--active' : ''}`
              }
            >
              Requests
            </NavLink>
            {role === 'owner' ? (
              <NavLink
                to="/admin/users"
                className={({ isActive }) =>
                  `admin-header__link${isActive ? ' admin-header__link--active' : ''}`
                }
              >
                Users
              </NavLink>
            ) : null}
            <a href="/" className="admin-header__link admin-header__link--muted">
              Public site
            </a>
          </nav>
          <div className="flex items-center gap-3">
            {email ? (
              <p className="admin-header__user" title={role === 'owner' ? 'Owner' : 'Admin'}>
                {email}
              </p>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
