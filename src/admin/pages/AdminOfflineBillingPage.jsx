import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { fetchAdminSession } from '../api/adminApi.js'
import { fetchOfflineCatalogue, fetchOfflineRequest, registerOfflineDevice, sendOfflineOperation } from '../api/adminOffline.js'
import { openOfflineStorage, offlineScopeKey } from '../offline/storage.js'
import { synchronizeOutbox } from '../offline/synchronize.js'
import { prepareOfflineAppShell } from '../offline/appShell.js'
import { readStorageHealth } from '../offline/storageHealth.js'
import OfflineStorageStatus from '../components/OfflineStorageStatus.jsx'
import OfflineHandover from '../components/OfflineHandover.jsx'
import OfflineFinancialSummary from '../components/OfflineFinancialSummary.jsx'
import { sellingLines,assertCompleteFamilyDraft } from '../offline/handover.js'
import { transferProductIds } from '../../shared/familyPackSnapshot.js'
import FamilyPackSnapshotPreview from '../components/FamilyPackSnapshotPreview.jsx'
import { adjustmentPayload, paiseInputValue, rupeesToPaise } from '../lib/billAdjustment.js'
import { formatPaymentPaise, paymentPayload, PAYMENT_METHOD_OPTIONS } from '../lib/payments.js'
import '../../styles/admin-workspace.css'

const matchingSession = (session, scope) => session.ok && session.userId === scope.userId && session.activeBusinessId === scope.businessId && session.activeLocationId === scope.locationId && session.activeSeasonId === scope.seasonId
const fromSnapshot = snapshot => ({ draftId: crypto.randomUUID(), requestId: snapshot.request.id, expectedRevision: snapshot.request.revision,familyPackSnapshotsVersion:1,
  serverSnapshot: snapshot, agreedInr: paiseInputValue(snapshot.acceptedAmountPaise), discountInr: '',
  body: { customer: { name: snapshot.request.customerName ?? '', mobile: snapshot.request.customerPhone ?? '',area:snapshot.request.customerArea??'',note:snapshot.request.customerNote??'',pickupPreference:snapshot.request.pickupPreference??'',deliveryAddress:snapshot.request.deliveryAddress??'',deliveryLandmark:snapshot.request.deliveryLandmark??'',deliveryMapsUrl:snapshot.request.deliveryMapsUrl??'' },
    items: snapshot.request.items.map(item => item.familyPackId?{lineId:item.lineId,familyPackId:item.familyPackId,quantity:item.quantity,unitType:'box',familyPackSnapshot:item.packSnapshot}:{ lineId:item.lineId, productId: item.productId, quantity: item.quantity, unitType: item.unitType ?? 'box' }) } })

/** Local workspace intentionally lives outside AdminGate. Cached identity only
 * enables local work; every network operation still requires current authentication. */
export default function AdminOfflineBillingPage() {
  const session = useAdminSession()
  const [params] = useSearchParams()
  const [profile, setProfile] = useState(null), [catalogue, setCatalogue] = useState([]), [drafts, setDrafts] = useState([]), [operations, setOperations] = useState([])
  const [familyPacks,setFamilyPacks]=useState([]),[packIssues,setPackIssues]=useState([]),[selectedPack,setSelectedPack]=useState('')
  const [editor, setEditor] = useState(null), [online, setOnline] = useState(() => navigator.onLine)
  const [localConflict, setLocalConflict] = useState(null), [deviceConflicts, setDeviceConflicts] = useState([])
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [saveCount, setSaveCount] = useState(0)
  const [storageDb, setStorageDb] = useState(null)
  const [storageRevision, setStorageRevision] = useState(0)
  const [error, setError] = useState(null), [notice, setNotice] = useState(null), [requestId, setRequestId] = useState(params.get('requestId') ?? '')
  const [selectedProduct, setSelectedProduct] = useState(''), [review, setReview] = useState(null)
  const [payAmount, setPayAmount] = useState(''), [payMethod, setPayMethod] = useState('CASH'), [payReference, setPayReference] = useState('')
  const [payAction, setPayAction] = useState('PAYMENT'), [payDetails, setPayDetails] = useState('')
  const [payOccurredAt, setPayOccurredAt] = useState('')
  const storage = useRef(null), selected = useRef(null), saves = useRef(Promise.resolve()), syncing = useRef(false), scopeRef = useRef(null)
  const localVersions = useRef(new Map())
  const profileAllowed = profile && !profile.authorityRevoked && session.errorCode !== 'offline_authority_unavailable' && (session.status !== 'authenticated' || session.userId === profile.scope.userId && session.activeBusinessId === profile.scope.businessId && session.activeLocationId === profile.scope.locationId && session.activeSeasonId === profile.scope.seasonId)
  const privileged = ['owner','super_admin'].includes(session.status === 'authenticated' ? session.permissionRole : profile?.role)
  const writable = profile?.writable && (session.status !== 'authenticated' || session.capabilities.write === true)
  const saving = saveCount > 0
  useEffect(() => { scopeRef.current = profileAllowed ? profile?.scope : null }, [profileAllowed, profile])

  async function reload(currentProfile) {
    const active = currentProfile ?? await storage.current.activeProfile()
    if (!active) { setReady(true); return }
    const [cached, localDrafts, rows, versions] = await Promise.all([storage.current.get('catalogues', active.scope, 'catalogue'), storage.current.list('drafts', active.scope), storage.current.list('outbox', active.scope), storage.current.list('versions', active.scope)])
    const resolved = new Set(versions.map(version => version.resolvesLocalVersion).filter(Boolean))
    setDeviceConflicts(versions.filter(version => version.conflict && !resolved.has(version.key)))
    setProfile(active); setCatalogue(cached?.products ?? []);setFamilyPacks(cached?.familyPacks??[]);setPackIssues(cached?.familyPackIssues??[]); setDrafts(localDrafts); setOperations(rows.sort((a, b) => a.order - b.order)); setReady(true)
  }
  useEffect(() => {
    let cancelled = false, ownedDb = null
    openOfflineStorage().then(async db => {
      if (cancelled) { db.close(); return }
      storage.current = db
      ownedDb = db
      setStorageDb(db)
      const active = await db.activeProfile()
      if (active) await db.recover(active.scope)
      if (!cancelled) await reload(active)
    }).catch(reason => { if (!cancelled) { setError(reason.message); setReady(true) } })
    const update = () => setOnline(navigator.onLine)
    const authorityChanged = () => {
      if (!storage.current || cancelled) return
      setProfile(null)
      reload().catch(reason => setError(reason.message))
    }
    window.addEventListener('online', update); window.addEventListener('offline', update)
    window.addEventListener('diwali-offline-authority-changed', authorityChanged)
    return () => { cancelled = true; window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('diwali-offline-authority-changed', authorityChanged); saves.current.then(() => ownedDb?.close(), () => ownedDb?.close()) }
  }, [])

  function choose(draft) { selected.current = draft; if (draft) localVersions.current.set(draft.draftId, draft.localRevision); saves.current = saves.current.catch(() => {}); setEditor(draft); setReview(null); setLocalConflict(null); setNotice(null) }
  function persist(next) {
    selected.current = next; setEditor(next); setSaveCount(count => count + 1); setError(null)
    const targetScope = profile.scope
    saves.current = saves.current.catch(() => {}).then(() => storage.current.saveDraft(targetScope, { ...next, localRevision: localVersions.current.get(next.draftId) ?? next.localRevision })).then(({ draft }) => {
      localVersions.current.set(draft.draftId, draft.localRevision)
      if (selected.current?.draftId === draft.draftId) { selected.current = { ...draft, ...selected.current, localRevision: draft.localRevision, tailOperationId: draft.tailOperationId }; setEditor(selected.current) }
      setDrafts(rows => [...rows.filter(row => row.draftId !== draft.draftId), draft])
    }).catch(reason => { if (reason.code === 'local_revision_conflict') setLocalConflict(reason); setError('Draft was not saved: ' + reason.message); throw reason }).finally(() => setSaveCount(count => count - 1))
    // A failed transaction stays visible; attaching a handler also avoids an
    // unhandled rejection while preserving failure for queue() to observe.
    saves.current.catch(() => {})
  }
  const patch = changes => persist({ ...selected.current, ...changes })
  function patchBody(changes) { patch({ body: { ...selected.current.body, ...changes } }) }
  async function prepare() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const confirmed = await fetchAdminSession()
      if (!confirmed.ok || !confirmed.locationModeEnabled || !confirmed.activeLocationId) throw Error('Sign in and select an authorized stall in the online workspace first.')
      const device = await storage.current.device()
      const registered = await registerOfflineDevice(device)
      if (!registered.ok) throw Error(registered.message)
      const snapshot = await fetchOfflineCatalogue()
      if (!snapshot.ok) throw Error(snapshot.message)
      const scope = { businessId: confirmed.activeBusinessId, locationId: confirmed.activeLocationId, seasonId: confirmed.activeSeasonId, userId: confirmed.userId, deviceId: device.deviceId }
      if (['businessId','locationId','seasonId','userId'].some(key => registered.scope[key] !== scope[key] || snapshot.scope[key] !== scope[key])) throw Error('The active stall changed during preparation. Try again.')
      await saves.current
      const next = { scope, role: confirmed.effectiveRole, writable: confirmed.capabilities.write === true, email: confirmed.email,
        label: `${confirmed.business?.name ?? scope.businessId} / ${confirmed.location?.name ?? scope.locationId}`, confirmedAt: new Date().toISOString() }
      await storage.current.activate(next, snapshot.products,snapshot.familyPacks??[],snapshot.familyPackIssues??[])
      choose(null); await reload(next)
      const { persistent } = await readStorageHealth(navigator.storage, true)
      setStorageRevision(value => value + 1)
      let shell
      try { await prepareOfflineAppShell(); shell = 'Offline page reload is ready.' }
      catch (reason) { shell = `Draft storage is ready, but offline page reload is not confirmed: ${reason.message}` }
      setNotice(`Workspace saved. ${persistent ? 'Persistent browser storage granted.' : 'Browser storage remains subject to browser eviction.'} ${shell}`)
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  async function download(fresh = false) {
    setBusy(true); setError(null)
    try {
      const confirmed = await fetchAdminSession()
      if (!matchingSession(confirmed, profile.scope)) throw Error('Sign in to the saved user and stall before downloading a request.')
      const snapshot = await fetchOfflineRequest(requestId.trim())
      if (!snapshot.ok) throw Error(snapshot.message)
      await saves.current
      const existing = (await storage.current.list('drafts', profile.scope)).find(row => row.requestId === snapshot.request.id)
      // Never refresh a local version in place, including acknowledged history.
      if (existing && !fresh) { choose(existing); setNotice('Opened the existing local version. Its original revision was retained. Use Save fresh revision as separate draft to preserve this version and download the latest one.'); return }
      const { draft } = await storage.current.saveDraft(profile.scope, fromSnapshot(snapshot))
      choose(draft); await reload(profile)
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  async function queue(kind) {
    setBusy(true); setError(null); setNotice(null)
    try {
      await saves.current
      const draft = selected.current
      if (!draft) throw Error('Choose a draft first.')
      let body, snapshots
      const items = draft.body.items.map(({ productId, familyPackId,quantity, unitType }) => familyPackId?{familyPackId,quantity}:{ productId, quantity, unitType })
      let lineSnapshots
      if (['CREATE','EDIT'].includes(kind)) {
        assertCompleteFamilyDraft(draft)
        if (!items.length || items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) throw Error('Add products with quantities between 1 and 99.')
        lineSnapshots=sellingLines(draft.body.items,catalogue,draft.draftId)
        snapshots = transferProductIds(lineSnapshots).map(id => {
          const product = catalogue.find(row => row.id === id)
          if (!product) throw Error('A product is missing from the saved catalogue. Prepare online before continuing.')
          return product
        })
        if (kind === 'CREATE') {
          body = { customer: draft.body.customer, items, pricingMode: privileged ? 'bargain' : 'selling' }
          if (privileged && draft.agreedInr) { const amount = rupeesToPaise(draft.agreedInr, true); if (amount == null) throw Error('Enter a positive customer-agreed amount with at most two decimals.'); body.acceptedAmountPaise = amount }
        } else {
          const parsed = adjustmentPayload(draft.body.items, { privileged, discountInr: draft.discountInr ?? '' })
          if (!parsed.ok) throw Error(parsed.message)
          body = parsed.body
        }
      }
      if (kind === 'AGREEMENT') { const amount = rupeesToPaise(draft.agreedInr, true); if (amount == null) throw Error('Enter a positive customer-agreed amount with at most two decimals.'); body = { acceptedAmountPaise: amount } }
      if (kind === 'CLOSE') {
        const savedAgreement = draft.serverSnapshot?.acceptedAmountPaise > 0 || operations.some(row=>row.draftId===draft.draftId && ['pending','synced'].includes(row.state) && ['AGREEMENT','CREATE'].includes(row.payload.kind) && row.payload.body.acceptedAmountPaise > 0)
        if (!savedAgreement) throw Error('Queue a positive customer-agreed amount before finalization. An unsaved bargaining field or the reference + ₹500 cannot finalize a bill.')
        body = {}
      }
      if (kind === 'PAYMENT') {
        const parsed = paymentPayload({ entryType: payAction, amountInr: payAmount, paymentMethod: payMethod, reference: payAction === 'PAYMENT' ? payReference : '', details: payDetails, recordingMode: 'OFFLINE', occurredAt: review?.payload.kind === 'PAYMENT' ? review.payload.occurredAt : payOccurredAt || new Date().toISOString() })
        if (!parsed.ok) throw Error(parsed.message)
        body = parsed.body
      }
      if (review && review.payload.kind !== kind) throw Error(`This review must replace ${review.payload.kind}, or keep the server version instead.`)
      const operation = { kind, body, ...(snapshots ? { catalogue: snapshots } : {}),
        ...(lineSnapshots ? {lineSnapshots} : {}),
        ...(body.occurredAt ? { occurredAt: body.occurredAt } : {}),
        ...(draft.requestId ? { requestId: draft.requestId, expectedRevision: draft.expectedRevision } : {}) }
      const saved = await storage.current.saveDraft(profile.scope, draft, operation, review?.payload.operationId)
      choose(saved.draft); await reload(profile)
      setNotice(`${kind} saved to the persistent outbox. It remains provisional until the server acknowledges it.`)
      setPayAmount(''); setPayReference(''); setPayDetails(''); setPayOccurredAt('')
    } catch (reason) { if (reason.code === 'local_revision_conflict') setLocalConflict(reason); setError(reason.message) } finally { setBusy(false) }
  }
  async function sync() {
    if (syncing.current || !profileAllowed || !online) return
    syncing.current = true; setBusy(true); setError(null)
    const scope = profile.scope, scopeKey = offlineScopeKey(scope)
    try {
      await saves.current
      await storage.current.recover(scope)
      const confirmed = await fetchAdminSession()
      if (!matchingSession(confirmed, scope)) throw Error('Authentication expired or the saved user/stall is not selected. Sign in to that workspace; pending operations remain saved.')
      const updated = { ...profile, role: confirmed.effectiveRole, writable: confirmed.capabilities.write === true,
        ...(profile.handover && !['owner','super_admin'].includes(confirmed.effectiveRole) ? {handover:{...profile.handover,privateCatalogue:[]}} : {}) }
      await storage.current.activate(updated, catalogue); setProfile(updated)
      const device = await storage.current.device()
      await synchronizeOutbox({ storage: storage.current, scope, deviceToken: device.deviceToken, send: sendOfflineOperation, fetchSnapshot: fetchOfflineRequest,
        isCurrent: () => scopeRef.current && offlineScopeKey(scopeRef.current) === scopeKey,
        onChange: () => { storage.current.list('outbox', scope).then(setOperations).catch(reason => setError(reason.message)) } })
      await reload(updated)
      const current = selected.current && await storage.current.get('drafts', scope, selected.current.draftId)
      if (current) { selected.current = current; setEditor(current) }
    } catch (reason) { setError(reason.message) } finally { syncing.current = false; setBusy(false) }
  }
  // Online events and periodic retries only dispatch already-saved operations.
  useEffect(() => {
    if (!profileAllowed || !online || session.status !== 'authenticated') return
    const timer = setInterval(() => { if (!syncing.current) sync() }, 15000)
    return () => clearInterval(timer)
  })

  async function reviewConflict(row, keepServer = false) {
    setBusy(true); setError(null)
    try {
      const id = row.payload.requestId ?? row.serverSnapshot?.request.id
      let snapshot = row.serverSnapshot
      if (id && online) { const current = await fetchOfflineRequest(id); if (!current.ok) throw Error(current.message); snapshot = current }
      if (keepServer) {
        if (!snapshot && row.payload.kind !== 'CREATE') throw Error('Reconnect and load the server version before cancelling the pending chain.')
        await storage.current.acceptServer(profile.scope, row.payload.operationId, snapshot)
        const original = await storage.current.get('drafts', profile.scope, row.draftId)
        const { draft } = await storage.current.saveDraft(profile.scope, { ...original, ...(snapshot ? fromSnapshot(snapshot) : {}), draftId: original.draftId })
        choose(draft); await reload(profile); return
      }
      if (row.payload.kind === 'HANDOVER') {
        setNotice('This signed handover cannot be rebased by the receiving device. Compare the preserved QR and server version in the outbox below. Keep the server version explicitly, or ask the original creator to refresh and generate a new transfer. Dependent closures and payments remain blocked and preserved.')
        return
      }
      if (row.payload.kind !== 'CREATE' && !snapshot) throw Error('Reconnect to retrieve the competing server version.')
      const draft = await storage.current.get('drafts', profile.scope, row.draftId)
      let reviewedCatalogue = catalogue
      if (['CREATE','EDIT'].includes(row.payload.kind)) {
        if (!online) throw Error('Reconnect to compare the current catalogue with the saved offline version.')
        const fresh = await fetchOfflineCatalogue()
        if (!fresh.ok) throw Error(fresh.message)
        reviewedCatalogue = fresh.products
        await storage.current.activate(profile, reviewedCatalogue,fresh.familyPacks??[],fresh.familyPackIssues??[]); setCatalogue(reviewedCatalogue);setFamilyPacks(fresh.familyPacks??[])
      }
      const next = { ...draft, expectedRevision: snapshot?.request.revision ?? null, requestId: snapshot?.request.id ?? null, serverSnapshot: snapshot,
        body: ['CREATE','EDIT'].includes(row.payload.kind) ? { ...draft.body, ...row.payload.body, items: row.payload.body.items.map(line => {
          const original=draft.body.items.find(item=>line.familyPackId?item.familyPackId===line.familyPackId:item.productId===line.productId&&(item.unitType??'box')===(line.unitType??'box'))
          return {...line,lineId:original?.lineId,...(line.familyPackId?{familyPackSnapshot:original?.familyPackSnapshot}:{}),...(line.unitRatePaise==null?{}:{priceInr:paiseInputValue(line.unitRatePaise)})}
        }) } : draft.body,
        discountInr: paiseInputValue(row.payload.body.discountPaise), agreedInr: row.payload.body.acceptedAmountPaise == null ? draft.agreedInr : paiseInputValue(row.payload.body.acceptedAmountPaise) }
      choose(next); setReview({ ...row, serverSnapshot: snapshot, serverCatalogue: reviewedCatalogue })
      if (row.payload.kind === 'PAYMENT') { setPayAction(row.payload.body.entryType ?? 'PAYMENT'); setPayDetails(row.payload.body.details ?? ''); setPayAmount(paiseInputValue(row.payload.body.amountPaise)); setPayMethod(row.payload.body.paymentMethod ?? 'CASH'); setPayReference(row.payload.body.reference ?? '') }
      setNotice('Compare the preserved local operation and server version below. Queue the reviewed action explicitly. This replaces the conflicting operation and cancels its pending descendants; all originals remain in history.')
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }

  async function resolveLocal(useAttempted) {
    setBusy(true); setError(null)
    try {
      const current = await storage.current.get('drafts', profile.scope, localConflict.currentDraft.draftId)
      if (current.localRevision !== localConflict.currentDraft.localRevision) throw Error('The device version changed again. Reopen this saved conflict to review the latest version.')
      const attempt = localConflict.attemptedDraft
      const { draft } = await storage.current.saveDraft(profile.scope, { ...current,
        ...(useAttempted ? { body: attempt.body, agreedInr: attempt.agreedInr, discountInr: attempt.discountInr } : {}), localConflictResolution: localConflict.versionKey })
      const pendingPayment = localConflict.attemptedOperation
      if (useAttempted && pendingPayment?.kind === 'PAYMENT') { setPayAction(pendingPayment.body.entryType ?? 'PAYMENT'); setPayAmount(paiseInputValue(pendingPayment.body.amountPaise)); setPayMethod(pendingPayment.body.paymentMethod ?? 'CASH'); setPayReference(pendingPayment.body.reference ?? ''); setPayDetails(pendingPayment.body.details ?? ''); setPayOccurredAt(pendingPayment.occurredAt) }
      // Explicit resolution ends the failed save chain. No network operation is
      // queued until the user chooses an action against this reviewed draft.
      saves.current = Promise.resolve(); choose(draft); await reload(profile)
      setNotice('Device conflict resolved locally. Review and queue the intended action explicitly; earlier versions remain saved.')
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }

  const hasWorkflow = editor && review?.payload.kind !== 'CREATE' && (editor.requestId || editor.tailOperationId)
  const itemsLocked = Boolean(editor?.localClosure) || ['closed','void'].includes(editor?.serverSnapshot?.request.status)
  const closureAcknowledged = editor?.localClosure && operations.some(row => row.payload.operationId === editor.localClosure.operationId && row.state === 'synced')
  return <main className="admin-main" style={{ maxWidth: 1050, margin: '0 auto' }}>
    <h1>Offline billing workspace</h1>
    <OfflineStorageStatus revision={`${storageRevision}:${saveCount}:${operations.length}`} />
    <p role="status">{online ? 'Online' : 'Offline'} · {operations.filter(row => row.state === 'pending').length} pending · {operations.filter(row => row.state === 'syncing').length} syncing · {operations.filter(row => row.state === 'synced').length} synced · {operations.filter(row => ['failed','conflict'].includes(row.state)).length} failed / conflict</p>
    <p><Link to="/admin/context">Online workspace / sign in</Link> · <Link to="/admin/login">Sign in again</Link></p>
    <p>Local actions are provisional. The server revalidates permissions, device identity, scope, catalogue and revisions during synchronization.</p>
    {error ? <p role="alert" className="admin-alert admin-alert--error">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!ready ? <p>Opening saved workspace…</p> : null}
    <button type="button" className="admin-touch-button" disabled={!ready || busy || !storageDb || !online || session.status !== 'authenticated'} onClick={prepare}>Prepare / refresh selected stall for offline use</button>
    {!profileAllowed ? <p>Select and prepare an authorized stall online. Saved data from another user or stall is kept isolated.</p> : <>
      <p><strong>{profile.label}</strong> · {profile.email} · {profile.role} · saved {profile.confirmedAt} · {profile.scope.seasonId}</p>
      <p>Device: {profile.scope.deviceId}. QR exports contain selling snapshots only. Privileged pricing, when prepared, stays in this receiving Owner / Super Admin profile.</p>
      <OfflineHandover key={offlineScopeKey(profile.scope)} storage={storageDb} profile={profile} draft={editor} catalogue={catalogue} familyPacks={familyPacks} operations={operations}
        canAccept={privileged && writable} canPrepare={online && session.status === 'authenticated'} disabled={busy || saving || !writable || Boolean(localConflict)}
        onPrepared={next=>reload(next)} onAccepted={async draft=>{choose(draft);await reload(profile)}} />
      <button type="button" className="admin-touch-button" disabled={busy || !online} onClick={sync}>Synchronize pending operations</button>
      <label className="admin-field">Request ID to save for offline work<input className="admin-input" value={requestId} onChange={event => setRequestId(event.target.value)} /></label>
      <button type="button" className="admin-touch-button" disabled={busy || !online || !requestId.trim()} onClick={()=>download()}>Save request snapshot</button>
      <button type="button" className="admin-touch-button" disabled={busy || !online || !requestId.trim()} onClick={()=>download(true)}>Save fresh revision as separate draft</button>
      <h2>Durable drafts</h2>
      {deviceConflicts.map(version => <p key={version.key}>Saved competing local draft · {version.savedAt} <button type="button" disabled={busy} onClick={async () => {
        const currentDraft = await storage.current.get('drafts', profile.scope, version.draftId)
        choose(currentDraft); setLocalConflict({ currentDraft, attemptedDraft: version.attemptedDraft, attemptedOperation: version.attemptedOperation, versionKey: version.key })
      }}>Review device conflict</button></p>)}
      <button type="button" className="admin-touch-button" disabled={busy || saving || !writable} onClick={() => { setReview(null); persist({ draftId: crypto.randomUUID(), body: { customer: { name: '', mobile: '' }, items: [] }, agreedInr: '', discountInr: '' }) }}>New local request</button>
      <ul>{drafts.map(draft => <li key={draft.draftId}><button type="button" disabled={busy || saving} onClick={() => choose(draft)}>{draft.body.customer?.name || 'Unnamed draft'} · {draft.requestId ?? 'local'} · {draft.savedAt}</button></li>)}</ul>
      {editor ? <section className="admin-card">
        <h2>{review ? 'Resolve conflict explicitly' : 'Local request draft'}</h2>
        <p role="status">{saving ? 'Saving draft…' : 'Draft saved on this device'} · server revision {editor.expectedRevision ?? 'new'} · {editor.serverSnapshot?.request.status ?? 'local request'}</p>
        {editor.handover?<p>Request {editor.requestId} · transfer {editor.handover.transferId} · original creator {editor.handover.creatorUserId} · initiator {editor.handover.initiatorUserId} · recipient {editor.handover.recipientUserId}. Finalizer and payment recorder are retained separately in the operation history.</p>:null}
        {privileged?<OfflineFinancialSummary profile={profile} draft={editor} catalogue={catalogue} />:null}
        {editor.localClosure ? <p role="status">Closure captured on this device at {editor.localClosure.occurredAt}. {closureAcknowledged ? 'The server acknowledged this closure.' : 'It remains provisional until acknowledged.'} Later payments are retained in the same operation chain.</p> : null}
        {localConflict ? <div role="alert"><p>Another tab changed this draft. Both versions are saved. Review quantities, prices and closure before continuing.</p>
          <h3>Your attempted local version</h3><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ draft: localConflict.attemptedDraft, operation: localConflict.attemptedOperation }, null, 2)}</pre>
          <h3>Current device version</h3><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(localConflict.currentDraft, null, 2)}</pre>
          <button type="button" disabled={busy} onClick={() => resolveLocal(false)}>Keep current device version</button>
          <button type="button" disabled={busy} onClick={() => resolveLocal(true)}>Use my reviewed fields; queue changes separately</button>
        </div> : null}
        <fieldset disabled={busy || !writable || Boolean(localConflict)}>
          {!hasWorkflow ? <>
            <label className="admin-field">Customer name<input className="admin-input" value={editor.body.customer.name} onChange={event => patchBody({ customer: { ...editor.body.customer, name: event.target.value } })} /></label>
            <label className="admin-field">Mobile<input className="admin-input" value={editor.body.customer.mobile} onChange={event => patchBody({ customer: { ...editor.body.customer, mobile: event.target.value } })} /></label>
          </> : <p>{editor.body.customer.name} · {editor.body.customer.mobile}</p>}
          <fieldset disabled={itemsLocked && !review}>
          <label className="admin-field">Saved catalogue<select className="admin-input" value={selectedProduct} onChange={event => setSelectedProduct(event.target.value)}><option value="">Choose product</option>{catalogue.map(product => <option key={product.id} value={product.id}>{product.name} · {product.pack} · {formatPaymentPaise(product.selling_price_paise)}</option>)}</select></label>
          <button type="button" disabled={!selectedProduct} onClick={() => {
            const items = selected.current.body.items
            patchBody({ items: items.some(item => item.productId === selectedProduct && item.unitType === 'box') ? items.map(item => item.productId === selectedProduct && item.unitType === 'box' ? { ...item, quantity: item.quantity + 1 } : item) : [...items, { productId: selectedProduct, quantity: 1, unitType: 'box' }] })
          }}>Add product</button>
          <label className="admin-field">Saved Family Pack / variant<select className="admin-input" value={selectedPack} onChange={event=>setSelectedPack(event.target.value)}><option value="">Choose Family Pack</option>{familyPacks.map(pack=><option key={pack.familyPackId} value={pack.familyPackId}>{pack.name} · {pack.variant.label} · {pack.variant.slug} · {formatPaymentPaise(pack.sellingUnitPaise)}</option>)}</select></label>
          <button type="button" disabled={!familyPacks.some(pack=>pack.familyPackId===selectedPack)} onClick={()=>{
            const pack=familyPacks.find(pack=>pack.familyPackId===selectedPack),items=selected.current.body.items
            patchBody({items:items.some(item=>item.familyPackId===selectedPack)?items.map(item=>item.familyPackId===selectedPack?{...item,quantity:item.quantity+1}:item):[...items,{lineId:crypto.randomUUID(),familyPackId:pack.familyPackId,quantity:1,unitType:'box',familyPackSnapshot:structuredClone(pack)}]})
          }}>Add Family Pack with captured snapshot</button>
          {packIssues.map(issue=><p role="status" key={issue.familyPackId}>{issue.familyPackId}: {issue.message} It cannot be added from this preparation.</p>)}
          {editor.body.items.map((item, index) => <div className="admin-card" key={`${item.familyPackId??item.productId}:${index}`}>
            {item.familyPackId?<FamilyPackSnapshotPreview pack={item.familyPackSnapshot} quantity={item.quantity} />:<p>{catalogue.find(row => row.id === item.productId)?.name ?? item.productId}</p>}
            <label>Quantity <input type="number" min="1" max="99" value={item.quantity} onChange={event => patchBody({ items: editor.body.items.map((line, i) => i === index ? { ...line, quantity: Number(event.target.value) } : line) })} /></label>
            {!item.familyPackId?<label>Unit <select value={item.unitType} onChange={event => patchBody({ items: editor.body.items.map((line, i) => i === index ? { ...line, unitType: event.target.value } : line) })}><option value="box">Box / pack</option><option value="piece">Loose piece</option></select></label>:<p>Whole Family Packs; component quantities and units stay as captured.</p>}
            {privileged && hasWorkflow && !item.familyPackId ? <label>Selling price override (₹)<input inputMode="decimal" value={item.priceInr ?? ''} onChange={event => patchBody({ items: editor.body.items.map((line, i) => i === index ? { ...line, priceInr: event.target.value } : line) })} /></label> : null}
            <button type="button" onClick={() => patchBody({ items: editor.body.items.filter((_, i) => i !== index) })}>Remove product</button>
          </div>)}
          {privileged ? <>
            <label className="admin-field">Customer-agreed amount (₹)<input className="admin-input" inputMode="decimal" value={editor.agreedInr ?? ''} onChange={event => patch({ agreedInr: event.target.value })} /></label>
            {hasWorkflow ? <label className="admin-field">Discount for next item adjustment (₹)<input className="admin-input" inputMode="decimal" value={editor.discountInr ?? ''} onChange={event => patch({ discountInr: event.target.value })} /></label> : null}
          </> : null}
          <button type="button" className="admin-touch-button" disabled={saving} onClick={() => queue(hasWorkflow ? 'EDIT' : 'CREATE')}>{hasWorkflow ? 'Queue item adjustments' : 'Queue request creation'}</button>
          </fieldset>
          {privileged && hasWorkflow ? <>
            <button type="button" className="admin-touch-button" disabled={saving || Boolean(editor.localClosure) && !review} onClick={() => queue('AGREEMENT')}>Queue agreed amount</button>
            <button type="button" className="admin-touch-button" disabled={saving || Boolean(editor.localClosure) && !review} onClick={() => queue('CLOSE')}>Queue closure</button>
            <p>Closure uses the saved agreed amount and remains provisional until synchronization. Queue a positive agreed amount before closure; editing the field alone does not save an agreement.</p>
            <h3>Capture offline payment</h3>
            <p>Record only money actually received. Payments synchronize after the request is finalized.</p>
            <label className="admin-field">Ledger action<select className="admin-input" value={payAction} onChange={event => setPayAction(event.target.value)}><option value="PAYMENT">Payment received</option><option value="HOLD">Place payment hold</option><option value="RELEASE_HOLD">Release payment hold</option></select></label>
            <label className="admin-field">Received amount (₹)<input className="admin-input" inputMode="decimal" value={payAmount} onChange={event => setPayAmount(event.target.value)} /></label>
            <label className="admin-field">Method<select className="admin-input" value={payMethod} onChange={event => setPayMethod(event.target.value)}>{PAYMENT_METHOD_OPTIONS.map(method => <option key={method}>{method}</option>)}</select></label>
            <label className="admin-field">Transaction reference<input className="admin-input" value={payReference} onChange={event => setPayReference(event.target.value)} /></label>
            <label className="admin-field">Payment details / hold reason<textarea className="admin-input" maxLength={500} value={payDetails} onChange={event => setPayDetails(event.target.value)} /></label>
            <button type="button" className="admin-touch-button" onClick={() => queue('PAYMENT')}>Save payment to outbox</button>
          </> : null}
        </fieldset>
        {review ? <><h3>Preserved local operation</h3><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(review.payload, null, 2)}</pre><h3>Competing server version</h3><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(review.serverSnapshot, null, 2)}</pre><h3>Current catalogue for these products</h3><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(review.serverCatalogue?.filter(row => review.payload.catalogue?.some(original => original.id === row.id)), null, 2)}</pre></> : null}
      </section> : null}
      <h2>Persistent outbox and acknowledgements</h2>
      <p>Failed chains stay saved. Retrying sends the same operation ID and input. Conflict resolution never changes an earlier queued operation.</p>
      <ol>{operations.map(row => <li className="admin-card" key={row.payload.operationId}>
        <strong>{row.payload.kind} · {row.state}</strong><p>{row.payload.operationId} · attempts {row.attempts} · occurred {row.payload.occurredAt}</p>
        {row.payload.parentOperationId ? <p>Depends on {row.payload.parentOperationId}</p> : null}
        {row.acknowledgement ? <p>Server acknowledged {row.acknowledgement.receivedAt} · request {row.acknowledgement.requestId} · revision {row.acknowledgement.revision}</p> : null}
        {row.lastError ? <p role="status">{row.lastError.message}</p> : null}
        {row.payload.kind==='HANDOVER' && ['failed','conflict'].includes(row.state)?<details><summary>Compare preserved handover and server version</summary>
          <h3>Signed source handover</h3><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(row.payload.body.transfer,null,2)}</pre>
          <h3>Server version at conflict</h3><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(row.serverSnapshot,null,2)}</pre>
          <p>A receiving device cannot change a signed source revision. Keep the server version explicitly or obtain a refreshed transfer from its original creator. Pending dependent operations stay preserved until you resolve them.</p>
        </details>:null}
        {row.state === 'failed' ? <button type="button" disabled={busy} onClick={async () => { await storage.current.updateOperation(profile.scope, row.payload.operationId, { state: 'pending', nextAttemptAt: 0 }); await reload(profile) }}>Retry unchanged operation after fixing access / validation</button> : null}
        {row.state === 'conflict' || row.state === 'failed' && [400,428].includes(row.lastError?.status) ? <>
          <button type="button" disabled={busy} onClick={() => reviewConflict(row)}>Review local and server versions</button>
          <button type="button" disabled={busy || !online} onClick={() => reviewConflict(row, true)}>{row.payload.kind === 'CREATE' ? 'Archive failed creation' : 'Keep server version'} and cancel pending descendants, including payment captures</button>
        </> : null}
      </li>)}</ol>
    </>}
  </main>
}
