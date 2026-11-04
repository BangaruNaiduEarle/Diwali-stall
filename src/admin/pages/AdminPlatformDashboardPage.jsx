import { useAdminSession } from '../context/AdminSessionContext.jsx'
import PlatformBusinessSeasonsSection from '../components/PlatformBusinessSeasonsSection.jsx'
import PlatformPublicCatalogueSection from '../components/PlatformPublicCatalogueSection.jsx'
import PlatformCreateStallSection from '../components/PlatformCreateStallSection.jsx'

export default function AdminPlatformDashboardPage() {
  const { email, platformAdmin, memberships, activeSeasonId } = useAdminSession()

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <p className="admin-page__eyebrow">Platform</p>
          <h1 className="admin-page__title">Platform administration</h1>
          <p className="admin-page__subtitle">
            Manage business seasons and platform-wide settings. Season catalogue tools remain under
            the main admin menu when you have season membership.
          </p>
        </div>
      </header>

      <section className="admin-panel mt-6" aria-labelledby="platform-session-heading">
        <h2 id="platform-session-heading" className="text-sm font-semibold text-[var(--color-charcoal)]">
          Your platform session
        </h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-[var(--color-muted)]">Signed in</dt>
            <dd>{email ?? '—'}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-[var(--color-muted)]">Platform admin</dt>
            <dd>{platformAdmin ? 'Yes' : 'No'}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-[var(--color-muted)]">Season memberships</dt>
            <dd>{memberships.length}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-[var(--color-muted)]">Active season</dt>
            <dd>{activeSeasonId ?? 'None selected'}</dd>
          </div>
        </dl>
      </section>

      <PlatformPublicCatalogueSection />

      <PlatformCreateStallSection />

      <PlatformBusinessSeasonsSection />
    </div>
  )
}
