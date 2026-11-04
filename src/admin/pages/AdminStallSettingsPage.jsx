import { useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { useStallSettings } from '../context/AdminStallSettingsContext.jsx'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { settingsForm, settingsPatch } from '../lib/stallSettings.js'

const profileFields = [['stallName','Stall name',200],['stallLabel','Stall label',120],['brandName','Brand name',120],
  ['whatsappNumber','WhatsApp number',16],['phone','Phone',16],['locationName','Venue name',200],['locationAddress','Address',1000],['locationMapUrl','Map URL',2048]]
function Editor({settings}) {
  const session = useAdminSession(), state = useStallSettings()
  const [form,setForm] = useState(() => settingsForm(settings))
  const editable = canViewSensitiveProductPricing(session.permissionRole) && settings.permissions.canUpdate && !state.blocked
  const saving = state.status === 'saving'
  const patch = settingsPatch(settings,form)
  function field(section,key,value) {setForm(current => ({...current,[section]:{...current[section],[key]:value}}))}
  async function submit(event) {
    event.preventDefault()
    if (!editable || saving || !patch) return
    const result = await state.save(patch)
    if (result.ok) await session.refreshSession()
  }
  return <form onSubmit={submit} className="admin-panel mt-6" aria-label="Stall settings form">
    {!editable && !saving ? <p className="admin-state" role="status">{state.blocked ? 'Saving is paused. Reload current settings before trying again.' : 'Read-only settings. Only an authorized Owner or Super Admin can save in an active stall and season.'}</p> : null}
    <p className="text-sm text-[var(--color-muted)]">Profile details apply to this stall across seasons. Dates and hours apply only to the selected season.</p>
    <fieldset disabled={!editable || saving} className="mt-4 grid gap-4 md:grid-cols-2">
      <legend className="admin-label">Stall profile</legend>
      {profileFields.map(([key,label,max]) => <label className="admin-field" key={key}>
        <span className="admin-label">{label}</span><input className="admin-input" name={key} aria-label={label} maxLength={max}
          type={key === 'locationMapUrl'?'url':'text'} value={form.profile[key]} onChange={e => field('profile',key,e.target.value)} />
      </label>)}
      <label className="admin-field"><span className="admin-label">Venue detail lines</span><textarea className="admin-input" aria-label="Venue detail lines" rows={3} value={form.profile.locationDetailLines} onChange={e => field('profile','locationDetailLines',e.target.value)} /><span className="text-xs">One line per entry; up to eight lines.</span></label>
    </fieldset>
    <fieldset disabled={!editable || saving} className="mt-6 grid gap-4 md:grid-cols-2">
      <legend className="admin-label">Season schedule</legend>
      <label className="admin-field"><span className="admin-label">Stall dates</span><textarea className="admin-input" aria-label="Stall dates" rows={4} value={form.season.stallDates} onChange={e => field('season','stallDates',e.target.value)} /><span className="text-xs">One date per line: YYYY-MM-DD or November 6, 2026.</span></label>
      <label className="admin-field"><span className="admin-label">Opening hours</span><input className="admin-input" aria-label="Opening hours" maxLength={160} value={form.season.stallTimings} onChange={e => field('season','stallTimings',e.target.value)} /></label>
    </fieldset>
    {state.error ? <div className="admin-state admin-state--error mt-4" role="alert"><p>{state.conflict ? 'Settings changed on the server. Your edits remain here; reload the latest settings before saving again.' : state.error.message}</p></div> : null}
    {state.notice && !patch ? <p className="admin-state mt-4" role="status">{state.notice}</p> : null}
    <div className="mt-6 flex flex-wrap gap-3">
      {canViewSensitiveProductPricing(session.permissionRole) && settings.permissions.canUpdate ? <Button type="submit" loading={saving} disabled={!editable || !patch}>Save settings</Button> : null}
      <Button variant="secondary" disabled={saving} onClick={() => state.reload()}>{patch ? 'Reload settings and discard edits' : 'Refresh settings'}</Button>
    </div>
  </form>
}
export default function AdminStallSettingsPage() {
  const state = useStallSettings(), session = useAdminSession()
  const settings = state.settings
  return <div className="admin-page">
    <header className="admin-page__head"><div><p className="admin-page__eyebrow">Selected stall</p><h1 className="admin-page__title">Stall settings</h1>
      <p className="admin-page__subtitle">{settings?.profile.stallName ?? session.location?.name ?? 'Choose an authorized stall'} · {session.activeSeasonId ?? ''}</p></div></header>
    {state.status === 'loading' ? <p className="admin-state" role="status">Loading selected stall settings…</p> : null}
    {state.status === 'legacy' ? <p className="admin-state">Your existing single-stall defaults are unchanged. Settings editing requires the authorized location workspace.</p> : null}
    {state.status === 'error' ? <div className="admin-state admin-state--error" role="alert"><p>{state.error.message}</p><Button variant="secondary" onClick={() => state.reload()}>Retry loading settings</Button></div> : null}
    {settings ? <Editor key={JSON.stringify([settings.scope,settings.revisions])} settings={settings} /> : null}
  </div>
}
