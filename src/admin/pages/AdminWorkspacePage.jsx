import { useLocation } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { useOptionalStallSettings } from '../context/AdminStallSettingsContext.jsx'
import { adminDestination, adminRouteAccess, canAccessOwnerWorkspace, hasWorkspaceCapability, ownedWorkspaceLocations, resolveAdminLoginDestination } from '../lib/adminWorkspaceAccess.js'

export default function AdminWorkspacePage({ owner = false }) {
  const session = useAdminSession()
  const settings = useOptionalStallSettings()?.displaySettings
  const { state } = useLocation()
  const locations = owner ? ownedWorkspaceLocations(session) : session.authorizedLocations
  const canOperate = hasWorkspaceCapability(session, 'read')
  const requestedAllowed = state?.from && adminDestination(state.from)?.path !== '/admin/context' && adminRouteAccess(session, state.from).allowed
  return (
    <div className="admin-page">
      <header className="admin-page__head"><div>
        <p className="admin-page__eyebrow">{owner ? 'Business owner' : 'Workspace'}</p>
        <h1 className="admin-page__title">{owner ? 'Your authorized locations' : canOperate ? 'Stall ready' : 'Choose an authorized context'}</h1>
        <p className="admin-page__subtitle">{owner ? 'Owner access applies only to the locations listed here. Select a season and stall above to manage it.' :
          'Use the season and active-stall selector above. Platform access does not grant stall permissions.'}</p>
      </div></header>
      {session.locationModeEnabled && locations.length ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {locations.map(row => <section className="admin-panel" key={`${row.operatingSeason.id}:${row.location.id}`}>
            <h2 className="text-base font-semibold">{row.business.name} · {settings?.scope.locationId === row.location.id ? settings.profile.stallName : row.location.name}</h2>
            <p className="mt-2 text-sm text-[var(--color-muted)]">{row.operatingSeason.label} · {row.effectiveRole === 'owner' ? 'Owner' : row.effectiveRole === 'super_admin' ? 'Super Admin' : 'Admin'}{row.capabilities.write ? '' : ' · Read only'}</p>
          </section>)}
        </div>
      ) : <p className="admin-panel mt-6">{session.locationModeEnabled ? 'No authorized stalls are available. Ask an authorized owner or platform administrator to review your memberships.' :
        owner ? 'Your existing season owner workspace is available below.' : 'Select an enabled season membership above. If none is available, ask an administrator to review your access.'}</p>}
      {settings ? <section className="admin-panel mt-6" aria-label="Selected stall contact and schedule">
        <h2 className="admin-label">Selected stall details</h2>
        <p>{settings.profile.locationName}</p><p>{settings.profile.locationAddress}</p>
        {settings.profile.locationDetailLines.map((line,index) => <p key={index}>{line}</p>)}
        {settings.profile.phone ? <p><a href={`tel:${settings.profile.phone}`}>{settings.profile.phone}</a></p> : null}
        {settings.profile.locationMapUrl ? <p><a href={settings.profile.locationMapUrl} target="_blank" rel="noopener noreferrer">View stall map</a></p> : null}
        <p>{settings.season.stallDates.join(' · ')}</p><p>{settings.season.stallTimings}</p>
      </section> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {canOperate ? <Button to={requestedAllowed ? resolveAdminLoginDestination(session, state.from) : '/admin/quick-bill'}>Open selected stall</Button> : null}
        {session.platformAdmin ? <Button to="/admin/platform" variant="secondary">Platform administration</Button> : null}
        {!owner && canAccessOwnerWorkspace(session) ? <Button to="/admin/business" variant="secondary">Owner workspace</Button> : null}
      </div>
    </div>
  )
}
