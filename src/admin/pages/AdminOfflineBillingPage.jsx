import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { fetchAdminSession } from '../api/adminApi.js'
import { fetchOfflineCatalogue, fetchOfflineRequest, registerOfflineDevice, sendOfflineOperation, prepareOfflineAuthorization } from '../api/adminOffline.js'
import { openOfflineStorage, offlineScopeKey } from '../offline/storage.js'
import { synchronizeOutbox } from '../offline/synchronize.js'
import { prepareOfflineAppShell, offlineAppShellReady } from '../offline/appShell.js'
import { readStorageHealth } from '../offline/storageHealth.js'
import { sellingLines,assertCompleteFamilyDraft } from '../offline/handover.js'
import { validateOfflineItems } from '../offline/offlineCart.js'
import { transferProductIds } from '../../shared/familyPackSnapshot.js'
import { adjustmentPayload, paiseInputValue, rupeesToPaise } from '../lib/billAdjustment.js'
import { paymentPayload } from '../lib/payments.js'
import OfflinePosWorkspace from '../components/OfflinePosWorkspace.jsx'
import { downloadProductPhotos } from '../offline/productPhotos.js'
import { grantStatus, verifyOfflineGrant } from '../../shared/offlineGrant.js'
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
  const [familyPacks,setFamilyPacks]=useState([]),[packIssues,setPackIssues]=useState([])
  const [productImages, setProductImages] = useState({})
  const [editor, setEditor] = useState(null), [online, setOnline] = useState(() => navigator.onLine)
  const [localConflict, setLocalConflict] = useState(null), [deviceConflicts, setDeviceConflicts] = useState([])
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [saveCount, setSaveCount] = useState(0)
  const [storageDb, setStorageDb] = useState(null)
  const [storageRevision, setStorageRevision] = useState(0)
  const [shellReady, setShellReady] = useState(null)
  const [syncProgress, setSyncProgress] = useState(null)
  const [verifiedGrant,setVerifiedGrant] = useState(null), [grantClock,setGrantClock] = useState(Date.now)
  const [error, setError] = useState(null), [notice, setNotice] = useState(null), [requestId, setRequestId] = useState(params.get('requestId') ?? '')
  const [review, setReview] = useState(null)
  const [retainedPayment,setRetainedPayment]=useState(null)
  const [payAmount, setPayAmount] = useState(''), [payMethod, setPayMethod] = useState('CASH'), [payReference, setPayReference] = useState('')
  const [payAction, setPayAction] = useState('PAYMENT'), [payDetails, setPayDetails] = useState('')
  const [payOccurredAt, setPayOccurredAt] = useState('')
  const storage = useRef(null), selected = useRef(null), saves = useRef(Promise.resolve()), syncing = useRef(false), scopeRef = useRef(null)
  const localVersions = useRef(new Map())
  const queueing = useRef(false)
  const selectionAttempt = useRef(null)
  const profileAllowed = profile && !profile.authorityRevoked && session.errorCode !== 'offline_authority_unavailable' && (session.status !== 'authenticated' || session.userId === profile.scope.userId && session.activeBusinessId === profile.scope.businessId && session.activeLocationId === profile.scope.locationId && session.activeSeasonId === profile.scope.seasonId)
  const privileged = ['owner','super_admin'].includes(session.status === 'authenticated' ? session.permissionRole : profile?.role)
  const writable = profile?.writable && (session.status !== 'authenticated' || session.capabilities.write === true)
  const grantViewAllowed = profileAllowed && profile?.role === 'admin' && verifiedGrant === profile.authorization && !grantStatus(profile.authorization,profile.scope,grantClock)
  const canFinalize = privileged || grantViewAllowed && !grantStatus(profile.authorization,profile.scope,grantClock,true)
  useEffect(() => {
    let cancelled=false
    if (profile?.authorization && profile.role==='admin' && profileAllowed) verifyOfflineGrant(profile.authorization,profile.scope).then(()=>{if(!cancelled)setVerifiedGrant(profile.authorization)}).catch(()=>{})
    return ()=>{cancelled=true}
  },[profile,profileAllowed])
  useEffect(()=>{const timer=setInterval(()=>setGrantClock(Date.now()),15000);return()=>clearInterval(timer)},[])
  const saving = saveCount > 0
  const canPrepare = ready && !busy && !saving && Boolean(storageDb) && online && session.status === 'authenticated' &&
    !session.seasonSwitching && session.locationModeEnabled && !session.locationSelectionRequired &&
    Boolean(session.userId && session.activeBusinessId && session.activeLocationId && session.activeSeasonId)
  useEffect(() => { scopeRef.current = profileAllowed ? profile?.scope : null }, [profileAllowed, profile])

  // Only the offline route automatically selects an unambiguous authorized
  // context. Selection is still verified by the normal session endpoint.
  useEffect(() => {
    if (!online || session.status !== 'authenticated' || !session.locationModeEnabled || session.seasonSwitching || session.activeLocationId) return
    const choices = session.authorizedLocations ?? []
    const candidates = choices.filter(row => row.operatingSeason.id === session.activeSeasonId)
    const target = candidates.length === 1 ? candidates[0] : !session.activeSeasonId && choices.length === 1 ? choices[0] : null
    if (!target) return
    const key = `${session.userId}:${target.operatingSeason.id}:${target.location.id}`
    if (selectionAttempt.current === key) return
    selectionAttempt.current = key
    const select = target.operatingSeason.id === session.activeSeasonId
      ? session.selectActiveLocation(target.location.id) : session.selectActiveSeason(target.operatingSeason.id)
    select.then(result => { if (!result.ok) setError(result.message) }).catch(reason => setError(reason.message))
  }, [online, session])

  async function reload(currentProfile) {
    const requested = currentProfile ?? await storage.current.activeProfile()
    const active = requested && await storage.current.get('profiles',requested.scope,'profile')
    if (!active) { setReady(true); return }
    const [cached, localDrafts, rows, versions] = await Promise.all([storage.current.get('catalogues', active.scope, 'catalogue'), storage.current.list('drafts', active.scope), storage.current.list('outbox', active.scope), storage.current.list('versions', active.scope)])
    const resolved = new Set(versions.map(version => version.resolvesLocalVersion).filter(Boolean))
    setDeviceConflicts(versions.filter(version => version.conflict && !resolved.has(version.key)))
    setProductImages(cached?.productImages ?? {})
    setProfile(active); setCatalogue(cached?.products ?? []);setFamilyPacks(cached?.familyPacks??[]);setPackIssues(cached?.familyPackIssues??[]); setDrafts(localDrafts); setOperations(rows.sort((a, b) => a.order - b.order)); setReady(true)
  }
  useEffect(() => {
    let cancelled = false, ownedDb = null
    const checkShell=()=>offlineAppShellReady().then(value => { if (!cancelled) setShellReady(value) })
    checkShell()
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
    window.addEventListener('focus',checkShell);navigator.serviceWorker?.addEventListener('controllerchange',checkShell)
    window.addEventListener('diwali-offline-authority-changed', authorityChanged)
    return () => { cancelled = true; window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('focus',checkShell);navigator.serviceWorker?.removeEventListener('controllerchange',checkShell);window.removeEventListener('diwali-offline-authority-changed', authorityChanged); saves.current.then(() => ownedDb?.close(), () => ownedDb?.close()) }
  }, [])

  function choose(draft) { selected.current = draft; if (draft) localVersions.current.set(draft.draftId, draft.localRevision); saves.current = saves.current.catch(() => {}); setEditor(draft); setReview(null); setLocalConflict(null); setNotice(null); setRetainedPayment(null); setPayAmount(''); setPayReference(''); setPayDetails(''); setPayOccurredAt(''); setPayAction('PAYMENT'); setPayMethod('CASH') }
  // Reuse this exact user's previously prepared stall without registration or
  // catalogue downloads. Never restore another user's or another stall's work.
  useEffect(() => {
    if (!ready || !storageDb || busy || saving || session.status !== 'authenticated' || session.seasonSwitching || !session.activeLocationId || !session.activeSeasonId) return
    if (profile && matchingSession({ ...session, ok: true }, profile.scope)) return
    let cancelled = false
    ;(async () => {
      const device = await storageDb.device()
      const scope = { businessId: session.activeBusinessId, locationId: session.activeLocationId, seasonId: session.activeSeasonId, userId: session.userId, deviceId: device.deviceId }
      const saved = await storageDb.get('profiles', scope, 'profile')
      const cached = await storageDb.get('catalogues', scope, 'catalogue')
      if (cancelled || !saved || saved.authorityRevoked || !cached) return
      await storageDb.activate(saved, cached.products)
      if (!cancelled) { choose(null); await reload(saved) }
    })().catch(reason => { if (!cancelled) setError(reason.message) })
    return () => { cancelled = true }
  }, [ready, storageDb, busy, saving, session, profile])

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
    if (!canPrepare) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const confirmed = await fetchAdminSession()
      if (!confirmed.ok || !confirmed.locationModeEnabled || !confirmed.activeLocationId) throw Error('Sign in and select an authorized stall in the online workspace first.')
      if (!matchingSession(confirmed, { userId: session.userId, businessId: session.activeBusinessId, locationId: session.activeLocationId, seasonId: session.activeSeasonId })) throw Error('The active stall changed. Select and confirm the stall before preparing it.')
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
      const photos = await downloadProductPhotos(snapshot.productImages)
      const rechecked = await fetchAdminSession()
      if (!matchingSession(rechecked, scope)) throw Error('The active stall changed during preparation. Try again.')
      const prepared = { ...next, role: rechecked.effectiveRole, writable: rechecked.capabilities.write === true }
      // Refresh does not discard the current customer's editor or QR setup.
      const previous = await storage.current.get('profiles', scope, 'profile')
      if (previous?.authorization && prepared.role==='admin' && !previous.authorityRevoked) prepared.authorization=previous.authorization
      if (previous?.handover && !previous.authorityRevoked && previous.role === prepared.role) {
        prepared.handover = previous.handover
        if (!['owner','super_admin'].includes(prepared.role)) prepared.handover = { ...prepared.handover, privateCatalogue: [] }
      }
      await storage.current.activate(prepared, snapshot.products, snapshot.familyPacks??[], snapshot.familyPackIssues??[], photos)
      let authorizationNotice=''
      if(prepared.role==='admin'){
        try{
          const identity=await storage.current.signingIdentity(scope)
          const result=await prepareOfflineAuthorization({deviceId:device.deviceId,deviceToken:device.deviceToken,publicKey:identity.publicKey})
          if(result.ok)await storage.current.saveAuthorization(scope,result.authorization)
          else authorizationNotice=' Optional Owner authorization was not refreshed: '+result.message
        }catch(reason){authorizationNotice=' Optional Owner authorization was not refreshed: '+reason.message}
      }
      if (!profile || offlineScopeKey(profile.scope) !== offlineScopeKey(scope)) choose(null)
      await reload(prepared)
      const { persistent } = await readStorageHealth(navigator.storage, true)
      setStorageRevision(value => value + 1)
      let shell
      try { await prepareOfflineAppShell(); setShellReady(true); shell = 'Offline billing ready. Offline page reload is ready.' }
      catch (reason) { setShellReady(false); shell = `Catalogue prepared. Keep this page open; offline page reload is not confirmed: ${reason.message}` }
      setNotice(`Workspace saved. ${persistent ? 'Persistent browser storage granted.' : 'Browser storage remains subject to browser eviction.'} ${shell}${authorizationNotice}`)
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
    if (queueing.current) return null
    queueing.current = true
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
        validateOfflineItems(draft.body.items, catalogue)
        lineSnapshots=sellingLines(draft.body.items,catalogue,draft.draftId)
        snapshots = transferProductIds(lineSnapshots).map(id => {
          const product = catalogue.find(row => row.id === id)
          if (!product) throw Error('A product is missing from the saved catalogue. Prepare online before continuing.')
          return product
        })
        if (kind === 'CREATE') {
          // An Owner may save an unagreed request too. Bargain mode requires a
          // captured agreement; otherwise use the existing selling workflow.
          body = { customer: draft.body.customer, items, pricingMode: privileged && draft.agreedInr ? 'bargain' : 'selling' }
          if (privileged && draft.agreedInr) { const amount = rupeesToPaise(draft.agreedInr, true); if (amount == null) throw Error('Enter a positive customer-agreed amount with at most two decimals.'); body.acceptedAmountPaise = amount }
        } else {
          const parsed = adjustmentPayload(draft.body.items, { privileged, discountInr: draft.discountInr ?? '' })
          if (!parsed.ok) throw Error(parsed.message)
          body = parsed.body
        }
      }
      if (kind === 'AGREEMENT') { const amount = rupeesToPaise(draft.agreedInr, true); if (amount == null) throw Error('Enter a positive customer-agreed amount with at most two decimals.'); body = { acceptedAmountPaise: amount } }
      if (['AGREEMENT','CLOSE'].includes(kind) && !canFinalize) throw Error('A valid Owner-issued grant is required to save agreements or finalize on this Admin device.')
      if (kind === 'CLOSE') {
        const savedAgreement = draft.serverSnapshot?.acceptedAmountPaise > 0 || operations.some(row=>row.draftId===draft.draftId && ['pending','synced'].includes(row.state) && ['AGREEMENT','CREATE'].includes(row.payload.kind) && row.payload.body.acceptedAmountPaise > 0)
        if (!savedAgreement) throw Error('Queue a positive customer-agreed amount before finalization. An unsaved bargaining field cannot finalize a bill.')
        body = {}
      }
      if (kind === 'PAYMENT') {
        const parsed = paymentPayload({ entryType: payAction, amountInr: payAmount, paymentMethod: payMethod, reference: payAction === 'PAYMENT' ? payReference : '', details: payDetails, recordingMode: 'OFFLINE', occurredAt: review?.payload.kind === 'PAYMENT' ? review.payload.occurredAt : payOccurredAt || new Date().toISOString() })
        if (!parsed.ok) throw Error(parsed.message)
        body = parsed.body
      }
      if (review && review.payload.kind !== kind) throw Error(`This review must replace ${review.payload.kind}, or keep the server version instead.`)
      const operation = { kind, body, ...(snapshots ? { catalogue: snapshots } : {}),
        ...(kind==='PAYMENT'&&retainedPayment?{resolutionOf:retainedPayment.payload.operationId}:{}),
        ...(lineSnapshots ? {lineSnapshots} : {}),
        ...(body.occurredAt ? { occurredAt: body.occurredAt } : {}),
        ...(draft.requestId ? { requestId: draft.requestId, expectedRevision: draft.expectedRevision } : {}) }
      const saved = await storage.current.saveDraft(profile.scope, draft, operation, review?.payload.operationId)
      choose(saved.draft); await reload(profile)
      const label = { CREATE: 'Bill', EDIT: 'Item changes', AGREEMENT: 'Agreed amount', CLOSE: 'Finalization', PAYMENT: 'Payment / hold action' }[kind] ?? kind
      setNotice(`${label} saved on this device. Waiting for server acknowledgement.`)
      setPayAmount(''); setPayReference(''); setPayDetails(''); setPayOccurredAt('')
      return saved.draft
    } catch (reason) { if (reason.code === 'local_revision_conflict') setLocalConflict(reason); setError(reason.message); return null } finally { queueing.current = false; setBusy(false) }
  }
  async function sync() {
    if (syncing.current || !profileAllowed || !online || session.seasonSwitching) return
    syncing.current = true; setBusy(true); setError(null); setNotice(null); setSyncProgress({ running: true, acknowledged: operations.filter(row => row.state === 'synced').length })
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
        onChange: () => { storage.current.list('outbox', scope).then(rows => {
          if (!scopeRef.current || offlineScopeKey(scopeRef.current) !== scopeKey) return
          setOperations(rows)
          setSyncProgress({ running: true, acknowledged: rows.filter(row => row.state === 'synced').length })
        }).catch(reason => setError(reason.message)) } })
      if (!scopeRef.current || offlineScopeKey(scopeRef.current) !== scopeKey) return
      // Refresh every acknowledged bill, including bills saved before the
      // operator started the next customer. A stale snapshot must stay visible.
      const acknowledgedDrafts = await storage.current.list('drafts', scope)
      // Read the acknowledged bill for its reference and authoritative payment summary.
      // Never replace local item input or mutate an already queued operation.
      for (const draft of acknowledgedDrafts) {
        if (!draft.requestId || !(draft.lastAcknowledgement?.revision > (draft.serverSnapshot?.request.revision ?? -1))) continue
        const snapshot = await fetchOfflineRequest(draft.requestId)
        if (!scopeRef.current || offlineScopeKey(scopeRef.current) !== scopeKey) return
        if (snapshot.ok) {
          const saved = await storage.current.saveDraft(scope, { ...draft, serverSnapshot: snapshot, expectedRevision: snapshot.request.revision })
          localVersions.current.set(saved.draft.draftId, saved.draft.localRevision)
        } else setError('Actions were acknowledged, but bill details could not refresh. Synchronize again to verify balances. ' + snapshot.message)
      }
      const current = selected.current && await storage.current.get('drafts', scope, selected.current.draftId)
      await reload(updated)
      if (current && selected.current?.draftId === current.draftId) { selected.current = current; setEditor(current) }
      const rows = await storage.current.list('outbox', scope)
      const remaining = rows.filter(row => ['pending','syncing','failed','conflict'].includes(row.state)).length
      setNotice(remaining ? `${remaining} actions remain on this device. Check pending bills and actions needing attention.` : 'All queued actions acknowledged. Check each bill for its server reference and balance.')
    } catch (reason) { setError(reason.message) } finally { syncing.current = false; setBusy(false); setSyncProgress(value => value && { ...value, running: false }) }
  }

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
  async function retry(row) {
    try {
      await storage.current.updateOperation(profile.scope, row.payload.operationId, { state: 'pending', nextAttemptAt: 0 })
      await reload(profile)
    } catch (reason) { setError(reason.message) }
  }
  async function reviewRetainedPayment(row){
    setError(null)
    try{
      await saves.current
      const draft=selected.current
      if(!privileged||!writable||review||localConflict||!draft?.requestId||draft.requestId!==row.payload.requestId||!(draft.localClosure||draft.serverSnapshot?.request.status==='closed'))throw Error('Open the reviewed, finalized replacement bill first, then return here to review its retained capture.')
      if(row.state!=='discarded'||row.attempts!==0||row.recoveredBy||row.payload.kind!=='PAYMENT'||row.payload.body.entryType!=='PAYMENT')throw Error('This payment cannot be automatically recovered. Reconcile its original receipt first.')
      setRetainedPayment(row);setPayAction('PAYMENT');setPayAmount(paiseInputValue(row.payload.body.amountPaise));setPayMethod(row.payload.body.paymentMethod);setPayReference(row.payload.body.reference??'');setPayDetails(row.payload.body.details??'');setPayOccurredAt(row.payload.occurredAt)
      setNotice(`Review the never-sent payment captured ${new Date(row.payload.occurredAt).toLocaleString()}. Save recovered payment links this original capture to the selected bill. Do not collect the money again.`)
      return true
    }catch(reason){setError(reason.message);return false}
  }
  async function openDeviceConflict(version) {
    try {
      const currentDraft = await storage.current.get('drafts', profile.scope, version.draftId)
      choose(currentDraft)
      setLocalConflict({ currentDraft, attemptedDraft: version.attemptedDraft, attemptedOperation: version.attemptedOperation, versionKey: version.key })
    } catch (reason) { setError(reason.message) }
  }
  return <OfflinePosWorkspace
    {...{ session, profile, profileAllowed, catalogue, productImages, familyPacks, packIssues, drafts, operations, editor, online, ready, busy, saving,
      storageDb, storageRevision, shellReady, syncProgress, saveCount, canPrepare, privileged, canFinalize, grantViewAllowed, writable, error, notice, localConflict, deviceConflicts, review,
      hasWorkflow, itemsLocked, closureAcknowledged, requestId, setRequestId }}
    payment={{ amount: payAmount, setAmount: setPayAmount, method: payMethod, setMethod: setPayMethod,
      recovery:retainedPayment,
      reference: payReference, setReference: setPayReference, action: payAction, setAction: setPayAction, details: payDetails, setDetails: setPayDetails }}
    actions={{ prepare, sync, download, queue, choose, patch, patchBody, resolveLocal, reviewConflict, retry, openDeviceConflict, reload, reviewRetainedPayment,
      newDraft: () => { choose(null); persist({ draftId: crypto.randomUUID(), body: { customer: { name: '', mobile: '' }, items: [] }, agreedInr: '', discountInr: '' }) },
      acceptHandover: async draft => { choose(draft); await reload(profile) } }}
  />
}
