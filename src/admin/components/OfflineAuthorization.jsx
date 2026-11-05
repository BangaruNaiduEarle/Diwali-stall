import { useEffect, useRef, useState } from 'react'
import { prepareOfflineAuthorization, fetchOfflineAuthorizations, issueOfflineAuthorization, revokeOfflineAuthorization } from '../api/adminOffline.js'
import { grantStatus } from '../../shared/offlineGrant.js'

export default function OfflineAuthorization({ storage,profile,online,authenticated,disabled,onPrepared }) {
  const [devices,setDevices] = useState([]), [grants,setGrants] = useState([]), [target,setTarget] = useState('')
  const [canFinalize,setCanFinalize] = useState(false), [hours,setHours] = useState('8')
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('')
  const [clock,setClock]=useState(Date.now)
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer)},[])
  const issuing = useRef(null), running = useRef(false)
  const owner = profile.role === 'owner', available = online && authenticated && !disabled && !busy
  async function run(work) {
    if (running.current) return
    running.current=true; setBusy(true);setError('');setNotice('')
    try { await work() } catch(reason) {setError(reason.message)} finally {running.current=false;setBusy(false)}
  }
  async function list() {
    const result=await fetchOfflineAuthorizations()
    if (!result.ok) throw Error(result.message)
    setDevices(result.devices);setGrants(result.grants)
  }
  async function refresh() {
    const device=await storage.device(), identity=await storage.signingIdentity(profile.scope)
    const result=await prepareOfflineAuthorization({deviceId:device.deviceId,deviceToken:device.deviceToken,publicKey:identity.publicKey})
    if (!result.ok) throw Error(result.message)
    const next=await storage.saveAuthorization(profile.scope,result.authorization)
    await onPrepared(next)
    setNotice(result.authorization ? 'Signed Owner authorization verified and saved for this device. Payments remain Owner / Super Admin only.' : 'Device authorization key registered. Ask this stall Owner to issue a grant, then refresh here. No active grant is cached.')
  }
  async function issue() {
    const device=devices.find(row=>JSON.stringify([row.userId,row.deviceId])===target)
    if (!device) throw Error('Select a registered Admin device.')
    const input={userId:device.userId,deviceId:device.deviceId,canFinalize,hours:Number(hours)}
    const identity=JSON.stringify(input)
    if (!issuing.current || issuing.current.identity!==identity) issuing.current={identity,grantId:crypto.randomUUID()}
    const result=await issueOfflineAuthorization({...input,grantId:issuing.current.grantId})
    if (!result.ok) throw Error(result.message)
    issuing.current=null
    await list()
    setNotice('Owner grant saved. The Admin must refresh authorization on the selected device while online. Older grants on that device were revoked.')
  }
  return <section aria-label="Owner offline authorization">
    <h2>Admin offline Final Price authorization</h2>
    <p>Signed grants apply to one Admin, device, business, stall and season. They never grant payments, purchase costs, profit, price overrides or QR acceptance.</p>
    <p>Owners and Super Admins can enable separate Billing Finalization per Admin in Users. The Admin then prepares or refreshes this device online to cache its signed grant. Existing independent device grants remain separate.</p>
    {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
    {owner?<>
      <button type="button" className="pos-button pos-button--outline" disabled={!available} onClick={()=>run(list)}>Load Admin devices &amp; grants</button>
      <label className="pos-field">Registered Admin device<select value={target} disabled={busy||disabled} onChange={event=>setTarget(event.target.value)}><option value="">Choose Admin device</option>{devices.map(row=><option key={JSON.stringify([row.userId,row.deviceId])} value={JSON.stringify([row.userId,row.deviceId])}>{row.name||row.email} · {row.deviceId}</option>)}</select></label>
      <label className="pos-field">Grant duration<select value={hours} disabled={busy||disabled} onChange={event=>setHours(event.target.value)}>{[1,4,8,24].map(value=><option key={value} value={value}>{value} hours</option>)}</select></label>
      <label><input type="checkbox" checked={canFinalize} disabled={busy||disabled} onChange={event=>setCanFinalize(event.target.checked)} /> Also allow saving agreed amounts and finalizing offline</label>
      <button type="button" className="pos-button" disabled={!available||!target} onClick={()=>run(issue)}>Issue signed device grant</button>
      <p>Without the checkbox the grant permits Final Price viewing only. Finalization accepts any positive saved agreement and audits the Admin and issuing Owner.</p>
      <ul className="pos-grant-list">{grants.map(grant=><li key={grant.id}><strong>{grant.userId} · {grant.deviceId}</strong><p>{grant.canFinalize?'Final Price + finalization':'Final Price viewing'} · expires {new Date(grant.expiresAt).toLocaleString()} · {grant.revokedAt?'Revoked':grant.invalidatedAt?'Membership changed — issue a fresh grant':Date.parse(grant.expiresAt)<=clock?'Expired':'Issued'}</p>{!grant.revokedAt?<button type="button" className="pos-button pos-button--outline" disabled={!available} onClick={()=>run(async()=>{const result=await revokeOfflineAuthorization(grant.id);if(!result.ok)throw Error(result.message);await list();setNotice('Grant revoked on the server. Offline devices learn on refresh; new sync commits are rejected immediately.')})}>Revoke device grant</button>:null}</li>)}</ul>
    </>:profile.role==='admin'?<>
      <p>Device: {profile.scope.deviceId}</p><p>{grantStatus(profile.authorization,profile.scope,clock) || `Cached grant expires ${new Date(profile.authorization.grant.claims.expiresAt).toLocaleString()}. ${profile.authorization.grant.claims.canFinalize?'Agreements and finalization authorized.':'Final Price viewing only.'}`}</p>
      <button type="button" className="pos-button pos-button--outline" disabled={!available} onClick={()=>run(refresh)}>Register / refresh Owner authorization</button>
      <p>Use this once to register your key. After the Owner issues or changes a grant, refresh again online. Expired or revoked authorization never permits a new server commit.</p>
    </>:<p>Manage Billing Finalization per Admin in Users. The independent Phase 2 device-grant controls above remain Owner-only.</p>}
  </section>
}
