import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Browser,site,worker,delay,until} from './offline-qr-pack-browser-client.mjs'
import {videoFrames} from './offline-qr-pack-video.mjs'
import {createFrameCollector,verifyTransfer} from '../../src/shared/handoverProtocol.js'

const root=path.resolve(process.argv[2]),{directory}=JSON.parse(await readFile(path.join(root,'phase6-current.json'),'utf8'))
assert.ok(directory.startsWith(root+path.sep)&&path.basename(directory).startsWith('p6-'))
const state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')),file=path.join(directory,'browser-progress.json')
let progress;try{progress=JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;progress={results:[],trace:[],requests:[],saved:{}}}
if(progress.error){(progress.harnessDiagnostics??=[]).push(progress.error);delete progress.error}
const {results,trace,requests,saved}=progress,u=state.actors,clients={}
const persist=()=>writeFile(file,JSON.stringify(progress,null,2))
function browser(name,port,video){const args=video?['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--use-file-for-fake-video-capture='+video]:[];return clients[name]=new Browser(name,path.join(directory,'browser-'+name),port,trace,args)}
async function start(name,port,actor,video){const b=browser(name,port,video);await b.launch();await b.login(u[actor],state,saved.prepared?.includes(name));if(!saved.prepared?.includes(name)){await b.prepare(true);(saved.prepared??=[]).push(name);await persist()}return b}
async function api(actor,route,{method='GET',body,cookie=u[actor].cookie}={}){const r=await fetch(worker+route,{method,headers:{Cookie:cookie,Origin:worker,'Content-Type':'application/json','X-Admin-Location-Id':state.a,'X-Admin-Season-Id':state.season},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();requests.push({actor,route,method,status:r.status,error:data.error,operationId:body?.operationId});return{status:r.status,data}}
const okay=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify({status:r.status,error:r.data.error,message:r.data.message}));return r.data}
const compact=s=>({profiles:s.profiles.map(p=>({scope:p.scope,role:p.role,privateCatalogueLength:p.handover?.privateCatalogue?.length??0})),drafts:s.drafts,outbox:s.outbox.map(r=>({id:r.payload.operationId,payload:r.payload,state:r.state,attempts:r.attempts,lastError:r.lastError,ack:r.acknowledgement,serverSnapshot:r.serverSnapshot})),versions:s.versions.length})
async function check(id,name,scenarios,run){if(results.some(r=>r.id===id&&r.status==='PASS')){console.log('RETAIN '+id);return}for(let i=results.length-1;i>=0;i--)if(results[i].id===id){(progress.priorAttempts??=[]).push(results[i]);results.splice(i,1)}try{const evidence=await run();results.push({id,name,scenarios,status:'PASS',evidence});console.log('PASS '+id)}catch(error){results.push({id,name,scenarios,status:'FAIL',error:error.stack});await persist();throw error}await persist()}
async function exportQr(b,kind){await b.field('Intended recipient',u.owner.id);await b.click('Generate request handover QR');await b.wait("document.querySelector('[aria-label=\"Complete QR frame sequence\"]')?.value.length>0");const frames=(await b.eval("document.querySelector('[aria-label=\"Complete QR frame sequence\"]').value")).split('\n'),collect=createFrameCollector();let envelope;for(const frame of frames)envelope=collect(frame).envelope??envelope;const snapshot=await b.snapshot();await verifyTransfer(envelope,{rootKey:snapshot.profiles[0].handover.rootKey,scope:snapshot.profiles[0].scope,recipientUserId:u.owner.id});const video=await videoFrames(frames,path.join(directory,kind+'-camera.y4m'));return{frames,envelope,rootKey:snapshot.profiles[0].handover.rootKey,video}}
async function scan(b,video){await b.click('Start camera scanner');await b.wait("Boolean(document.querySelector('video')?.srcObject?.getVideoTracks().length)");const settings=await b.eval("(()=>{const t=document.querySelector('video').srcObject.getVideoTracks()[0];window.__phase6Track=t;return t.getSettings()})()");await b.wait("document.body.textContent.includes('Verified request preview')",Math.max(45,video.frames*4));assert.equal(await b.eval("document.querySelector('[aria-label=\"QR frames to verify\"]').value"),'');await b.wait("window.__phase6Track.readyState==='ended'");return{settings,trackStopped:true,pastedTextEmpty:true,syntheticVideo:true}}
async function accept(b){const count=(await b.snapshot()).outbox.length;await b.click('Accept provisionally and save to outbox');await until(()=>b.snapshot(),s=>s.outbox.length===count+1);await b.wait("document.body.textContent.includes('Accepted provisionally')");await b.saved()}
async function rows(b,predicate){return until(()=>b.snapshot(),s=>predicate(s.outbox))}

try{
 const admin=await start('admin',26661,'admin')
 await check('P6-01','Real prepared PWA exports normal v1 and two-variant mixed v2 QR while offline',[1,2,3,10,11],async()=>{
  await admin.offline(true);await admin.newDraft('Phase 6 normal camera transfer',[state.products.a]);saved.normal=await exportQr(admin,'normal');await persist()
  assert.equal(saved.normal.envelope.payload.v,1)
  await admin.click('New local request');await admin.saved();await admin.field('Customer name','Phase 6 two Family Pack variants');await admin.saved();await admin.field('Mobile','9876543210');await admin.saved();await admin.field('Saved catalogue',state.products.a);await admin.click('Add product');await admin.saved();await admin.field('Unit','piece');await admin.saved();await admin.quantity(3)
  for(const key of ['classic','classic','premium']){await admin.field('Saved Family Pack / variant',state.packs[key]);await admin.click('Add Family Pack with captured snapshot');await admin.saved()}
  await admin.queue('CREATE');saved.mixed=await exportQr(admin,'mixed');await persist()
  const payload=saved.mixed.envelope.payload;assert.equal(payload.v,2);assert.equal(payload.lines.length,3)
  const ordinary=payload.lines.find(l=>l.productId);assert.equal(ordinary.quantity,3);assert.equal(ordinary.unitType,'piece');assert.equal(ordinary.sellingUnitPaise,1000)
  const packs=payload.lines.filter(l=>l.familyPackId);assert.equal(packs.length,2)
  assert.deepEqual(packs.map(l=>l.quantity),[2,1]);assert.deepEqual(packs.map(l=>l.sellingUnitPaise),[45000,70000]);assert.deepEqual(packs.map(l=>l.packSnapshot.variant.label),['Classic','Premium']);assert.deepEqual(packs.flatMap(l=>l.packSnapshot.components.map(c=>c.unitLabel)),['box','piece','packet','bundle'])
  assert.ok(packs.every(l=>l.packSnapshot.components.length===2&&l.packSnapshot.components.every(c=>c.componentId&&c.productId&&c.sellingUnitPaise>0)))
  const s=await admin.snapshot();saved.catalogue=s.catalogues[0];assert.equal(s.profiles[0].role,'admin');assert.equal(s.profiles[0].handover.privateCatalogue.length,0);assert.doesNotMatch(JSON.stringify(saved.mixed.envelope),/purchase|profit|margin|deviceToken|privateKey|final_price/i)
  return{normalRequest:saved.normal.envelope.payload.requestId,mixedRequest:payload.requestId,normalFrames:saved.normal.video.frames,mixedFrames:saved.mixed.video.frames,normalVersion:1,mixedVersion:2,variants:packs.map(l=>({id:l.familyPackId,variant:l.packSnapshot.variant,quantity:l.quantity,pricePaise:l.sellingUnitPaise,components:l.packSnapshot.components})),adminPrivateCatalogue:0,sourceOutboxPending:s.outbox.map(r=>r.payload.operationId),syntheticVideosIndependentlyDecoded:true}
 })
 const normal=await start('normal-owner',26662,'owner',saved.normal.video.file)
 await check('P6-02','Normal-product camera stream is decoded, previewed and accepted offline exactly once',[2,6,11],async()=>{
  await normal.offline(true);const camera=await scan(normal,saved.normal.video);await accept(normal)
  const first=await normal.snapshot();assert.equal(first.outbox.length,1);assert.equal(first.outbox[0].payload.kind,'HANDOVER')
  const again=await scan(normal,saved.normal.video);await normal.click('Accept provisionally and save to outbox');await normal.wait("document.body.textContent.includes('already accepted locally')")
  const repeat=await normal.snapshot();assert.equal(repeat.outbox.length,1);assert.equal(repeat.outbox[0].payload.operationId,first.outbox[0].payload.operationId)
  assert.equal((await api('owner','/api/admin/offline/requests/'+saved.normal.envelope.payload.requestId)).status,404)
  assert.equal(trace.filter(r=>r.kind==='HANDOVER'&&r.browser==='normal-owner'&&r.stage==='request').length,0)
  saved.normalOperation=first.outbox[0].payload.operationId
  return{camera,repeatCamera:again,operationId:saved.normalOperation,localAcceptances:2,durableHandovers:1,serverBeforeExplicitSync:404,noSyncPostDuringQr:true}
 })
 const owner=await start('pack-owner',26663,'owner',saved.mixed.video.file)
 await check('P6-03','Mixed Family Pack camera transfer previews exact variants/components/units and accepts separately from cloud',[3,10,11],async()=>{
  await owner.offline(true);const camera=await scan(owner,saved.mixed.video)
  const preview=await owner.eval("Array.from(document.querySelectorAll('[aria-label=\"Complete Family Pack snapshot\"]')).map(x=>x.innerText)")
  assert.equal(preview.length,2);assert.ok(preview[0].includes('Classic')&&preview[1].includes('Premium'));assert.ok(preview.join(' ').includes('unit label: piece')&&preview.join(' ').includes('unit label: bundle'))
  await accept(owner);const s=await owner.snapshot(),packItems=s.drafts[0].body.items.filter(i=>i.familyPackId)
  assert.deepEqual(packItems.map(i=>i.familyPackSnapshot),saved.mixed.envelope.payload.lines.filter(l=>l.familyPackId).map(l=>l.packSnapshot))
  assert.equal(s.profiles[0].role,'owner');assert.equal(s.profiles[0].handover.privateCatalogue.length,2)
  assert.equal((await api('owner','/api/admin/offline/requests/'+saved.mixed.envelope.payload.requestId)).status,404)
  saved.packOperation=s.outbox[0].payload.operationId
  return{camera,completePackPreviews:preview,unchangedSnapshots:true,operationId:saved.packOperation,ownerPrivateCatalogueRows:2,serverBeforeExplicitSync:404}
 })
 await check('P6-04','Owner queues two-variant adjustments/agreement/closure/payment and reopens the PWA offline',[1,4,6],async()=>{
  await owner.field('Selling price override','9');await owner.saved();await owner.field('Discount for next item adjustment','10');await owner.saved();await owner.queue('EDIT')
  await owner.field('Customer-agreed amount','500');await owner.saved();await owner.queue('AGREEMENT');await owner.queue('CLOSE');await owner.field('Received amount','100');await owner.queue('PAYMENT')
  const before=await owner.snapshot();assert.deepEqual(before.outbox.map(r=>r.payload.kind),['HANDOVER','EDIT','AGREEMENT','CLOSE','PAYMENT']);saved.ownerQueue=compact(before);await persist()
  await owner.close();await owner.launch();await owner.offline(true);await owner.call('Page.navigate',{url:site+'/admin/offline'});await owner.wait("document.body.textContent.includes('Phase 6 two Family Pack variants')")
  const after=await owner.snapshot();assert.deepEqual(after.outbox.map(r=>r.payload.operationId),before.outbox.map(r=>r.payload.operationId));assert.deepEqual(after.drafts[0].body.items,before.drafts[0].body.items)
  const cache=await owner.eval("(async()=>{const out=[];for(const name of await caches.keys())if(name.startsWith('diwali-offline-shell-'))for(const request of await(await caches.open(name)).keys())out.push(new URL(request.url).pathname);return out})()")
  assert.ok(cache.length>0&&cache.every(p=>p==='/admin/offline'||p==='/manifest.webmanifest'||p.startsWith('/assets/')||p.startsWith('/icons/')))
  return{operationIds:after.outbox.map(r=>r.payload.operationId),wholeBrowserRestartOffline:true,snapshotsUnchanged:true,shellCachePaths:cache,physicalAndroid:false}
 })
 await check('P6-05','Explicit cloud sync recovers dropped handover acknowledgement and interrupted agreement without duplicates',[5,6,11],async()=>{
  await owner.offline(false);await owner.login(u.owner,state,true);owner.suspended=false
  let complete=await owner.snapshot()
  if(!complete.outbox.every(r=>r.state==='synced')){
  owner.faults.push({kind:'HANDOVER',stage:'response',label:'drop_committed_pack_handover_response'},{kind:'AGREEMENT',stage:'request',label:'disconnect_before_agreement'})
  await owner.sync();await rows(owner,rs=>rs.every(r=>r.state==='pending')&&rs[0].attempts>0);assert.ok(owner.faults[0].ack?.requestId)
  saved.afterLost=compact(await owner.snapshot());await persist()
  await delay(2300);await owner.offline(false);await owner.sync();await rows(owner,rs=>rs.filter(r=>r.state==='synced').length===2&&rs.filter(r=>r.state==='pending').length===3)
  saved.afterPartial=compact(await owner.snapshot());await persist()
  await delay(2300);await owner.offline(false);await owner.sync();complete=await rows(owner,rs=>rs.every(r=>r.state==='synced'))
  }
  assert.deepEqual(complete.outbox.map(r=>r.payload.operationId),saved.ownerQueue.outbox.map(r=>r.id))
  const id=saved.mixed.envelope.payload.requestId,p=okay(await api('owner',`/api/admin/customer-requests/${id}/payments`)),snapshot=okay(await api('owner','/api/admin/offline/requests/'+id))
  assert.equal(p.summary.amountDuePaise,50000);assert.equal(p.summary.receivedPaise,10000);assert.equal(p.summary.outstandingPaise,40000);assert.equal(p.entries.length,1);assert.equal(snapshot.request.status,'closed')
  assert.deepEqual(snapshot.request.items.filter(i=>i.familyPackId).map(i=>i.packSnapshot),saved.mixed.envelope.payload.lines.filter(l=>l.familyPackId).map(l=>l.packSnapshot))
  const quotation=okay(await api('owner',`/api/admin/customer-requests/${id}/quotation`)).quotation;assert.equal(quotation.totalPaise,161700)
  await normal.offline(false);normal.suspended=false;await normal.sync();await rows(normal,rs=>rs.every(r=>r.state==='synced'))
  await admin.offline(false);admin.suspended=false;await admin.sync();await rows(admin,rs=>rs.length===2&&rs.every(r=>r.state==='conflict'))
  const source=await admin.snapshot();assert.deepEqual(source.outbox.map(r=>r.payload.operationId),[saved.normal.envelope.payload.sourceOperationId,saved.mixed.envelope.payload.sourceOperationId])
  saved.catalogue=(await admin.snapshot()).catalogues[0]
  saved.finalSnapshots={admin:compact(source),normal:compact(await normal.snapshot()),owner:compact(complete)};saved.faults=owner.faults.length?owner.faults:trace.filter(r=>r.browser==='pack-owner'&&['drop_committed_pack_handover_response','disconnect_before_agreement'].includes(r.injectedFault)).map(r=>({kind:r.kind,label:r.injectedFault,operationId:r.operationId,ack:r.ack,used:true}));await persist()
  return{requestId:id,summary:p.summary,quotationPaise:161700,unchangedPackSnapshots:true,faults:saved.faults,normalSyncedSeparately:true,sourceConflictsPreserved:2,ownerOperations:complete.outbox.map(r=>({id:r.payload.operationId,kind:r.payload.kind,state:r.state,attempts:r.attempts}))}
 })
 await check('P6-06','Expired session cannot replay an acknowledged Family Pack operation and Admin views stay redacted',[7,10],async()=>{
  const current=await owner.snapshot(),device=current.meta.find(m=>m.key==='device'),op=current.outbox[0].payload
  const denied=await api('owner','/api/admin/offline/sync',{method:'POST',body:{...op,deviceToken:device.deviceToken},cookie:'diwali_admin_session=phase6-expired'});assert.equal(denied.status,401)
  for(const route of ['/api/admin/offline/catalogue','/api/admin/customer-requests/'+saved.mixed.envelope.payload.requestId,'/api/admin/customer-requests/'+saved.mixed.envelope.payload.requestId+'/history?limit=100','/api/admin/customer-requests/'+saved.mixed.envelope.payload.requestId+'/quotation']){const data=okay(await api('admin',route));assert.doesNotMatch(JSON.stringify(data),/purchase|profit|margin|finalSubtotal|bargainFloor/i)}
  return{expiredReplayStatus:401,redactedAdminSurfaces:4,ownerPositivePrivatePreparationRows:2}
 })
}catch(error){progress.error=error.stack;console.log('FAIL '+error.message);process.exitCode=1}
finally{progress.lastSnapshots={};for(const [name,b]of Object.entries(clients)){try{progress.lastSnapshots[name]=compact(await b.snapshot())}catch{/* startup only */}}progress.blockedOrigins=[...new Set(Object.values(clients).flatMap(b=>[...b.blocked]))];await persist();await Promise.all(Object.values(clients).map(b=>b.close()))}
const output=path.join(directory,'browser-results-'+Date.now()+'.json');await writeFile(output,JSON.stringify(progress,null,2),{flag:'wx'});console.log(JSON.stringify({output,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length}))
