import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import AdminFeedbackBanner from './AdminFeedbackBanner.jsx'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { createPlatformLocation, fetchPlatformSeasonMembers } from '../api/adminPlatformApi.js'
import { buildStallRequest, createStallAndRefresh, stallBusinesses, stallOwners } from '../lib/adminPlatformStall.js'

export default function PlatformCreateStallSection() {
  const { platformAdmin, locationModeEnabled, authorizedLocations, email, refreshSession, seasonSwitching } = useAdminSession()
  const businesses = useMemo(() => stallBusinesses(authorizedLocations), [authorizedLocations])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [form, setForm] = useState({ name: '', slug: '', businessId: '', ownerUserId: '' })
  const owners = useMemo(() => stallOwners(members), [members])
  const businessId = form.businessId || businesses[0]?.id || ''
  const ownerUserId = form.ownerUserId || owners.find(owner => owner.email === email)?.userId || owners[0]?.userId || ''

  useEffect(() => {
    if (!platformAdmin || !locationModeEnabled) return
    let cancelled = false
    fetchPlatformSeasonMembers('season-2026').then(result => {
      if (cancelled) return
      if (result.ok && result.season.status === 'active') setMembers(result.members)
      else {
        setMembers([])
        setLoadError(result.ok ? 'The 2026 season is not active.' : result.message)
      }
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setMembers([])
      setLoadError('Could not load 2026 owners. Try again.')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [platformAdmin, locationModeEnabled, attempt])

  if (!platformAdmin || !locationModeEnabled) return null

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting.current || loading || seasonSwitching || loadError) return
    setError('')
    setSuccess('')
    const request = buildStallRequest({ ...form, businessId, ownerUserId }, businesses, owners)
    if (!request.ok) { setError(request.message); return }
    submitting.current = true
    setBusy(true)
    try {
      const result = await createStallAndRefresh(request.body, { create: createPlatformLocation, refreshSession })
      if (!result.ok) { setError(result.message); return }
      setForm(previous => ({ ...previous, name: '', slug: '' }))
      setSuccess(`${result.location.name} was created for 2026.`)
      if (!result.refreshed) setError('The stall was created, but the stall list could not be refreshed. Reload or sign in again before continuing. Do not submit it again.')
    } catch {
      setError('Could not confirm stall creation. Refresh before trying again.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <section className="admin-panel mt-6" aria-labelledby="create-stall-heading">
      <h2 id="create-stall-heading" className="text-base font-semibold">Create stall</h2>
      <p className="mt-2 text-sm text-[var(--color-muted)]">Add a stall for Diwali 2026 and assign its initial owner.</p>
      <AdminFeedbackBanner variant="error" message={loadError || error} className="mt-4" />
      <AdminFeedbackBanner variant="success" message={success} className="mt-4" />
      {loadError ? <Button variant="secondary" onClick={() => { setLoading(true); setLoadError(''); setAttempt(value => value + 1) }} className="mt-3">Retry loading owners</Button> : null}
      {!businesses.length ? <p className="mt-3 text-sm">No active seasonal business is available in your authorized 2026 stalls.</p> : null}
      {!loading && !loadError && !owners.length ? <p className="mt-3 text-sm">An enabled 2026 season owner is required.</p> : null}
      <form onSubmit={handleSubmit} className="mt-4">
        <p className="mb-4 text-sm text-[var(--color-muted)]">The new stall will be available to its initial owner. Other admins need their own stall membership.</p>
        <fieldset disabled={busy || loading || Boolean(loadError) || seasonSwitching} className="grid gap-4 md:grid-cols-2">
          <label className="admin-field"><span className="admin-label">Business</span>
            <select className="admin-input" required value={businessId} onChange={event => setForm({ ...form, businessId: event.target.value })}>
              {!businesses.length ? <option value="">No business available</option> : null}
              {businesses.map(business => <option key={business.id} value={business.id}>{business.name || business.id}</option>)}
            </select>
          </label>
          <label className="admin-field"><span className="admin-label">Initial owner</span>
            <select className="admin-input" required value={ownerUserId} onChange={event => setForm({ ...form, ownerUserId: event.target.value })}>
              {!owners.length ? <option value="">{loading ? 'Loading owners…' : 'No owner available'}</option> : null}
              {owners.map(owner => <option key={owner.userId} value={owner.userId}>{owner.email}</option>)}
            </select>
          </label>
          <label className="admin-field"><span className="admin-label">Stall display name</span>
            <input className="admin-input" required maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="admin-field"><span className="admin-label">Unique stall code</span>
            <input className="admin-input" required maxLength={64} pattern="[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*" placeholder="e.g. diwali-market-east" value={form.slug} onChange={event => setForm({ ...form, slug: event.target.value })} />
          </label>
          <div className="md:col-span-2"><Button type="submit" loading={busy} disabled={!businesses.length || !owners.length}>Create stall</Button></div>
        </fieldset>
      </form>
    </section>
  )
}
