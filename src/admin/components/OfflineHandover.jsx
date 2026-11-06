import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { createFrameCollector, encodeFrames, verifyTransfer } from '../../shared/handoverProtocol.js'
import { generateHandover, matchTransferCatalogue } from '../offline/handover.js'
import { startQrCamera } from '../offline/qrCamera.js'
import { prepareOfflineHandover } from '../api/adminOffline.js'
import FamilyPackSnapshotPreview from './FamilyPackSnapshotPreview.jsx'

export default function OfflineHandover({storage,profile,draft,catalogue,familyPacks=[],operations,canAccept,canPrepare,disabled,onPrepared,onAccepted,scanRequest=0,onScanHandled}) {
  const [recipient,setRecipient]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [frames,setFrames]=useState([]),[index,setIndex]=useState(0),[image,setImage]=useState(''),[cycle,setCycle]=useState(false)
  const [exportSource,setExportSource]=useState(null)
  const [scanning,setScanning]=useState(false),[progress,setProgress]=useState(''),[preview,setPreview]=useState(null),[pasted,setPasted]=useState('')
  const video=useRef(null),collector=useRef(createFrameCollector()),checking=useRef(false),frameHandler=useRef(null),handledScan=useRef(0),running=useRef(false)
  const prep=profile.handover
  const recipients=prep?.recipients ?? []
  const recipientPrepared=recipients.some(user=>user.userId===recipient)
  const preparationExpired=Boolean(prep) && !(Date.parse(prep.certificate?.claims?.expiresAt)>Date.now())
  const recipientHelp=!prep
    ? 'Connect to the internet and sign in to this stall, then choose Prepare QR recipients below. Catalogue preparation and Owner billing authorization do not prepare QR recipients.'
    : preparationExpired ? 'QR preparation has expired. Connect to the internet and prepare QR recipients again on this phone.'
    : !recipients.length ? 'No authorized Owner / Super Admin recipients were returned for this stall and season. Ask the stall Owner to check active season and stall membership, then prepare QR recipients again online. Recipients cannot be added offline.'
    : 'Choose from the recipients saved during online QR preparation. This list works offline; adding or updating recipients requires internet and authorized Owner / Super Admin membership in this stall and season.'
  useEffect(()=>{
    setRecipient(current=>recipients.some(user=>user.userId===current)?current:'')
  },[prep])
  const savedCreation = draft && (draft.requestId || operations.some(row => row.draftId === draft.draftId && row.payload.kind === 'CREATE' && ['pending','synced'].includes(row.state)))
  const exportIsCurrent=exportSource?.draftId===draft?.draftId && exportSource?.revision===draft?.localRevision && exportSource?.recipient===recipient
  useEffect(()=>{
    if(!scanRequest||handledScan.current===scanRequest||!canAccept||disabled)return
    handledScan.current=scanRequest;onScanHandled?.()
    if(!prep){setNotice('Prepare / refresh secure QR handover online on this device before scanning. Ordinary billing remains available.');return}
    collector.current=createFrameCollector();setPreview(null);setProgress('');setError('');setScanning(true)
  },[scanRequest,canAccept,disabled,prep,onScanHandled])
  useEffect(()=>{ let cancelled=false; if (!frames.length) return; QRCode.toDataURL(frames[index],{errorCorrectionLevel:'M',margin:4,width:500}).then(value=>{if(!cancelled)setImage(value)}).catch(reason=>setError(reason.message)); return()=>{cancelled=true} },[frames,index])
  useEffect(()=>{if(!cycle||frames.length<2)return; const timer=setInterval(()=>setIndex(value=>(value+1)%frames.length),1800);return()=>clearInterval(timer)},[cycle,frames])
  useEffect(()=>{
    if(!scanning)return
    const controller=new AbortController()
    startQrCamera(video.current,frame=>frameHandler.current?.(frame),{signal:controller.signal}).catch(reason=>{setError(reason.message);setScanning(false)})
    return()=>controller.abort()
  },[scanning])
  async function run(work) {if(running.current)return;running.current=true;setBusy(true);setError('');setNotice('');try{await work()}catch(reason){setError(reason.message)}finally{running.current=false;setBusy(false)}}
  async function prepare() {
    const device=await storage.device(),keys=await storage.signingIdentity(profile.scope)
    const result=await prepareOfflineHandover({deviceId:device.deviceId,deviceToken:device.deviceToken,publicKey:keys.publicKey})
    if(!result.ok)throw Error(result.message ?? 'QR preparation failed.')
    const next=await storage.saveHandoverPreparation(profile.scope,result);await onPrepared(next)
    setRecipient(current=>next.handover.recipients.some(user=>user.userId===current)?current:'')
    setNotice(next.handover.recipients.length ? 'QR signing and recipients are saved for seven days. Choose the intended recipient below. Prepare the receiving phone online too.' : 'QR signing is prepared, but no authorized Owner / Super Admin recipients were found. Ask the stall Owner to review access, then prepare again online.')
  }
  async function receive(frame) {
    if(checking.current)return
    try {
      const result=collector.current(frame);setProgress(`${result.received} / ${result.total} QR frames collected`)
      if(!result.envelope)return
      checking.current=true;setScanning(false)
      setProgress('Verifying signed bill and intended recipient…')
      await verifyTransfer(result.envelope,{rootKey:prep.rootKey,grantRootKey:prep.grantRootKey,scope:profile.scope,recipientUserId:profile.scope.userId})
      setPreview(result.envelope);setError('');setProgress('Complete sequence verified. Review this bill, then accept explicitly.')
    } catch(reason){setPreview(null);setError(reason.message)}finally{checking.current=false}
  }
  useEffect(()=>{frameHandler.current=receive})
  const matches=preview?matchTransferCatalogue(preview.payload,catalogue,familyPacks):[]
  return <section className="admin-card" aria-label="Offline QR handover">
    <h2>QR handover between devices</h2>
    <p>Transfers and offline acceptances are provisional until server reconciliation. Pending requests can be finalized by the recipient. Finalized bill QR includes the original signed chain and opens payment collection after acceptance. Scanning alone never records money.</p>
    <button type="button" disabled={!canPrepare||busy||disabled} onClick={()=>run(prepare)}>Prepare / refresh secure QR handover online</button>
    <p>{prep?`QR certificate expires ${prep.certificate.claims.expiresAt}.`:'Each device needs online QR preparation before offline transfer.'}</p>
    {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
    <p id="qr-recipient-help" role="status">{recipientHelp}{disabled ? ' Recipient selection is temporarily locked while saving or switching workspaces, or while this workspace is read-only. Wait for saving to finish; reconnect if access needs verification.' : ''}</p>
    {!prep||preparationExpired||!recipients.length ? <button type="button" disabled={!canPrepare||busy||disabled} onClick={()=>run(prepare)}>Prepare QR recipients (internet required)</button> : null}
    {!canPrepare ? <p>Online QR preparation requires internet and a signed-in account with access to this business, stall and season. An Owner must correct missing recipient access before you refresh.</p> : null}
    <fieldset disabled={!prep||preparationExpired||busy||disabled}>
      <legend>Send the selected request</legend>
      {!draft ? <p>Open a saved bill in Bills &amp; sync before sending it.</p> : !savedCreation ? <p>Use Save bill in New sale before generating a handover. An autosaved draft alone cannot be transferred.</p> : <p>Selected: {draft.body.customer.name} · {draft.requestId || 'locally saved bill'}. Choose the intended recipient below.</p>}
      <label className="admin-field">Intended recipient<select className="admin-input" aria-describedby="qr-recipient-help" disabled={!recipients.length} value={recipient} onChange={event=>setRecipient(event.target.value)}><option value="">Choose Owner / Super Admin</option>{recipients.map(user=><option key={user.userId} value={user.userId}>{user.name || user.userId} · {user.userId} · {user.role}</option>)}</select></label>
      <button type="button" disabled={!savedCreation||!recipientPrepared} onClick={()=>run(async()=>{const envelope=await generateHandover({storage,profile,draft,operations,catalogue,recipientUserId:recipient});setFrames(encodeFrames(envelope));setExportSource({draftId:draft.draftId,revision:draft.localRevision,recipient,requestId:envelope.payload.requestId});setIndex(0);setCycle(false)})}>Generate request handover QR</button>
    </fieldset>
    {frames.length && exportIsCurrent?<div><p>Request {exportSource.requestId}. Complete sequence: frame {index+1} of {frames.length}. The receiving device must collect every frame and preview the request. QR contains customer details; share only with the intended recipient.</p>
      {image?<img src={image} width="500" height="500" style={{maxWidth:'100%',height:'auto'}} alt={`Diwali handover QR frame ${index+1} of ${frames.length}`} />:null}
      <button type="button" onClick={()=>{setImage('');setIndex(value=>(value+frames.length-1)%frames.length)}}>Previous frame</button>{' '}
      <button type="button" onClick={()=>{setImage('');setIndex(value=>(value+1)%frames.length)}}>Next frame</button>{' '}
      <label><input type="checkbox" checked={cycle} onChange={event=>setCycle(event.target.checked)} />Cycle frames automatically</label>
      <details><summary>Complete QR frame text</summary><textarea readOnly rows="5" style={{width:'100%'}} value={frames.join('\n')} aria-label="Complete QR frame sequence" /></details>
    </div>:null}
    {canAccept?<>
      <h3>Receive and preview</h3>
      <button type="button" disabled={!prep||busy||disabled} onClick={()=>{collector.current=createFrameCollector();setPreview(null);setProgress('');setError('');setScanning(true)}}>Start camera scanner</button>{' '}
      <button type="button" onClick={()=>setScanning(false)}>Stop camera</button>
      {scanning?<video ref={video} aria-label="QR camera preview" style={{width:'100%',maxWidth:600}} muted playsInline />:null}
      {progress?<p role="status">{progress}</p>:null}
      <details><summary>Paste a complete QR sequence instead</summary><textarea aria-label="QR frames to verify" maxLength={100000} value={pasted} onChange={event=>setPasted(event.target.value)} rows="4" style={{width:'100%'}} />
        <button type="button" disabled={!prep||busy||disabled} onClick={()=>run(async()=>{collector.current=createFrameCollector();setPreview(null);for(const frame of pasted.trim().split(/\s+/))await receive(frame)})}>Verify all pasted frames</button>
      </details>
      {preview?<div><h3>Verified request preview</h3>
        {preview.payload.v===3?<p><strong>Finalized bill · payment handoff · ₹{(preview.payload.bill.agreedAmountPaise/100).toFixed(2)}</strong><br/>The Worker must acknowledge the original bill chain and this handoff before dependent payments become authoritative.</p>:null}
        <p>Request {preview.payload.requestId} · transfer {preview.payload.transferId} · source revision {preview.payload.revision ?? 'unsynchronized creation'}</p>
        <p>Original creator / initiator: {preview.certificate.claims.userId} · certified role at preparation: {preview.certificate.claims.role} · device {preview.certificate.claims.deviceId}. Current authorization is rechecked during synchronization.</p>
        <p>Recipient: {profile.scope.userId} · stall {profile.scope.locationId} · business {profile.scope.businessId} · season {profile.scope.seasonId}</p>
        <p>Customer details supplied by creator: {preview.payload.customer.name} · {preview.payload.customer.mobile} · source occurrence {preview.payload.sourceOccurredAt} · transferred {preview.payload.occurredAt}</p>
        <dl>{Object.entries(preview.payload.customer).filter(([key,value])=>!['name','mobile'].includes(key)&&value).map(([key,value])=><div key={key}><dt>{key}</dt><dd style={{whiteSpace:'pre-wrap'}}>{value}</dd></div>)}</dl>
        <ol>{matches.map(({line,matches,reason})=><li key={line.lineId}>{line.familyPackId?<FamilyPackSnapshotPreview pack={line.packSnapshot} quantity={line.quantity} />:<>{line.productName} ({line.productId}) · {line.quantity} × {line.unitType} · ₹{(line.sellingUnitPaise/100).toFixed(2)} · {line.packSnapshot.pack} · {line.packSnapshot.company} · {line.packSnapshot.piecesPerPack} pieces / pack · loose sale {line.packSnapshot.allowLooseSale?'allowed':'disabled'}</>} · line {line.lineId}{!matches?<p role="alert">{preview.payload.v===3?'Your catalogue differs. This finalized bill keeps its signed captured prices; the Worker must reconcile its original source chain.':reason??'Catalogue mismatch; refresh or resolve before acceptance.'} The captured snapshot is preserved.</p>:null}</li>)}</ol>
        <button type="button" disabled={busy||disabled||preview.payload.v!==3&&matches.some(row=>!row.matches)} onClick={()=>run(async()=>{const accepted=await storage.acceptHandover(profile.scope,preview,catalogue,familyPacks);await onAccepted(accepted.draft);setNotice(accepted.duplicate?'This transfer was already accepted locally; opened its preserved draft.':'Accepted provisionally and saved atomically to drafts and outbox. Financial changes, finalization and payments are separate actions.');setPreview(null)})}>Accept provisionally and save to outbox</button>
        <button type="button" onClick={()=>setPreview(null)}>Cancel preview</button>
      </div>:null}
    </>:null}
  </section>
}
