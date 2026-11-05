import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {useAdminSession} from '../context/AdminSessionContext.jsx'
import {fetchAdminSession} from '../api/adminApi.js'
import {registerOfflineDevice,fetchOfflineCatalogue,prepareOfflineAuthorization,fetchOfflineRequest,sendOfflineOperation} from '../api/adminOffline.js'
import {openOfflineStorage} from '../offline/storage.js'
import {prepareSignedBilling,openSignedRequest,synchronizeSignedDraft} from '../offline/signedBilling.js'
import {rupeesToPaise} from '../lib/billAdjustment.js'
import {grantStatus} from '../../shared/offlineGrant.js'
import {finalPricePreview} from '../offline/finalPricePreview.js'

const api={session:fetchAdminSession,register:registerOfflineDevice,catalogue:fetchOfflineCatalogue,authorization:prepareOfflineAuthorization,snapshot:fetchOfflineRequest,send:sendOfflineOperation}
export default function SignedBillFinalization({requestId,onAcknowledged}){
  const session=useAdminSession()
  const [workspace,setWorkspace]=useState(null),[amount,setAmount]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [pending,setPending]=useState(false),[confirm,setConfirm]=useState(false)
  const [clock,setClock]=useState(Date.now)
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer)},[])
  const storage=useRef(null),lock=useRef(false),current=useRef(null)
  const identity=JSON.stringify([session.contextKey,session.userId,session.activeBusinessId,session.activeLocationId,session.activeSeasonId,requestId])
  useLayoutEffect(()=>{current.current=identity;return()=>{current.current=null}},[identity])
  useEffect(()=>()=>{storage.current?.close();storage.current=null},[])
  const active=workspace?.identity===identity?workspace:null
  if(session.permissionRole!=='admin'||!session.locationModeEnabled)return null
  async function run(work){
    if(lock.current)return
    lock.current=true;setBusy(true);setError('');setNotice('')
    const captured=identity
    try{await work(()=>current.current===captured)}catch(reason){if(current.current===captured)setError(reason.message)}finally{lock.current=false;setBusy(false)}
  }
  async function prepare(isCurrent){
    setWorkspace(null);setConfirm(false)
    storage.current??=await openOfflineStorage()
    const profile=await prepareSignedBilling(storage.current,api)
    const snapshot=await api.snapshot(requestId)
    if(!snapshot.ok)throw Error(snapshot.message)
    const draft=await openSignedRequest(storage.current,profile,snapshot)
    if(!isCurrent())return
    const catalogue=await storage.current.get('catalogues',profile.scope,'catalogue')
    if(!isCurrent())return
    setWorkspace({identity,profile,draft,snapshot,products:catalogue.products});setAmount(draft.agreedInr);setPending(false);setConfirm(false)
    setNotice('Signed authorization and current bill revision prepared. Amount changes remain local until acknowledged by the server.')
  }
  async function synchronize(isCurrent,next){
    await synchronizeSignedDraft(storage.current,next.profile.scope,next.draft.draftId,api,isCurrent)
    const rows=(await storage.current.list('outbox',next.profile.scope)).filter(row=>row.draftId===next.draft.draftId)
    const outstanding=rows.find(row=>!['synced','resolved','discarded'].includes(row.state))
    const draft=await storage.current.get('drafts',next.profile.scope,next.draft.draftId)
    if(!isCurrent())return
    setPending(Boolean(outstanding));setWorkspace({...next,draft})
    if(outstanding)throw Error(`${outstanding.lastError?.message??'Awaiting synchronization.'} Original signed action retained. Retry synchronization or review it in Offline Billing; do not enter it again.`)
    const snapshot=await api.snapshot(requestId)
    if(!isCurrent())return
    if(snapshot.ok)setWorkspace({...next,draft,snapshot})
    setNotice('Server acknowledged the signed action. Original operation ID, revision and audit are retained.')
    await onAcknowledged?.()
  }
  async function save(kind,isCurrent){
    if(!active||pending)throw Error('Prepare authorization or synchronize the retained action first.')
    const denied=grantStatus(active.profile.authorization,active.profile.scope,Date.now(),true)
    if(denied)throw Error(denied)
    const paise=rupeesToPaise(amount,true)
    if(paise==null)throw Error('Enter a positive agreed amount with at most two decimals.')
    if(kind==='CLOSE'&&(active.snapshot.acceptedAmountPaise!==paise||!active.draft.body.items.length))throw Error('Save this agreed amount and complete the bill items before finalizing.')
    const saved=await storage.current.saveDraft(active.profile.scope,{...active.draft,agreedInr:amount},{kind,body:kind==='AGREEMENT'?{acceptedAmountPaise:paise}:{},requestId,expectedRevision:active.draft.lastAcknowledgement?.revision??active.draft.expectedRevision})
    const next={...active,draft:saved.draft}
    if(isCurrent()){setWorkspace(next);setPending(true);setConfirm(false);setNotice('Signed action saved locally; awaiting server acknowledgement.')}
    await synchronize(isCurrent,next)
  }
  const closed=active?.snapshot.request.status==='closed'||Boolean(active?.draft.localClosure)
  const finalPrices=active&&!grantStatus(active.profile.authorization,active.profile.scope,clock)?finalPricePreview(active.draft.body.items,active.products,active.profile.authorization.finalPrices):null
  const money=value=>value===null?'Unavailable':`₹${(value/100).toFixed(2)}`
  return <section className="admin-panel" aria-label="Signed Billing Finalization">
    <h3>Billing Finalization</h3>
    <p>Use your device-bound grant to save or edit the customer-agreed final amount and finalize the complete bill. Payment collection remains Owner / Super Admin only.</p>
    {error?<p role="alert" className="admin-field-error">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
    <button type="button" className="admin-link-button" disabled={busy||Boolean(active&&pending)||session.seasonSwitching||session.capabilities?.write!==true} onClick={()=>run(prepare)}>Prepare signed billing</button>
    {active?<>
      <p>Grantor: {active.profile.authorization.grant.claims.ownerUserId} · Admin: {active.profile.scope.userId} · Expires {new Date(active.profile.authorization.grant.claims.expiresAt).toLocaleString()}</p>
      {finalPrices?<><ul>{finalPrices.lines.map((line,index)=><li key={index}>{line.name}: Final Price / {line.unitType==='piece'?'piece':'box'} {money(line.unit)} × {line.quantity} = {money(line.total)}</li>)}</ul><p>Selected items Final Price sum: {money(finalPrices.total)}</p></>:<p>Signed price authorization expired. Refresh online before creating another financial action.</p>}
      <label className="admin-field">Customer-agreed final amount (₹)<input className="admin-input" inputMode="decimal" value={amount} disabled={busy||pending||closed} onChange={event=>{setAmount(event.target.value);setConfirm(false)}} /></label>
      {!closed?<><button type="button" disabled={busy||pending} onClick={()=>run(isCurrent=>save('AGREEMENT',isCurrent))}>Save agreed amount</button>
        <button type="button" disabled={busy||pending} onClick={()=>setConfirm(true)}>Finalize bill</button>
        {confirm?<div role="group" aria-label="Confirm bill finalization"><p>Finalize this bill with the saved agreement? This locks bill items and amounts.</p><button type="button" disabled={busy||pending} onClick={()=>run(isCurrent=>save('CLOSE',isCurrent))}>Confirm finalization</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Keep editing</button></div>:null}</>:<p>{pending?'Provisional finalization saved on this device.':'Bill finalized; amounts and items are locked.'}</p>}
      {pending?<button type="button" disabled={busy} onClick={()=>run(isCurrent=>synchronize(isCurrent,active))}>Retry signed synchronization</button>:null}
    </>:null}
    <Link to={`/admin/offline?requestId=${encodeURIComponent(requestId)}`}>Open Offline Billing for offline work or recovery</Link>
  </section>
}
