import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Browser, worker, delay, until } from './concurrent-sync-browser-client.mjs'
import { createFrameCollector, verifyTransfer } from '../../src/shared/handoverProtocol.js'

const root=path.resolve(process.argv[2]),{directory}=JSON.parse(await readFile(path.join(root,'phase5-current.json'),'utf8'))
assert.ok(directory.startsWith(root+path.sep)&&path.basename(directory).startsWith('p5-'))
const state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')),file=path.join(directory,'browser-progress-verified.json')
let progress
try{progress=JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;progress={results:[],trace:[],requests:[],saved:{}}}
if(progress.error){(progress.harnessDiagnostics??=[]).push(progress.error);delete progress.error}
const {results,trace,requests,saved}=progress,names=['admin1','admin2','admin3','admin4','owner','super']
const browsers=Object.fromEntries(names.map((name,i)=>[name,new Browser(name,path.join(directory,'browser-'+name+'-verified'),26551+i,trace)]))
const admins=names.slice(0,4).map(name=>browsers[name]),u=state.actors
const persist=()=>writeFile(file,JSON.stringify(progress,null,2))
const compact=snapshot=>({profiles:snapshot.profiles.map(p=>({scope:p.scope,role:p.role})),drafts:snapshot.drafts.map(d=>({draftId:d.draftId,requestId:d.requestId,body:d.body,expectedRevision:d.expectedRevision,localClosure:d.localClosure})),outbox:snapshot.outbox.map(r=>({id:r.payload.operationId,payload:r.payload,state:r.state,attempts:r.attempts,lastError:r.lastError,ack:r.acknowledgement,serverSnapshot:r.serverSnapshot})),versions:snapshot.versions.length})
async function api(name,route,{method='GET',body,revision,location=state.a,season=state.season}={}){
  const response=await fetch(worker+route,{method,headers:{Cookie:u[name].cookie,Origin:worker,'Content-Type':'application/json','X-Admin-Location-Id':location,'X-Admin-Season-Id':season,...(revision==null?{}:{'If-Match':String(revision)})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const data=await response.json();requests.push({name,route,method,location,season,status:response.status,error:data.error,operationId:body?.operationId,kind:body?.kind,...(data.operationId?{ack:{operationId:data.operationId,requestId:data.requestId,revision:data.revision,idempotentReplay:data.idempotentReplay}}:{})});return{status:response.status,data}
}
const okay=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify({status:r.status,error:r.data.error,message:r.data.message}));return r.data}
const detail=async(name,id)=>okay(await api(name,'/api/admin/customer-requests/'+id))
const history=async(id)=>okay(await api('owner',`/api/admin/customer-requests/${id}/history?limit=100`))
const payments=async(id)=>okay(await api('owner',`/api/admin/customer-requests/${id}/payments?limit=100`))
async function check(id,name,scenarios,run){
  if(results.some(r=>r.id===id&&r.status==='PASS')){console.log('RETAIN '+id);return}
  for(let i=results.length-1;i>=0;i--)if(results[i].id===id){(progress.priorAttempts??=[]).push(results[i]);results.splice(i,1)}
  try{const evidence=await run();results.push({id,name,scenarios,status:'PASS',evidence});console.log('PASS '+id)}catch(error){results.push({id,name,scenarios,status:'FAIL',error:error.stack});await persist();throw error}
  await persist()
}
async function syncRows(b,predicate,seconds=30){return until(()=>b.snapshot(),s=>predicate(s.outbox),seconds)}
async function gateRelease(group,kind){await until(async()=>group.map(b=>b.held.length),counts=>counts.every(n=>n===1));const released=(await Promise.all(group.map(b=>b.release()))).flat();assert.ok(released.every(r=>r.kind===kind));assert.ok(Math.max(...released.map(x=>x.releasedAt))-Math.min(...released.map(x=>x.releasedAt))<1000);return released}
async function sendSaved(name,op,snapshot){const device=snapshot.meta.find(r=>r.key==='device');return api(name,'/api/admin/offline/sync',{method:'POST',body:{...op,deviceToken:device.deviceToken}})}
async function newIndependent(b,name){await b.newDraft(name,[state.products.a]);await syncRows(b,rows=>rows.some(r=>r.state==='pending'&&r.payload.kind==='CREATE'))}
async function queueEdit(b,id,qty){await b.fresh(id);await b.offline(true);await b.quantity(qty);await b.queue('EDIT');await syncRows(b,rows=>rows.some(r=>r.payload.kind==='EDIT'&&r.payload.requestId===id&&r.state==='pending'))}

try{
  for(const name of names){const b=browsers[name];await b.launch();await b.login(u[name],state);if(!saved.prepared?.includes(name)){await b.prepare(['owner','super'].includes(name));(saved.prepared??=[]).push(name);await persist()}}
  for(const b of Object.values(browsers))b.suspended=false
  await check('P5-01','Four isolated Admin profiles create and edit independent requests offline',[1,2,15],async()=>{
    await Promise.all(admins.map(async(b,index)=>{
      const existing=await b.snapshot()
      if(existing.outbox.length===2){await b.offline(true);return}
      await b.offline(true);await b.newDraft('Phase 5 Admin '+(index+1)+' independent',[state.products.a,state.products.extra]);await b.quantity(index+2)
      await b.eval("Array.from(document.querySelectorAll('button')).filter(x=>x.textContent.trim()==='Remove product')[1].click()")
      await b.saved();await b.queue('EDIT');await syncRows(b,rows=>rows.length===2&&rows.every(r=>r.state==='pending'))
    }))
    const snapshots=await Promise.all(admins.map(b=>b.snapshot()))
    assert.equal(new Set(snapshots.map(s=>s.profiles[0].scope.deviceId)).size,4);assert.equal(new Set(snapshots.map(s=>s.profiles[0].scope.userId)).size,4)
    for(const [i,s]of snapshots.entries()){assert.equal(s.outbox.length,2);assert.equal(s.outbox[0].payload.kind,'CREATE');assert.equal(s.outbox[1].payload.kind,'EDIT');assert.equal(s.outbox[1].payload.body.items.length,1);assert.equal(s.outbox[1].payload.body.items[0].quantity,i+2);assert.equal(s.outbox[1].payload.parentOperationId,s.outbox[0].payload.operationId)}
    saved.initial=snapshots.map(compact);await persist()
    return{profiles:admins.map(b=>b.profile),users:snapshots.map(s=>s.profiles[0].scope.userId),devices:snapshots.map(s=>s.profiles[0].scope.deviceId),operationIds:snapshots.flatMap(s=>s.outbox.map(r=>r.payload.operationId)),offlineFinalQuantities:[2,3,4,5]}
  })
  await check('P5-02','Four-way barrier release, lost committed response, partial prefix and unchanged-ID recovery',[3,4,5,8,9],async()=>{
    if(!saved.partial){
      admins[0].faults.push({kind:'CREATE',stage:'response',label:'drop_success_after_server_commit'})
      admins[1].faults.push({kind:'EDIT',stage:'request',label:'disconnect_before_dependent_edit'})
      for(const b of admins)b.gate=op=>op.kind==='CREATE'
      await Promise.all(admins.map(async b=>{await b.offline(false);await b.sync()}))
      saved.firstBarrier=await gateRelease(admins,'CREATE')
      const partial=await Promise.all(admins.map((b,i)=>syncRows(b,rows=>i===0?rows.every(r=>r.state==='pending')&&rows[0].attempts>0:i===1?rows.some(r=>r.state==='synced')&&rows.some(r=>r.state==='pending'&&r.attempts>0):rows.every(r=>r.state==='synced'))))
      assert.equal(admins[0].faults[0].used,true);assert.ok(admins[0].faults[0].ack?.requestId);assert.equal(admins[1].faults[0].used,true)
      saved.partial=partial.map(compact);saved.faults=admins.flatMap(b=>b.faults.map(f=>({browser:b.name,...f})));await persist()
    }
    await delay(2300)
    await Promise.all(admins.map(async b=>{await b.offline(false);await b.sync()}))
    const recovered=await Promise.all(admins.map(b=>syncRows(b,rows=>rows.every(r=>r.state==='synced'))))
    saved.mainIds=recovered.map(s=>s.outbox[0].acknowledgement.requestId);assert.equal(new Set(saved.mainIds).size,4)
    for(const [i,s]of recovered.entries()){
      assert.deepEqual(s.outbox.map(r=>r.payload.operationId).sort(),saved.initial[i].outbox.map(r=>r.id).sort())
      const d=await detail(admins[i].name,saved.mainIds[i]);assert.equal(d.request.items.length,1);assert.equal(d.request.items[0].quantity,i+2)
    }
    const before=trace.filter(r=>r.stage==='request').length
    await Promise.all(admins.map(b=>b.sync()));await Promise.all(admins.map(b=>b.idle()))
    assert.equal(trace.filter(r=>r.stage==='request').length,before)
    saved.recovered=recovered.map(compact);await persist()
    return{barrier:saved.firstBarrier,faults:saved.faults,partial:saved.partial.map(s=>s.outbox.map(r=>({id:r.id,state:r.state,attempts:r.attempts}))),requests:saved.mainIds,recovered:recovered.map(s=>s.outbox.map(r=>({id:r.payload.operationId,state:r.state,attempts:r.attempts}))),acknowledgedOperationsNotRedispatched:true}
  })
  await check('P5-03','A virgin browser CREATE and concurrent duplicate submissions share one atomic receipt',[6,7],async()=>{
    const b=browsers.admin3
    await b.offline(true);await newIndependent(b,'Phase 5 duplicate virgin operation')
    const s=await b.snapshot(),row=s.outbox.find(r=>r.state==='pending');saved.duplicateOp=row.payload.operationId;await persist()
    b.gate=op=>op.operationId===row.payload.operationId
    await b.offline(false);await b.sync();await until(async()=>b.held.length,n=>n===1)
    const start=trace.length,concurrent=Promise.all(Array.from({length:3},()=>sendSaved('admin3',row.payload,s)))
    await b.release();const copies=(await concurrent).map(okay)
    const done=await syncRows(b,rows=>rows.find(r=>r.payload.operationId===row.payload.operationId)?.state==='synced'),ack=done.outbox.find(r=>r.payload.operationId===row.payload.operationId).acknowledgement
    assert.ok(copies.every(a=>a.requestId===ack.requestId));assert.equal(copies.filter(a=>!a.idempotentReplay).length+trace.slice(start).filter(r=>r.ack?.operationId===row.payload.operationId&&r.ack.idempotentReplay===false).length,1)
    saved.duplicateId=ack.requestId
    return{operationId:row.payload.operationId,requestId:ack.requestId,browserAndDirectCopies:4,directReplays:copies.map(a=>a.idempotentReplay),oneWinningCommit:true}
  })
  await check('P5-04','Two Admins race an offline edit; conflict keeps both versions while independent drafts sync',[10],async()=>{
    const id=saved.mainIds[0],group=[browsers.admin1,browsers.admin2],baseQuantity=saved.raceRetry?18:8
    await Promise.all(group.map((b,i)=>queueEdit(b,id,baseQuantity+i)))
    if(!saved.raceRetry)await Promise.all(group.map((b,i)=>newIndependent(b,'Phase 5 independent behind race '+i)))
    const before=await Promise.all(group.map(b=>b.snapshot()))
    saved.editRaceOps=before.map(s=>s.outbox.find(r=>r.payload.requestId===id&&r.state==='pending').payload.operationId);await persist()
    for(const b of group)b.gate=op=>saved.editRaceOps.includes(op.operationId)
    await Promise.all(group.map(async b=>{await b.offline(false);await b.sync()}));saved.editBarrier=await gateRelease(group,'EDIT')
    const after=await Promise.all(group.map(b=>syncRows(b,rows=>!rows.some(r=>['pending','syncing'].includes(r.state)))))
    const rows=after.map((s,i)=>s.outbox.find(r=>r.payload.operationId===saved.editRaceOps[i]));assert.deepEqual(rows.map(r=>r.state).sort(),['conflict','synced'])
    const loser=rows.findIndex(r=>r.state==='conflict'),winner=1-loser;assert.equal(rows[loser].lastError.status,409);assert.ok(rows[loser].serverSnapshot?.request)
    assert.equal(rows[loser].payload.body.items[0].quantity,baseQuantity+loser)
    const d=await detail('owner',id);assert.equal(d.request.items[0].quantity,baseQuantity+winner)
    if(!saved.raceRetry)saved.raceIndependentIds=after.map((s,i)=>s.outbox.find(r=>r.payload.kind==='CREATE'&&!before[i].outbox.some(old=>old.state==='synced'&&old.payload.operationId===r.payload.operationId)).acknowledgement.requestId)
    assert.equal(new Set(saved.raceIndependentIds).size,2);saved.editRace={id,winner:group[winner].name,loser:group[loser].name,quantity:baseQuantity+winner,operations:rows.map(r=>({id:r.payload.operationId,state:r.state,body:r.payload.body,serverSnapshot:r.serverSnapshot}))};await persist()
    return{...saved.editRace,barrier:saved.editBarrier,independentRequestsSyncedDespiteConflict:saved.raceIndependentIds}
  })
  await check('P5-05','Owner finalization cannot be overwritten by older Admin offline items',[11],async()=>{
    const id=saved.mainIds[3],b=browsers.admin4
    await queueEdit(b,id,99)
    const s=await b.snapshot(),pending=s.outbox.find(r=>r.state==='pending');saved.finalizationPending=pending.payload.operationId;await persist()
    okay(await api('owner',`/api/admin/customer-requests/${id}/quotation/customer-agreed-amount`,{method:'PATCH',revision:(await detail('owner',id)).request.revision,body:{acceptedAmountInr:'420'}}))
    okay(await api('owner',`/api/admin/customer-requests/${id}/finalize`,{method:'PATCH',revision:(await detail('owner',id)).request.revision,body:{}}))
    const before=await history(id)
    await b.offline(false);await b.sync();const done=await syncRows(b,rows=>rows.find(r=>r.payload.operationId===pending.payload.operationId)?.state==='conflict'),row=done.outbox.find(r=>r.payload.operationId===pending.payload.operationId)
    assert.equal(row.lastError.status,409);assert.equal(row.serverSnapshot.request.status,'closed');assert.equal(row.payload.body.items[0].quantity,99);assert.deepEqual(await history(id),before)
    const d=await detail('owner',id);assert.equal(d.request.items[0].quantity,5);assert.equal((await payments(id)).summary.amountDuePaise,42000)
    saved.finalizationId=id;return{requestId:id,pendingOperation:pending.payload.operationId,conflictStatus:409,retainedLocalQuantity:99,serverQuantity:5,amountDuePaise:42000,serverHistoryUnchanged:true}
  })
  await check('P5-06','Competing Owner and Super Admin offline closures retain one winner and one conflict',[12],async()=>{
    const id=saved.mainIds[1],group=[browsers.owner,browsers.super]
    okay(await api('owner',`/api/admin/customer-requests/${id}/quotation/customer-agreed-amount`,{method:'PATCH',revision:(await detail('owner',id)).request.revision,body:{acceptedAmountInr:'330'}}))
    await Promise.all(group.map(async b=>{await b.fresh(id);await b.offline(true);await b.queue('CLOSE')}))
    const initial=await Promise.all(group.map(b=>b.snapshot())),ops=initial.map(s=>s.outbox.find(r=>r.state==='pending'&&r.payload.kind==='CLOSE').payload.operationId)
    saved.closureOps=ops;await persist();for(const b of group)b.gate=op=>ops.includes(op.operationId)
    await Promise.all(group.map(async b=>{await b.offline(false);await b.sync()}));const barrier=await gateRelease(group,'CLOSE')
    const done=await Promise.all(group.map(b=>syncRows(b,rows=>!rows.some(r=>['pending','syncing'].includes(r.state))))),rows=done.map((s,i)=>s.outbox.find(r=>r.payload.operationId===ops[i]))
    assert.deepEqual(rows.map(r=>r.state).sort(),['conflict','synced']);const winner=rows.findIndex(r=>r.state==='synced'),loser=1-winner
    assert.equal(rows[loser].lastError.status,409);assert.equal(rows[loser].serverSnapshot.request.status,'closed');assert.ok(done[loser].drafts.some(d=>d.localClosure?.operationId===ops[loser]))
    const d=await detail('owner',id);assert.equal(d.request.closedByEmail,u[group[winner].name].email)
    saved.closure={id,winner:group[winner].name,loser:group[loser].name,operations:rows.map(r=>({id:r.payload.operationId,state:r.state,lastError:r.lastError}))};return{...saved.closure,barrier,provisionalLoserPreserved:true}
  })
  await check('P5-07','Offline payment duplicate delivery and QR duplicate acceptance stay idempotent during recovery',[13],async()=>{
    const b=browsers.owner,id=saved.finalizationId
    await b.fresh(id);await b.offline(true);await b.field('Received amount','100');await b.queue('PAYMENT')
    const paymentSnapshot=await b.snapshot(),pay=paymentSnapshot.outbox.find(r=>r.state==='pending'&&r.payload.kind==='PAYMENT');assert.ok(pay)
    b.gate=op=>op.operationId===pay.payload.operationId;await b.offline(false);await b.sync();await until(async()=>b.held.length,n=>n===1)
    const copies=Promise.all(Array.from({length:3},()=>sendSaved('owner',pay.payload,paymentSnapshot)));await b.release();const acknowledgements=(await copies).map(okay)
    await syncRows(b,rows=>rows.find(r=>r.payload.operationId===pay.payload.operationId)?.state==='synced')
    const p=await payments(id);assert.equal(p.entries.length,1);assert.equal(p.summary.receivedPaise,10000);assert.equal(p.summary.outstandingPaise,32000);assert.ok(acknowledgements.every(a=>a.requestId===id))
    saved.payment={requestId:id,operationId:pay.payload.operationId,paymentId:p.entries[0].paymentId,receivedPaise:10000};await persist()
    const sender=browsers.admin3
    await sender.qrPrepare();await sender.offline(true);await sender.newDraft('Phase 5 concurrent QR',[state.products.a]);await sender.field('Intended recipient',u.owner.id);await sender.click('Generate request handover QR');await sender.wait("document.querySelector('[aria-label=\"Complete QR frame sequence\"]')?.value.length>0")
    const frames=await sender.eval("document.querySelector('[aria-label=\"Complete QR frame sequence\"]').value"),collector=createFrameCollector();let envelope
    for(const frame of frames.split('\n'))envelope=collector(frame).envelope??envelope
    assert.ok(envelope);const ownerSnapshot=await b.snapshot();await verifyTransfer(envelope,{rootKey:ownerSnapshot.profiles[0].handover.rootKey,scope:ownerSnapshot.profiles[0].scope,recipientUserId:u.owner.id})
    await b.offline(true);await b.area('QR frames to verify',frames);await b.click('Verify all pasted frames');await b.wait("document.body.textContent.includes('Verified request preview')");await b.click('Accept provisionally and save to outbox');await b.wait("document.body.textContent.includes('Accepted provisionally')")
    await b.click('Verify all pasted frames');await b.wait("document.body.textContent.includes('Verified request preview')");await b.click('Accept provisionally and save to outbox');await b.wait("document.body.textContent.includes('already accepted locally')")
    const qrSnapshot=await b.snapshot(),handover=qrSnapshot.outbox.filter(r=>r.payload.kind==='HANDOVER');assert.equal(handover.length,1);const op=handover[0]
    b.gate=input=>input.operationId===op.payload.operationId;await b.offline(false);await b.sync();await until(async()=>b.held.length,n=>n===1)
    const qrCopies=Promise.all(Array.from({length:3},()=>sendSaved('owner',op.payload,qrSnapshot)));await b.release();const accepted=(await qrCopies).map(okay)
    await syncRows(b,rows=>rows.find(r=>r.payload.operationId===op.payload.operationId)?.state==='synced');assert.ok(accepted.every(a=>a.requestId===envelope.payload.requestId))
    saved.qr={requestId:envelope.payload.requestId,operationId:op.payload.operationId,transferId:envelope.payload.transferId,sourceOperationId:envelope.payload.sourceOperationId,creator:u.admin3.id,recipient:u.owner.id};await persist()
    await sender.offline(false);await sender.sync();await syncRows(sender,rows=>rows.some(r=>r.payload.operationId===envelope.payload.sourceOperationId&&r.state==='conflict'))
    return{payment:saved.payment,paymentCopies:4,qr:saved.qr,qrCopies:4,duplicateLocalScanOperations:1,signatureVerified:true,lateSourceCreatePreservedAsConflict:true}
  })
  await check('P5-08','Mutated scopes and foreign direct IDs are rejected after concurrent synchronization',[14],async()=>{
    const s=await browsers.admin1.snapshot(),source=s.outbox.find(r=>r.payload.kind==='CREATE').payload,device=s.meta.find(r=>r.key==='device'),statuses=[]
    for(const change of [{locationId:state.b},{seasonId:state.alternate},{businessId:state.prefix+'-foreign-business'}]){const r=await api('admin1','/api/admin/offline/sync',{method:'POST',body:{...source,operationId:crypto.randomUUID(),scope:{...source.scope,...change},deviceToken:device.deviceToken}});assert.ok([400,403,404,409].includes(r.status));statuses.push(r.status)}
    for(const options of [{location:state.b},{season:state.alternate}]){
      assert.equal((await api('admin1','/api/admin/offline/requests/'+saved.mainIds[0],options)).status,404)
      const r=await api('admin1','/api/admin/offline/sync',{...options,method:'POST',body:{...source,deviceToken:device.deviceToken}});assert.ok([400,403,404,409].includes(r.status));statuses.push(r.status)
    }
    return{scopeMutationStatuses:statuses,foreignReadStatuses:[404,404],authorizedInBothContexts:true}
  })
  await check('P5-09','All profiles retain immutable operations and conflict snapshots with independent acknowledgements',[4,7,9,10,11,12,15],async()=>{
    const snapshots=Object.fromEntries(await Promise.all(names.map(async name=>[name,compact(await browsers[name].snapshot())])))
    const all=Object.values(snapshots).flatMap(s=>s.outbox),ids=all.map(r=>r.id);assert.equal(new Set(ids).size,ids.length)
    const conflicts=all.filter(r=>r.state==='conflict');assert.equal(conflicts.length,saved.raceRetry?5:4);assert.ok(all.every(r=>['synced','conflict'].includes(r.state)));assert.equal(all.filter(r=>r.state==='synced'&&r.payload.kind==='CREATE').length,7)
    assert.equal(new Set([...saved.mainIds,saved.duplicateId,...saved.raceIndependentIds,saved.qr.requestId]).size,8)
    for(const r of all){assert.ok(r.payload.occurredAt);assert.ok(r.payload.scope.deviceId);assert.ok(r.payload.scope.userId);if(r.state==='synced'){assert.equal(r.ack.operationId,r.id);assert.ok(r.ack.requestId)}}
    saved.finalSnapshots=snapshots;await persist()
    return{profiles:6,operationCount:all.length,acknowledged:all.filter(r=>r.state==='synced').length,conflicts:conflicts.map(r=>({id:r.id,kind:r.payload.kind,requestId:r.payload.requestId,hasServerSnapshot:Boolean(r.serverSnapshot)})),expectedRequests:8,noPendingOrLostOperations:true,allOperationIdsUnique:true}
  })
}catch(error){console.log('FAIL '+error.message);progress.error=error.stack;process.exitCode=1}
finally{
  progress.lastBrowserSnapshots={}
  for(const name of names){try{progress.lastBrowserSnapshots[name]=compact(await browsers[name].snapshot())}catch{/* startup failure */}}
  progress.blockedOrigins=[...new Set(Object.values(browsers).flatMap(b=>[...b.blocked]))]
  await persist();await Promise.all(Object.values(browsers).map(b=>b.close()))
}
const output=path.join(directory,'browser-results-'+Date.now()+'.json')
await writeFile(output,JSON.stringify(progress,null,2),{flag:'wx'})
console.log(JSON.stringify({output,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length}))
