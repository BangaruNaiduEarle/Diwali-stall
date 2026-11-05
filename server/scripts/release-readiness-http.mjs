import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {promisify} from 'node:util'
import {execFile} from 'node:child_process'
import {publicJwk,sign,offlineRequestId,transferScope} from '../../src/shared/handoverProtocol.js'
import {sellingLines} from '../../src/admin/offline/handover.js'

const root=path.resolve(process.argv[2]??'')
const isolation=JSON.parse(await readFile(path.join(root,'isolation.json'),'utf8'))
assert.ok(isolation.disposableDatabaseFile.startsWith(path.join(root,'persist')+path.sep))
const actors=JSON.parse(await readFile(path.join(root,'fixture-actors.json'),'utf8'))
const base='http://localhost:8793'
const results=[],state={requestIds:[],operationIds:[]}
const run=promisify(execFile)
const byId=id=>actors.find(actor=>actor.id===id)
async function check(name,fn){try{const detail=await fn();results.push({name,passed:true,detail});console.log('PASS '+name)}catch(error){results.push({name,passed:false,error:error.message});console.log('FAIL '+name+': '+error.message)}}
async function api(actor,route,{method='GET',body,revision,location=actor?.location,headers={},cookie=actor?.cookie,origin=base}={}){
  const response=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),Origin:origin,'Content-Type':'application/json','X-Admin-Season-Id':'season-2026',...(location?{'X-Admin-Location-Id':location}:{}),...(revision==null?{}:{'If-Match':String(revision)}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={error:'non_json_response',message:text.slice(0,180)}}
  return {status:response.status,data,headers:response.headers}
}
const okay=result=>{assert.ok(result.status>=200&&result.status<300,JSON.stringify({status:result.status,...result.data}));return result.data}
async function login(actor){const result=await api(null,'/api/admin/auth/login',{method:'POST',body:{email:actor.email,password:actor.password}});okay(result);actor.cookie=result.headers.get('set-cookie').split(';')[0]}
const detail=async(actor,id)=>okay(await api(actor,'/api/admin/customer-requests/'+id))
async function currentRevision(actor,id){const data=await detail(actor,id);return data.request.revision}
async function checkout(actor,{items=[{productId:'P880001',quantity:2,unitType:'box'}],assigneeUserId}={}){
  const key='rr-'+crypto.randomUUID(),body={customer:{name:'Release HTTP Fixture',mobile:'9876543210'},items,pricingMode:'selling',...(assigneeUserId?{assigneeUserId}:{})}
  const data=okay(await api(actor,'/api/admin/quick-bill/checkout',{method:'POST',body,headers:{'Idempotency-Key':key}}));state.requestIds.push(data.request.id);return data
}
async function d1(sql,{failure=false}={}){
  const args=[path.resolve('server/node_modules/wrangler/bin/wrangler.js'),'d1','execute','diwali-release-disposable','--local','--config',path.join(root,'wrangler.toml'),'--persist-to',isolation.persist,'--command',sql,'--json']
  try{const result=await run(process.execPath,args,{env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6,windowsHide:true});if(failure)throw Error('Expected a database guard to reject this write');return JSON.parse(result.stdout)}catch(error){const diagnostic=[error.stdout,error.stderr,error.message].filter(Boolean).join('\n');if(failure&&/SQLITE_CONSTRAINT|append_only|immutable|retained|UNIQUE constraint|workflow_events_append_only/.test(diagnostic))return {rejected:true};throw Error(diagnostic.slice(-600))}
}
async function device(actor){
  const deviceId='rr-device-'+crypto.randomUUID(),deviceToken=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')
  okay(await api(actor,'/api/admin/offline/devices',{method:'POST',body:{deviceId,deviceToken}}))
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
  const preparation=okay(await api(actor,'/api/admin/offline/handover/prepare',{method:'POST',body:{deviceId,deviceToken,publicKey:publicJwk(await crypto.subtle.exportKey('jwk',pair.publicKey))}}))
  const catalogue=okay(await api(actor,'/api/admin/offline/catalogue'))
  return {actor,deviceId,deviceToken,pair,preparation,catalogue,scope:{businessId:'rr-business',locationId:actor.location,seasonId:'season-2026',userId:actor.id,deviceId}}
}
function operation(device,kind,body,extra={}){const op={operationId:crypto.randomUUID(),kind,body,scope:device.scope,deviceToken:device.deviceToken,capturedRole:device.actor.role,occurredAt:new Date().toISOString(),...extra};state.operationIds.push(op.operationId);return op}
async function send(device,op){return api(device.actor,'/api/admin/offline/sync',{method:'POST',body:op})}
function createOperation(device,quantity=1){
  const items=[{productId:'P880001',quantity,unitType:'box'}]
  return operation(device,'CREATE',{customer:{name:'Release Offline Fixture',mobile:'9876543210'},items,pricingMode:'selling'},{catalogue:device.catalogue.products.filter(product=>product.id==='P880001'),lineSnapshots:sellingLines(items,device.catalogue.products,crypto.randomUUID())})
}
async function envelope(sender,recipient,{pack=false,requestId,revision}={}){
  const sourceOperationId=revision==null?crypto.randomUUID():null
  const items=pack?[{lineId:crypto.randomUUID(),familyPackId:'FP880001',quantity:2,unitType:'box',familyPackSnapshot:sender.catalogue.familyPacks.find(pack=>pack.familyPackId==='FP880001')}]:[{productId:'P880001',quantity:2,unitType:'box'}]
  const payload={v:pack?2:1,transferId:crypto.randomUUID(),scope:transferScope(sender.scope),requestId:requestId??await offlineRequestId(sender.scope,sourceOperationId),revision:revision??null,sourceOperationId,creatorUserId:sender.actor.id,recipientUserId:recipient.actor.id,occurredAt:new Date().toISOString(),sourceOccurredAt:new Date().toISOString(),customer:{name:'Release QR Fixture',mobile:'9876543210'},lines:sellingLines(items,sender.catalogue.products,crypto.randomUUID())}
  // Both timestamps are client-reported; one capture avoids millisecond inversion.
  payload.sourceOccurredAt=payload.occurredAt
  return {payload,certificate:sender.preparation.certificate,signature:await sign(payload,sender.pair.privateKey)}
}
function acceptOperation(receiver,transfer){return operation(receiver,'HANDOVER',{transfer},{requestId:transfer.payload.requestId,expectedRevision:transfer.payload.revision,catalogue:receiver.catalogue.products.filter(product=>transfer.payload.lines.some(line=>line.productId===product.id||line.packSnapshot.components?.some(component=>component.productId===product.id)))})}
let admin,owner,superAdmin,ownerB,platform,onlineId,onlineRevision,devices
await check('password authentication and actual Worker session scope',async()=>{for(const actor of actors)await login(actor);admin=byId('rr-admin-1');owner=byId('rr-owner-a');superAdmin=byId('rr-super-a');ownerB=byId('rr-owner-b');platform=byId('rr-platform');const session=okay(await api(admin,'/api/admin/session'));assert.equal(session.activeLocationId,'rr-a');assert.equal(session.effectiveRole,'admin');assert.equal((await api(null,'/api/admin/offline/catalogue')).status,401)})
await check('Stall A/B catalogues and membership isolation',async()=>{const a=okay(await api(admin,'/api/admin/offline/catalogue')),b=okay(await api(ownerB,'/api/admin/offline/catalogue'));assert.deepEqual(a.products.map(row=>row.id).sort(),['P880001','P880003']);assert.deepEqual(b.products.map(row=>row.id),['P880002']);assert.equal((await api(admin,'/api/admin/offline/catalogue',{location:'rr-b'})).status,403);assert.equal((await api(ownerB,'/api/admin/offline/catalogue',{location:'rr-a'})).status,403);assert.equal((await api(platform,'/api/admin/offline/catalogue',{location:'rr-a'})).status,403);const p=okay(await api(platform,'/api/admin/session',{location:null}));assert.equal(p.platformAdmin,true)})
await check('Admin creates, adds/removes products and changes quantities; financial and finalization restrictions',async()=>{
  const created=await checkout(admin);onlineId=created.request.id;let revision=await currentRevision(admin,onlineId)
  const change=okay(await api(admin,`/api/admin/customer-requests/${onlineId}/adjust-bill`,{method:'PATCH',revision,body:{items:[{productId:'P880001',quantity:3,unitType:'box'},{productId:'P880003',quantity:2,unitType:'box'}]}}));revision=change.request.revision
  const removed=okay(await api(admin,`/api/admin/customer-requests/${onlineId}/adjust-bill`,{method:'PATCH',revision,body:{items:[{productId:'P880001',quantity:3,unitType:'box'}]}}));revision=removed.request.revision
  const restored=okay(await api(admin,`/api/admin/customer-requests/${onlineId}/adjust-bill`,{method:'PATCH',revision,body:{items:[{productId:'P880001',quantity:3,unitType:'box'},{productId:'P880003',quantity:2,unitType:'box'}]}}));onlineRevision=restored.request.revision
  assert.equal((await api(admin,`/api/admin/customer-requests/${onlineId}/adjust-bill`,{method:'PATCH',revision:onlineRevision,body:{items:[{productId:'P880001',quantity:1,unitType:'box',unitRatePaise:1}],discountPaise:1}})).status,403)
  assert.equal((await api(admin,`/api/admin/customer-requests/${onlineId}/finalize`,{method:'PATCH',body:{},revision:onlineRevision})).status,403)
  assert.ok([403,404].includes((await api(ownerB,`/api/admin/customer-requests/${onlineId}`)).status))
})
await check('online handover, Owner financial adjustment and separate Super Admin finalizer',async()=>{
  okay(await api(admin,`/api/admin/customer-requests/${onlineId}/assign`,{method:'PATCH',revision:onlineRevision,body:{assigneeUserId:owner.id}}))
  const changed=okay(await api(owner,`/api/admin/customer-requests/${onlineId}/adjust-bill`,{method:'PATCH',revision:await currentRevision(owner,onlineId),body:{items:[{productId:'P880001',quantity:3,unitType:'box',unitRatePaise:9000},{productId:'P880003',quantity:2,unitType:'box',unitRatePaise:18000}],discountPaise:3000}}));assert.equal(changed.quotation.totalPaise,60000)
  okay(await api(owner,`/api/admin/customer-requests/${onlineId}/quotation/customer-agreed-amount`,{method:'PATCH',body:{acceptedAmountInr:'550'}}))
  okay(await api(superAdmin,`/api/admin/customer-requests/${onlineId}/finalize`,{method:'PATCH',body:{},revision:await currentRevision(superAdmin,onlineId)}))
  const payments=okay(await api(owner,`/api/admin/customer-requests/${onlineId}/payments`));assert.equal(payments.summary.amountDuePaise,55000)
  const history=okay(await api(owner,`/api/admin/customer-requests/${onlineId}/history?limit=100`));state.onlineHistory=history
  const final=await detail(owner,onlineId);assert.equal(final.request.creatorUserId,admin.id);assert.equal(final.request.assignedToUserId,owner.id);assert.equal(final.request.closedByEmail,superAdmin.email)
})
await check('HOLD, partial/multiple-method/full payments, balances and duplicate retries',async()=>{
  const entries=[['HOLD',0,null],['PAYMENT',10000,'CASH'],['RELEASE_HOLD',0,null],['PAYMENT',15000,'UPI'],['PAYMENT',20000,'CARD'],['PAYMENT',10000,'BANK']]
  for(const [entryType,amountPaise,paymentMethod] of entries){const body={operationId:crypto.randomUUID(),entryType,amountPaise,recordingMode:'ONLINE',...(paymentMethod?{paymentMethod,...(paymentMethod==='CASH'?{}:{reference:'rr-'+crypto.randomUUID()})}:{}),details:'Release fixture'};const recorded=await api(owner,`/api/admin/customer-requests/${onlineId}/payments`,{method:'POST',revision:await currentRevision(owner,onlineId),body});okay(recorded);const replay=okay(await api(owner,`/api/admin/customer-requests/${onlineId}/payments`,{method:'POST',revision:0,body}));assert.equal(replay.idempotentReplay,true)}
  const payments=okay(await api(owner,`/api/admin/customer-requests/${onlineId}/payments`));assert.equal(payments.summary.outstandingPaise,0);assert.equal(payments.summary.receivedPaise,55000);assert.equal(payments.summary.paymentStatus,'PAID');assert.equal(payments.entries.length,6)
  assert.equal((await api(admin,`/api/admin/customer-requests/${onlineId}/payments`,{method:'POST',revision:await currentRevision(admin,onlineId),body:{operationId:crypto.randomUUID(),entryType:'PAYMENT',amountPaise:1,paymentMethod:'CASH',recordingMode:'ONLINE'}})).status,403)
  const full=await checkout(owner);const id=full.request.id
  okay(await api(owner,`/api/admin/customer-requests/${id}/quotation/customer-agreed-amount`,{method:'PATCH',body:{acceptedAmountInr:'100'}}));okay(await api(owner,`/api/admin/customer-requests/${id}/finalize`,{method:'PATCH',body:{},revision:await currentRevision(owner,id)}))
  okay(await api(owner,`/api/admin/customer-requests/${id}/payments`,{method:'POST',revision:await currentRevision(owner,id),body:{operationId:crypto.randomUUID(),entryType:'PAYMENT',amountPaise:10000,paymentMethod:'CASH',recordingMode:'ONLINE'}}));assert.equal(okay(await api(owner,`/api/admin/customer-requests/${id}/payments`)).summary.paymentStatus,'PAID')
})
await check('private pricing redaction and unsafe-origin rejection',async()=>{const restricted=await detail(admin,onlineId);assert.equal(/"(?:purchaseRatePaise|purchaseRateInr|internalFinancialSummary|profitPaise|internalPricingPreview)"/.test(JSON.stringify(restricted)),false);const catalogue=okay(await api(admin,'/api/admin/products'));assert.equal(/purchaseRate|profit|margin/.test(JSON.stringify(catalogue)),false);assert.equal((await api(owner,'/api/admin/offline/devices',{method:'POST',body:{},origin:'https://untrusted.invalid'})).status,403)})
await check('four Admin devices create independent requests concurrently through real D1; unchanged retry identities',async()=>{
  devices=await Promise.all([1,2,3,4].map(index=>device(byId('rr-admin-'+index))))
  const operations=devices.map((dev,index)=>createOperation(dev,index+1));const responses=await Promise.all(devices.map((dev,index)=>send(dev,operations[index])))
  const data=responses.map(okay);assert.equal(new Set(data.map(row=>row.requestId)).size,4);state.requestIds.push(...data.map(row=>row.requestId))
  for(let index=0;index<4;index++)assert.equal(okay(await send(devices[index],operations[index])).idempotentReplay,true)
})
let receiving,qrSender,qrTransfer,qrAccepted
await check('signed QR transfer and Family Pack acceptance use the existing claim/receipt transaction',async()=>{
  receiving=await device(owner);qrSender=devices[0];qrTransfer=await envelope(qrSender,receiving,{pack:true});const input=acceptOperation(receiving,qrTransfer);qrAccepted=okay(await send(receiving,input));assert.equal(qrAccepted.requestId,qrTransfer.payload.requestId);state.requestIds.push(qrAccepted.requestId);assert.equal(okay(await send(receiving,input)).idempotentReplay,true)
  const snapshot=okay(await api(owner,'/api/admin/offline/requests/'+qrAccepted.requestId));assert.equal(snapshot.request.items[0].packSnapshot.catalogueVersion,qrTransfer.payload.lines[0].packSnapshot.catalogueVersion);state.packRequestId=qrAccepted.requestId
})
await check('tampered payload and wrong intended recipient cannot commit',async()=>{const valid=await envelope(qrSender,receiving),tampered=structuredClone(valid);tampered.payload.lines[0].quantity++;assert.equal((await send(receiving,acceptOperation(receiving,tampered))).status,400);const superDevice=await device(superAdmin);assert.equal((await send(superDevice,acceptOperation(superDevice,valid))).status,400)})
await check('competing offline QR claims preserve one server claim and detect the loser',async()=>{const other=await device(owner),transfer=await envelope(qrSender,receiving);const responses=await Promise.all([send(receiving,acceptOperation(receiving,transfer)),send(other,acceptOperation(other,transfer))]);assert.equal(responses.filter(result=>result.status===200).length,1);assert.equal(responses.filter(result=>result.status===409).length,1);state.requestIds.push(responses.find(result=>result.status===200).data.requestId)})
await check('offline agreement, closure, payment and stale Admin revision after Owner finalization',async()=>{const agreed=okay(await send(receiving,operation(receiving,'AGREEMENT',{acceptedAmountPaise:80000},{requestId:qrAccepted.requestId,expectedRevision:qrAccepted.revision})));const closed=okay(await send(receiving,operation(receiving,'CLOSE',{}, {parentOperationId:agreed.operationId})));const payment=operation(receiving,'PAYMENT',{entryType:'PAYMENT',amountPaise:20000,paymentMethod:'CASH',recordingMode:'OFFLINE'},{parentOperationId:closed.operationId});okay(await send(receiving,payment));assert.equal(okay(await send(receiving,payment)).idempotentReplay,true);const stale=operation(qrSender,'EDIT',{items:[{familyPackId:'FP880001',quantity:4}]},{requestId:qrAccepted.requestId,expectedRevision:qrAccepted.revision,lineSnapshots:[{...qrTransfer.payload.lines[0],quantity:4}],catalogue:qrSender.catalogue.products});assert.equal((await send(qrSender,stale)).status,409)})
await check('competing closures cannot both commit',async()=>{const transfer=await envelope(qrSender,receiving);const accepted=okay(await send(receiving,acceptOperation(receiving,transfer)));const agreed=okay(await send(receiving,operation(receiving,'AGREEMENT',{acceptedAmountPaise:15000},{parentOperationId:accepted.operationId})));const other=await device(owner);const responses=await Promise.all([receiving,other].map(dev=>send(dev,operation(dev,'CLOSE',{}, {requestId:accepted.requestId,expectedRevision:agreed.revision}))));assert.equal(responses.filter(result=>result.status===200).length,1);assert.equal(responses.filter(result=>result.status===409).length,1);state.requestIds.push(accepted.requestId)})
await check('catalogue/revision conflicts and changed membership leave operations unacknowledged',async()=>{
  const stale=createOperation(devices[1]);stale.catalogue[0]={...stale.catalogue[0],selling_price_paise:1};assert.equal((await send(devices[1],stale)).status,409)
  await d1("UPDATE location_members SET disabled_at='release-test-revoked' WHERE admin_user_id='rr-admin-4' AND location_id='rr-a';")
  assert.equal((await send(devices[3],createOperation(devices[3]))).status,403)
  await d1("UPDATE location_members SET disabled_at=NULL WHERE admin_user_id='rr-admin-4' AND location_id='rr-a';")
  assert.equal((await api(admin,'/api/admin/offline/sync',{method:'POST',body:createOperation(devices[0]),cookie:'diwali_admin_session=expired-release-fixture'})).status,401)
})
await check('Family Pack catalogue drift rejects handover and preserves original accepted snapshot',async()=>{
  const transfer=await envelope(qrSender,receiving,{pack:true})
  const before=okay(await api(owner,'/api/admin/offline/requests/'+qrAccepted.requestId)).request.items[0].packSnapshot
  try{
    await d1("UPDATE family_packs SET selling_price_paise=45001 WHERE id='FP880001' AND location_id='rr-a';")
    assert.equal((await send(receiving,acceptOperation(receiving,transfer))).status,409)
    const after=okay(await api(owner,'/api/admin/offline/requests/'+qrAccepted.requestId)).request.items[0].packSnapshot
    assert.deepEqual(after,before)
  }finally{await d1("UPDATE family_packs SET selling_price_paise=45000 WHERE id='FP880001' AND location_id='rr-a';")}
})
await check('append-only constraints reject direct modifications in the disposable D1',async()=>{await d1(`UPDATE request_workflow_events SET event_type='rewritten' WHERE request_id='${onlineId}';`,{failure:true});await d1(`UPDATE request_payment_accounts SET amount_due_paise=1 WHERE request_id='${onlineId}';`,{failure:true});await d1(`UPDATE request_payment_ledger SET amount_paise=1 WHERE request_id='${onlineId}';`,{failure:true});await d1(`DELETE FROM request_handover_claims WHERE request_id='${qrAccepted.requestId}';`,{failure:true});await d1(`DELETE FROM offline_sync_receipts WHERE request_id='${qrAccepted.requestId}';`,{failure:true})})
await writeFile(path.join(root,'http-e2e-results.json'),JSON.stringify({base,results,state,counts:{passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length}},null,2))
await writeFile(path.join(root,'fixture-actors-authenticated.json'),JSON.stringify(actors,null,2))
console.log(JSON.stringify({passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,report:path.join(root,'http-e2e-results.json')}))
if(results.some(row=>!row.passed))process.exitCode=1
