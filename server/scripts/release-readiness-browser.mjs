import {spawn} from 'node:child_process'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createFrameCollector,verifyTransfer,publicJwk} from '../../src/shared/handoverProtocol.js'

const root=path.resolve(process.argv[2]??''),site='http://localhost:5193',worker='http://localhost:8793'
const isolation=JSON.parse(await readFile(path.join(root,'isolation.json'),'utf8'))
assert.ok(isolation.disposableDatabaseFile.startsWith(path.join(root,'persist')+path.sep))
const actors=JSON.parse(await readFile(path.join(root,'fixture-actors.json'),'utf8'))
const admin=actors.find(actor=>actor.id==='rr-admin-2'),owner=actors.find(actor=>actor.id==='rr-owner-a')
const results=[],blockedOrigins=new Set(),pending=new Map()
let browser,socket,sequence=0,interruptAgreement=false
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function launch(profile){
  const port=20000+Math.floor(Math.random()*10000)
  browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true})
  let target
  for(let index=0;index<100;index++){try{target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();break}catch{await delay(100)}}
  if(!target)throw Error('Chrome startup failed')
  socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  socket.onmessage=event=>{
    const message=JSON.parse(event.data)
    if(message.id){const handlers=pending.get(message.id);pending.delete(message.id);if(message.error)handlers.reject(Error(JSON.stringify(message.error)));else handlers.resolve(message.result)}
    if(message.method==='Fetch.requestPaused'){
      const url=new URL(message.params.request.url)
      let allowed=[site,worker].includes(url.origin)||['data:','blob:','about:'].includes(url.protocol)
      if(interruptAgreement&&url.pathname==='/api/admin/offline/sync'&&JSON.parse(message.params.request.postData??'{}').kind==='AGREEMENT'){interruptAgreement=false;allowed=false}
      if(!allowed)blockedOrigins.add(url.origin)
      call(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:message.params.requestId,...(allowed?{}:{errorReason:'BlockedByClient'})}).catch(()=>{})
    }
  }
  await call('Page.enable');await call('Network.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]})
}
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value}
async function waitFor(expression,seconds=25){for(let index=0;index<seconds*5;index++){try{if(await evaluate(expression))return}catch{}await delay(200)}throw Error('Timed out: '+expression+' | '+(await evaluate('document.body.innerText')).slice(-1600))}
async function close(){if(!socket||socket.readyState!==1)return;const current=browser,exited=new Promise(resolve=>current.once('exit',resolve));await call('Browser.close').catch(()=>{});await Promise.race([exited,delay(5000)]);socket.close()}
async function click(text){await waitFor(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()===${JSON.stringify(text)}&&!button.disabled)`);await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`)}
async function field(label,value){await evaluate(`(()=>{const label=Array.from(document.querySelectorAll('label')).find(label=>label.textContent.includes(${JSON.stringify(label)}));const input=label?.querySelector('input,textarea,select');if(!input)throw Error('Missing field');Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`)}
async function saved(){await waitFor("document.body.textContent.includes('Draft saved on this device')&&!document.body.textContent.includes('Saving draft')")}
async function offline(value){await call('Network.emulateNetworkConditions',{offline:value,latency:0,downloadThroughput:value?0:-1,uploadThroughput:value?0:-1});await waitFor(`navigator.onLine===${!value}`)}
async function navigateOfflinePage(){await call('Page.navigate',{url:site+'/admin/offline'});await waitFor("document.querySelector('h1')?.textContent==='Offline billing workspace'")}
async function selectWorkspace(){
  await call('Page.navigate',{url:site+'/admin/workspace'})
  await waitFor("Array.from(document.querySelectorAll('select')).some(select=>Array.from(select.options).some(option=>option.value==='rr-a'))")
  await evaluate("(()=>{const select=Array.from(document.querySelectorAll('select')).find(select=>Array.from(select.options).some(option=>option.value==='rr-a'));select.value='rr-a';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor("document.body.textContent.includes('Release Stall A')")
  await evaluate("document.querySelector('a[href=\"/admin/offline\"]').click()")
  await waitFor("document.querySelector('h1')?.textContent==='Offline billing workspace'")
}
async function prepare(actor){
  await call('Page.navigate',{url:site+'/admin/login'});await waitFor("Boolean(document.querySelector('input[type=email]'))")
  await field('Email',actor.email);await field('Password',actor.password);await click('Sign in');await waitFor("location.pathname!=='/admin/login'")
  await waitFor("Array.from(document.querySelectorAll('select')).some(select=>Array.from(select.options).some(option=>option.value==='rr-a'))")
  await evaluate("(()=>{const select=Array.from(document.querySelectorAll('select')).find(select=>Array.from(select.options).some(option=>option.value==='rr-a'));select.value='rr-a';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor("document.body.textContent.includes('Release Stall A')")
  await evaluate("(()=>{const link=document.querySelector('a[href=\"/admin/offline\"]');if(!link)throw Error('Offline navigation link missing');link.click()})()")
  await waitFor("document.querySelector('h1')?.textContent==='Offline billing workspace'")
  await click('Prepare / refresh selected stall for offline use');await waitFor("document.body.textContent.includes('Offline page reload is ready.')")
  await click('Prepare / refresh secure QR handover online');await waitFor("document.body.textContent.includes('QR signing and verification are prepared')")
}
async function dbSummary(){return evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('diwali-offline-billing-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','outbox'],'readonly'),drafts=tx.objectStore('drafts').getAll(),outbox=tx.objectStore('outbox').getAll();tx.oncomplete=()=>{const draft=drafts.result.find(row=>row.body.customer.name==='Release Browser QR'),rows=outbox.result.filter(row=>row.draftId===draft?.draftId).sort((a,b)=>a.order-b.order);db.close();resolve({draftId:draft?.draftId,requestId:draft?.requestId,transferId:draft?.handover?.transferId,packVersion:draft?.body.items.find(item=>item.familyPackId)?.familyPackSnapshot.catalogueVersion,rows:rows.map(row=>({id:row.payload.operationId,kind:row.payload.kind,state:row.state,lastError:row.lastError,requestId:row.acknowledgement?.requestId}))})}}})`)}
function passed(name,detail){results.push({name,passed:true,detail});console.log('PASS '+name)}
const browserRun=Date.now(),adminProfile=path.join(root,'browser-admin-'+browserRun),ownerProfile=path.join(root,'browser-owner-'+browserRun)
await mkdir(adminProfile);await mkdir(ownerProfile)
let transfer,before,after
try{
  await launch(adminProfile);await prepare(admin);passed('Admin browser password login, authorized stall preparation, persistent IndexedDB and service-worker preparation against real Worker')
  await offline(true);await click('New local request');await field('Customer name','Release Browser QR');await field('Mobile','9876543210');await field('Saved catalogue','P880001');await click('Add product');await field('Saved Family Pack / variant','FP880001');await click('Add Family Pack with captured snapshot');await saved();await click('Queue request creation');await waitFor("document.body.textContent.includes('1 pending')")
  await field('Intended recipient',owner.id);await click('Generate request handover QR');await waitFor("document.querySelector('[aria-label=\"Complete QR frame sequence\"]')?.value.length>0")
  const frames=await evaluate("document.querySelector('[aria-label=\"Complete QR frame sequence\"]').value")
  const collect=createFrameCollector();for(const frame of frames.split('\n'))transfer=collect(frame).envelope??transfer
  const devVars=await readFile(path.join(root,'.dev.vars'),'utf8'),privateJwk=JSON.parse(devVars.match(/HANDOVER_SIGNING_JWK='([^']+)'/)[1])
  await verifyTransfer(transfer,{rootKey:publicJwk(privateJwk),scope:transfer.payload.scope,recipientUserId:owner.id})
  assert.equal(transfer.payload.v,2);assert.equal(/purchase|profit|margin|privateKey|deviceToken/.test(JSON.stringify(transfer)),false)
  passed('offline Admin creates mixed product/Family Pack request, persists creation, generates multipart QR and verifies actual server certificate')
  await close();await launch(adminProfile);await offline(true);await navigateOfflinePage();await waitFor("document.body.textContent.includes('Release Browser QR')&&document.body.textContent.includes('1 pending')");passed('prepared Admin PWA reopens offline after full Chrome process restart')
  await close();await launch(ownerProfile);await prepare(owner);await offline(true)
  try{await call('Browser.setPermission',{permission:{name:'camera'},setting:'denied',origin:site});await click('Start camera scanner');await waitFor("document.body.textContent.includes('Camera permission was denied')||document.body.textContent.includes('No camera was found')");passed('desktop camera refusal/unsupported capture produces actionable error')}catch(error){results.push({name:'desktop camera error check',passed:false,error:error.message})}
  await evaluate(`(()=>{const area=document.querySelector('[aria-label="QR frames to verify"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,${JSON.stringify(frames)});area.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('Verify all pasted frames');await waitFor("Boolean(document.body.textContent.includes('Verified request preview')&&document.querySelector('[aria-label=\"Complete Family Pack snapshot\"]'))")
  await click('Accept provisionally and save to outbox');await waitFor("document.body.textContent.includes('1 pending')&&document.body.textContent.includes('Accepted provisionally')")
  passed('Owner verifies complete signed multipart preview and accepts mixed Family Pack request without network')
  await click('Verify all pasted frames');await waitFor("document.body.textContent.includes('Verified request preview')");await click('Accept provisionally and save to outbox');await waitFor("document.body.textContent.includes('already accepted locally')");assert.equal((await dbSummary()).rows.length,1);passed('duplicate offline scan preserves one handover and original local draft')
  await field('Selling price override','90');await field('Discount for next item adjustment','10');await saved();await click('Queue item adjustments');await waitFor("document.body.textContent.includes('2 pending')")
  await field('Customer-agreed amount','500');await saved();await click('Queue agreed amount');await waitFor("document.body.textContent.includes('3 pending')");await click('Queue closure');await waitFor("document.body.textContent.includes('4 pending')")
  await field('Received amount','100');await click('Save payment to outbox');await waitFor("document.body.textContent.includes('5 pending')")
  before=await dbSummary();assert.deepEqual(before.rows.map(row=>row.kind),['HANDOVER','EDIT','AGREEMENT','CLOSE','PAYMENT']);assert.equal(before.requestId,transfer.payload.requestId);assert.equal(before.packVersion,transfer.payload.lines.find(line=>line.familyPackId).packSnapshot.catalogueVersion)
  passed('Owner captures financial adjustment, agreement, finalization and partial payment into durable offline dependency chain')
  await close();await launch(ownerProfile);await offline(true);await navigateOfflinePage();await waitFor("document.body.textContent.includes('Release Browser QR')&&document.body.textContent.includes('5 pending')")
  after=await dbSummary();assert.deepEqual(after.rows.map(row=>row.id),before.rows.map(row=>row.id));assert.equal(after.packVersion,before.packVersion);passed('full Owner browser restart preserves every queued identity and original Family Pack snapshot')
  await offline(false);await selectWorkspace();interruptAgreement=true;await click('Synchronize pending operations')
  await waitFor("document.body.textContent.includes('2 synced')&&document.body.textContent.includes('3 pending')")
  const partial=await dbSummary();assert.deepEqual(partial.rows.map(row=>row.state),['synced','synced','pending','pending','pending'])
  assert.deepEqual(partial.rows.map(row=>row.id),before.rows.map(row=>row.id));passed('interrupted third synchronization preserves acknowledged prefix and all unsent dependent operations')
  await delay(2500);await click('Synchronize pending operations');await waitFor("document.body.textContent.includes('5 synced')",60)
  after=await dbSummary();assert.ok(after.rows.every(row=>row.state==='synced'),JSON.stringify(after.rows));assert.ok(after.rows.every(row=>row.requestId===transfer.payload.requestId));passed('reconnection synchronizes actual browser outbox through real Worker/D1 with original request identity')
  const summary=await evaluate(`fetch(${JSON.stringify(worker+'/api/admin/customer-requests/'+transfer.payload.requestId+'/payments')},{credentials:'include',headers:{'X-Admin-Season-Id':'season-2026','X-Admin-Location-Id':'rr-a'}}).then(response=>response.json())`)
  assert.equal(summary.summary.amountDuePaise,50000);assert.equal(summary.summary.receivedPaise,10000);assert.equal(summary.summary.outstandingPaise,40000);assert.equal(summary.entries.length,1);passed('actual browser final bill/payment totals exclude reference ₹500 and contain one partial payment')
  const cachePaths=await evaluate("(async()=>{const names=await caches.keys();const entries=[];for(const name of names.filter(name=>name.startsWith('diwali-offline-shell-'))){const cache=await caches.open(name);entries.push(...(await cache.keys()).map(request=>new URL(request.url).pathname))}return entries})()")
  assert.ok(cachePaths.length>0&&cachePaths.every(route=>route==='/admin/offline'||route==='/manifest.webmanifest'||route.startsWith('/assets/')||route.startsWith('/icons/')));passed('service-worker shared caches contain only allowlisted shell/static assets')
  const files=await import('node:fs/promises');const jsNames=await files.readdir(path.join(root,'frontend-dist/assets'));let bundle='';for(const name of jsNames)if(name.endsWith('.js'))bundle+=await readFile(path.join(root,'frontend-dist/assets',name),'utf8')
  assert.equal(bundle.includes(privateJwk.d),false);assert.equal(JSON.stringify(transfer).includes(privateJwk.d),false);passed('generated server private signing key is absent from frontend bundle and QR')
  await close();await launch(adminProfile);await selectWorkspace();await click('Synchronize pending operations');await waitFor("document.body.textContent.includes('Release Browser QR')");await waitFor("document.body.textContent.includes('failed / conflict')&&document.body.textContent.includes('CREATE · conflict')",60)
  const conflict=await dbSummary();assert.equal(conflict.rows[0].state,'conflict');passed('stale Admin source creation after Owner finalization becomes preserved explicit conflict')
}catch(error){results.push({name:'browser end-to-end dependent workflow',passed:false,error:error.message});console.log('FAIL '+error.message)}finally{await close()}
await writeFile(path.join(root,'browser-e2e-results.json'),JSON.stringify({site,worker,profiles:{adminProfile,ownerProfile},results,transferId:transfer?.payload.transferId,requestId:transfer?.payload.requestId,before,after,blockedOrigins:[...blockedOrigins]},null,2))
console.log(JSON.stringify({passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,report:path.join(root,'browser-e2e-results.json')}))
if(results.some(row=>!row.passed))process.exitCode=1
