import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.argv[2]), { directory } = JSON.parse(await readFile(path.join(root,'phase4-current.json'),'utf8'))
assert.ok(directory.startsWith(root + path.sep) && path.basename(directory).startsWith('p4-'))
const state = JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'))
const progressFile = path.join(directory,'http-progress.json')
let progress
try { progress = JSON.parse(await readFile(progressFile,'utf8')) } catch(error) { if(error.code!=='ENOENT')throw error; progress={results:[],requests:[],saved:{}} }
const { results, requests, saved } = progress, u = state.actors, base = 'http://localhost:8793'
async function save() { await writeFile(progressFile,JSON.stringify(progress,null,2)) }
async function api(actor, route, { method='GET', body, revision, location=actor?.location, season=state.season, headers={} }={}) {
  const response = await fetch(base+route,{method,headers:{Cookie:actor?.cookie??'',Origin:base,'Content-Type':'application/json','X-Admin-Season-Id':season,...(location?{'X-Admin-Location-Id':location}:{}),...(revision==null?{}:{'If-Match':String(revision)}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})})
  let data; try{data=await response.json()}catch{data={error:'non_json'}}
  requests.push({actor:actor?.id,route,method,location,season,status:response.status,error:data.error})
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]}
}
const okay=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.data}
const detail=async(actor,id,options)=>okay(await api(actor,'/api/admin/customer-requests/'+id,options))
const history=async(actor,id,options)=>okay(await api(actor,`/api/admin/customer-requests/${id}/history?limit=100`,options))
const payments=async(actor,id,options)=>okay(await api(actor,`/api/admin/customer-requests/${id}/payments?limit=100`,options))
const quote=async(actor,id)=>okay(await api(actor,`/api/admin/customer-requests/${id}/quotation`)).quotation
const payment=(amount,extra={})=>({operationId:crypto.randomUUID(),entryType:'PAYMENT',amountPaise:amount,recordingMode:'ONLINE',paymentMethod:'CASH',...extra})
async function record(actor,id,body,options={}) { return api(actor,`/api/admin/customer-requests/${id}/payments`,{method:'POST',body,revision:(await payments(actor,id)).summary.revision,...options}) }
async function check(id,name,run) {
  if(results.some(row=>row.id===id&&row.status==='PASS')) {console.log('RETAIN '+id);return}
  for(let index=results.length-1;index>=0;index--)if(results[index].id===id){(progress.priorAttempts??=[]).push(results[index]);results.splice(index,1)}
  try {const evidence=await run();results.push({id,name,status:'PASS',evidence});console.log('PASS '+id)}
  catch(error){results.push({id,name,status:'FAIL',error:error.stack});console.log('FAIL '+id+' '+error.message);await save();throw error}
  await save()
}
async function checkout(actor,key,body) {return okay(await api(actor,'/api/admin/quick-bill/checkout',{method:'POST',body,headers:{'Idempotency-Key':key}}))}
function body(actor,amount=10001) {return {customer:{name:'Phase 4 '+crypto.randomUUID(),mobile:'9876543210',area:'Fixture area',note:'Acceptance customer details'},items:[{productId:actor.location===state.b?state.products.b:state.products.a,quantity:1,unitType:'box'}],pricingMode:'bargain',acceptedAmountPaise:amount}}
async function finalized(name,actor,amount=10001) {
  if(!saved[name]) {const input=body(actor,amount),key=crypto.randomUUID();saved[name]={input,key};await save()}
  const entry=saved[name]
  if(!entry.id){const created=await checkout(actor,entry.key,entry.input);entry.id=created.request.id;entry.quotationId=created.quotation.id;await save()}
  const d=await detail(actor,entry.id)
  if(d.request.status!=='closed')okay(await api(actor,`/api/admin/customer-requests/${entry.id}/finalize`,{method:'PATCH',revision:d.request.revision,body:{}}))
  return entry.id
}
for(const actor of Object.values(u)){const r=await api(null,'/api/admin/auth/login',{method:'POST',body:{email:actor.email,password:actor.password}});okay(r);actor.cookie=r.cookie}

await check('P4-01','Admin request preserves customer details, stable line IDs and quantity/add/remove history',async()=>{
  if(!saved.lifecycle){saved.lifecycle={key:crypto.randomUUID(),input:{customer:{name:'Phase 4 lifecycle customer',mobile:'9876543210',area:'Phase 4 area',note:'Preserve customer note'},items:[{productId:state.products.a,quantity:1,unitType:'box'}],pricingMode:'selling'}};await save()}
  const fixture=saved.lifecycle
  const created=await checkout(u.admin,fixture.key,fixture.input);fixture.id=created.request.id;fixture.quotationId=created.quotation.id;await save()
  let d=await detail(u.admin,fixture.id);const line=d.request.items[0].lineId;assert.ok(line)
  assert.equal(d.request.customerName,'Phase 4 lifecycle customer');assert.equal(d.request.customerPhone,'9876543210');assert.equal(d.request.customerArea,'Phase 4 area');assert.equal(d.request.customerNote,'Preserve customer note')
  for(const items of [[{productId:state.products.a,quantity:3,unitType:'box'},{productId:state.products.extra,quantity:2,unitType:'box'}],[{productId:state.products.a,quantity:2,unitType:'box'}]]) {
    okay(await api(u.admin,`/api/admin/customer-requests/${fixture.id}/adjust-bill`,{method:'PATCH',revision:d.request.revision,body:{items}}));d=await detail(u.admin,fixture.id)
    assert.equal(d.request.items.find(row=>row.productId===state.products.a).lineId,line)
  }
  const q=await quote(u.admin,fixture.id);assert.equal(q.items[0].requestLineId,line);assert.equal(q.totalPaise,20002)
  const h=await history(u.owner,fixture.id);assert.ok(h.events.some(row=>row.eventType==='item_added'));assert.ok(h.events.some(row=>row.eventType==='item_removed'))
  assert.deepEqual(h.events.map(row=>row.revision),Array.from({length:h.events.length},(_,i)=>i+1));assert.equal(h.revision,d.request.revision)
  fixture.lineId=line;await save()
  return {requestId:fixture.id,lineId:line,quantity:2,customerDetailsPreserved:true,events:h.events.map(row=>({eventId:row.eventId,type:row.eventType,revision:row.revision})),totalPaise:q.totalPaise}
})
await check('P4-02','Admin financial aliases are rejected and read/history surfaces redact sensitive estimates',async()=>{
  const id=saved.lifecycle.id,d=await detail(u.admin,id),before=await history(u.owner,id)
  const items=[{productId:state.products.a,quantity:2,unitType:'box'}],statuses=[]
  for(const input of [{items:[{...items[0],unitRatePaise:1}]},{items,discountPaise:1},{items,purchasePricePaise:1},{items,profitPaise:1},{items,margin:99},{items,acceptedAmountInr:'1.00'}]) {
    const r=await api(u.admin,`/api/admin/customer-requests/${id}/adjust-bill`,{method:'PATCH',revision:d.request.revision,body:input});assert.equal(r.status,403);statuses.push(r.status)
  }
  for(const route of [`/api/admin/customer-requests/${id}/finalize`,`/api/admin/customer-requests/${id}/quotation/customer-agreed-amount`]) assert.equal((await api(u.admin,route,{method:'PATCH',body:{acceptedAmountInr:'1.00'},revision:d.request.revision})).status,403)
  for(const kind of ['purchase-rate','private-rate'])for(const method of ['GET','PUT']) assert.equal((await api(u.admin,`/api/admin/products/${state.products.a}/${kind}`,{method,...(method==='PUT'?{body:{unitRateInr:1}}:{})})).status,403)
  for(const route of [`/api/admin/customer-requests/${id}`,`/api/admin/customer-requests/${id}/quotation`,`/api/admin/customer-requests/${id}/history?limit=100`,`/api/admin/customer-requests/${id}/payments`,`/api/admin/products`]) {
    const data=okay(await api(u.admin,route));assert.doesNotMatch(JSON.stringify(data),/purchase|profit|margin|finalSubtotal|bargainFloor/i)
  }
  assert.deepEqual(await history(u.owner,id),before)
  return {deniedAdjustmentCases:statuses.length,privateRateGetPutDenied:true,restrictedSurfaces:5,unchangedRevision:d.request.revision}
})
await check('P4-03','Authorized online handover and recipient edits resist stale updates and retry overwrites',async()=>{
  const id=saved.lifecycle.id,d=await detail(u.admin,id),revision=d.request.revision,route=`/api/admin/customer-requests/${id}/assign`
  assert.equal((await api(u.admin,route,{method:'PATCH',body:{assigneeUserId:u.owner.id}})).status,428)
  for(const recipient of [u.admin.id,u.ownerB.id]) assert.equal((await api(u.admin,route,{method:'PATCH',revision,body:{assigneeUserId:recipient}})).status,400)
  okay(await api(u.admin,route,{method:'PATCH',revision,body:{assigneeUserId:u.owner.id}}))
  let current=await detail(u.owner,id)
  const adjusted=okay(await api(u.owner,`/api/admin/customer-requests/${id}/adjust-bill`,{method:'PATCH',revision:current.request.revision,body:{items:[{productId:state.products.a,quantity:2,unitType:'box',unitRatePaise:9999}],discountPaise:101}}))
  assert.equal(adjusted.quotation.totalPaise,19897)
  const before=await history(u.owner,id)
  okay(await api(u.admin,route,{method:'PATCH',revision,body:{assigneeUserId:u.owner.id}}));assert.deepEqual(await history(u.owner,id),before)
  assert.equal((await api(u.admin,`/api/admin/customer-requests/${id}/adjust-bill`,{method:'PATCH',revision,body:{items:[{productId:state.products.a,quantity:99}]}})).status,409)
  assert.equal((await api(u.owner,`/api/admin/customer-requests/${id}/quotation/customer-agreed-amount`,{method:'PATCH',revision,body:{acceptedAmountInr:'0.01'}})).status,409)
  current=await detail(u.owner,id);assert.equal(current.request.creatorUserId,u.admin.id);assert.equal(current.request.assignedToUserId,u.owner.id);assert.equal(current.request.items[0].lineId,saved.lifecycle.lineId)
  assert.deepEqual(await history(u.owner,id),before)
  const event=before.events.find(row=>row.eventType==='request_assigned');assert.equal(event.actorUserId,u.admin.id)
  return {requestId:id,creator:u.admin.id,recipient:u.owner.id,handoverActor:event.actorUserId,stableLineId:saved.lifecycle.lineId,staleItemStatus:409,staleAgreementStatus:409,recipientTotalPaise:19897}
})
await check('P4-04','Checkout replay preserves recipient edits; distinct and simultaneous legitimate operations stay independent',async()=>{
  const f=saved.lifecycle,before=await history(u.owner,f.id),first=await checkout(u.admin,f.key,f.input)
  assert.equal(first.request.id,f.id);assert.equal(first.idempotentReplay,true);assert.deepEqual(await history(u.owner,f.id),before);assert.equal((await quote(u.owner,f.id)).totalPaise,19897)
  assert.equal((await api(u.admin,'/api/admin/quick-bill/checkout',{method:'POST',headers:{'Idempotency-Key':f.key},body:{...f.input,items:[{productId:state.products.a,quantity:2}]}})).status,409)
  const input=body(u.owner),key=crypto.randomUUID(),duplicates=await Promise.all(Array.from({length:4},()=>checkout(u.owner,key,input)))
  assert.equal(new Set(duplicates.map(row=>row.request.id)).size,1);assert.equal(new Set(duplicates.map(row=>row.quotation.id)).size,1);assert.equal(duplicates.filter(row=>!row.idempotentReplay).length,1)
  const independent=await Promise.all([checkout(u.owner,crypto.randomUUID(),input),checkout(u.owner,crypto.randomUUID(),input)])
  assert.notEqual(independent[0].request.id,independent[1].request.id)
  saved.checkoutConcurrency={duplicateId:duplicates[0].request.id,independentIds:independent.map(row=>row.request.id)}
  return {replayRequest:f.id,unchangedRecipientTotalPaise:19897,duplicateRequestIds:duplicates.map(row=>row.request.id),independentRequestIds:independent.map(row=>row.request.id)}
})
await check('P4-05','Permitted adjustments preserve catalogue snapshots and reference-only Final Price plus 500',async()=>{
  const id=saved.lifecycle.id
  okay(await api(u.owner,`/api/admin/products/${state.products.a}`,{method:'PATCH',body:{sellingPriceInr:999.99}}))
  const adjusted=okay(await api(u.super,`/api/admin/customer-requests/${id}/adjust-bill`,{method:'PATCH',revision:(await detail(u.super,id)).request.revision,body:{items:[{productId:state.products.a,quantity:2,unitType:'box',unitRatePaise:9901}],discountPaise:103}}))
  assert.equal(adjusted.quotation.totalPaise,19699)
  const d=await detail(u.super,id);assert.equal(d.request.items[0].unitPricePaise,10001)
  const q=await quote(u.super,id);assert.equal(q.internalFinancialSummary.purchaseSubtotalPaise,6002);assert.equal(q.internalFinancialSummary.profitPaise,13697)
  const h=await history(u.super,id);assert.ok(JSON.stringify(h).includes('9999'));assert.ok(JSON.stringify(h).includes('9901'))
  const referenceInput=body(u.owner,12345),created=await checkout(u.owner,crypto.randomUUID(),referenceInput);saved.referenceId=created.request.id
  const preview=okay(await api(u.owner,`/api/admin/customer-requests/${created.request.id}/adjust-bill/preview`,{method:'POST',body:{items:referenceInput.items}})).preview
  assert.equal(preview.bargainFloorPaise,preview.finalSubtotalPaise+50000);assert.notEqual(preview.bargainFloorPaise,12345)
  okay(await api(u.owner,`/api/admin/customer-requests/${created.request.id}/finalize`,{method:'PATCH',revision:(await detail(u.owner,created.request.id)).request.revision,body:{}}))
  const p=await payments(u.owner,created.request.id);assert.equal(p.summary.amountDuePaise,12345)
  return {requestId:id,originalUnitPaise:d.request.items[0].unitPricePaise,adjustedUnitPaise:9901,discountPaise:103,totalPaise:19699,purchaseEstimatePaise:6002,profitEstimatePaise:13697,referenceBillId:created.request.id,referencePaise:preview.bargainFloorPaise,amountDuePaise:p.summary.amountDuePaise}
})
await check('P4-06','Separate Super Admin finalization freezes agreed due with creator/recipient/finalizer history',async()=>{
  const id=saved.lifecycle.id
  okay(await api(u.super,`/api/admin/customer-requests/${id}/quotation/customer-agreed-amount`,{method:'PATCH',revision:(await detail(u.super,id)).request.revision,body:{acceptedAmountInr:'180.07'}}))
  okay(await api(u.super,`/api/admin/customer-requests/${id}/finalize`,{method:'PATCH',revision:(await detail(u.super,id)).request.revision,body:{}}))
  const d=await detail(u.owner,id),p=await payments(u.owner,id),h=await history(u.owner,id)
  assert.equal(d.request.status,'closed');assert.equal(d.request.creatorUserId,u.admin.id);assert.equal(d.request.assignedToUserId,u.owner.id);assert.equal(d.request.closedByEmail,u.super.email)
  assert.equal(p.summary.amountDuePaise,18007);assert.equal(p.summary.paymentStatus,'UNPAID');assert.equal(p.summary.receivedPaise,0);assert.equal(p.summary.outstandingPaise,18007);assert.equal(p.entries.length,0)
  const close=h.events.find(row=>row.eventType==='request_closed');assert.equal(close.actorUserId,u.super.id);assert.equal(close.businessId,state.business);assert.equal(close.locationId,state.a)
  const prior=h
  assert.ok([400,409].includes((await api(u.owner,`/api/admin/customer-requests/${id}/adjust-bill`,{method:'PATCH',revision:d.request.revision,body:{items:[{productId:state.products.a,quantity:5}]}})).status))
  assert.deepEqual(await history(u.owner,id),prior)
  return {requestId:id,businessId:state.business,locationId:state.a,seasonId:state.season,creator:u.admin.id,recipient:u.owner.id,finalizer:close.actorUserId,unpaidSummary:p.summary}
})
await check('P4-07','HOLD without payment and later five-method ONLINE/OFFLINE entries have exact balances and metadata',async()=>{
  const id=saved.lifecycle.id,hold={operationId:crypto.randomUUID(),entryType:'HOLD',amountPaise:0,recordingMode:'ONLINE',details:'Awaiting collection'}
  okay(await record(u.owner,id,hold));let p=await payments(u.owner,id)
  assert.equal(p.summary.paymentStatus,'HOLD');assert.equal(p.summary.receivedPaise,0);assert.equal(p.summary.outstandingPaise,18007);assert.equal(p.summary.paymentCount,0)
  okay(await record(u.owner,id,{operationId:crypto.randomUUID(),entryType:'RELEASE_HOLD',amountPaise:0,recordingMode:'ONLINE'}))
  const recorded=[]
  for(const [index,method]of ['CASH','UPI','CARD','BANK','OTHER'].entries()) {
    const amount=index===4?14001:1000+index,mode=index%2?'OFFLINE':'ONLINE',occurredAt='2026-11-03T05:00:00.000Z',deviceId=state.prefix+'-terminal-'+index
    const input=payment(amount,{paymentMethod:method,recordingMode:mode,...(method==='CASH'?{}:{reference:state.prefix+'-method-'+method}),occurredAt})
    const actor=index%2?u.super:u.owner
    const r=okay(await record(actor,id,input,{headers:{'X-Device-Id':deviceId,'X-Device-Occurred-At':occurredAt}}))
    assert.equal(r.entry.paymentMethod,method);assert.equal(r.entry.recordingMode,mode);assert.equal(r.entry.actorUserId,actor.id);assert.equal(r.entry.actorRole,actor.role);assert.equal(r.entry.deviceId,deviceId);assert.equal(r.entry.occurredAt,occurredAt);assert.ok(r.entry.receivedAt)
    recorded.push({paymentId:r.entry.paymentId,operationId:input.operationId,method,mode,amountPaise:amount,actor:actor.id,deviceId})
    p=await payments(u.owner,id);const paid=recorded.reduce((sum,row)=>sum+row.amountPaise,0);assert.equal(p.summary.receivedPaise,paid);assert.equal(p.summary.outstandingPaise,18007-paid);assert.equal(p.summary.paymentStatus,index===4?'PAID':'PARTIAL')
    if(index===0){const old=await history(u.owner,id);const replay=okay(await record(actor,id,input,{revision:0,headers:{'X-Device-Id':deviceId,'X-Device-Occurred-At':occurredAt}}));assert.equal(replay.idempotentReplay,true);assert.equal(replay.entry.paymentId,r.entry.paymentId);assert.deepEqual(await history(u.owner,id),old);saved.paidOperation={id,input,deviceId,occurredAt,actor:'owner'}}
  }
  assert.equal(p.summary.paymentCount,5);assert.equal(p.entries.length,7);assert.equal(p.summary.receivedPaise,18007)
  assert.equal((await detail(u.owner,id)).request.status,'closed')
  const page=okay(await api(u.owner,`/api/admin/customer-requests/${id}/payments?limit=2`)),next=okay(await api(u.owner,`/api/admin/customer-requests/${id}/payments?afterSequence=${page.entries.at(-1).sequence}&limit=2`))
  assert.equal(page.entries.length,2);assert.equal(next.entries.length,2);assert.equal(next.summary.receivedPaise,18007)
  return {requestId:id,holdDoesNotReceiveMoney:true,recorded,finalSummary:p.summary,historyEntries:p.entries.length,paginationBalanceUnchanged:true}
})
await check('P4-08','Concurrent payments with distinct IDs cannot overwrite revision or overpay',async()=>{
  const id=await finalized('race',u.owner,10001),rev=(await payments(u.owner,id)).summary.revision
  const inputs=[payment(7001),payment(7001)],responses=await Promise.all(inputs.map(input=>record(u.owner,id,input,{revision:rev})))
  assert.deepEqual(responses.map(row=>row.status).sort(),[201,409])
  const p=await payments(u.owner,id);assert.equal(p.summary.receivedPaise,7001);assert.equal(p.summary.outstandingPaise,3000);assert.equal(p.entries.length,1)
  const loser=responses.findIndex(row=>row.status===409),before=await history(u.owner,id)
  assert.equal((await record(u.owner,id,inputs[loser])).status,400)
  assert.deepEqual(await history(u.owner,id),before)
  okay(await record(u.super,id,payment(3000)))
  return {requestId:id,statuses:responses.map(row=>row.status),losingRetryStatus:400,finalSummary:(await payments(u.owner,id)).summary}
})
await check('P4-09','Same-operation concurrent retries and lost delivery produce one ledger entry and event',async()=>{
  const id=await finalized('samePayment',u.owner,12345),rev=(await payments(u.owner,id)).summary.revision,input=payment(12345),h=await history(u.owner,id)
  const responses=await Promise.all(Array.from({length:5},()=>record(u.owner,id,input,{revision:rev})))
  assert.ok(responses.every(row=>[200,201].includes(row.status)));assert.equal(new Set(responses.map(row=>row.data.entry.paymentId)).size,1);assert.equal(responses.filter(row=>!row.data.idempotentReplay).length,1)
  const p=await payments(u.owner,id),after=await history(u.owner,id);assert.equal(p.entries.length,1);assert.equal(after.events.length,h.events.length+1)
  const retry=okay(await record(u.owner,id,input,{revision:0}));assert.equal(retry.idempotentReplay,true);assert.equal(retry.entry.paymentId,p.entries[0].paymentId)
  const changed=await record(u.owner,id,{...input,amountPaise:1});assert.equal(changed.status,409)
  saved.uniquePayment={id,input,paymentId:p.entries[0].paymentId}
  return {requestId:id,statuses:responses.map(row=>row.status),paymentId:p.entries[0].paymentId,operationId:input.operationId,ledgerEntries:1,additionalEvents:1,changedInputStatus:409,recoveredOriginalResult:true}
})
await check('P4-10','Operation identity and normalized transaction references cannot be reused for another bill',async()=>{
  const id=await finalized('uniqueTarget',u.owner,10001),initial=await history(u.owner,id)
  assert.equal((await record(u.owner,id,{...saved.uniquePayment.input,amountPaise:1})).status,409);assert.deepEqual(await history(u.owner,id),initial)
  const reference=state.prefix+'-transaction-unique',first=await record(u.owner,id,payment(1000,{paymentMethod:'UPI',reference}));okay(first)
  const other=await finalized('referenceTarget',u.owner,10001),before=await history(u.owner,other)
  const duplicate=await record(u.owner,other,payment(1000,{paymentMethod:'UPI',reference:' '+reference.toLowerCase().split('').join(' ')+' '}));assert.equal(duplicate.status,409)
  assert.deepEqual(await history(u.owner,other),before);assert.equal((await payments(u.owner,other)).summary.receivedPaise,0)
  return {operationReuseStatus:409,normalizedReferenceStatus:409,targetRequest:other,targetReceivedPaise:0}
})
await check('P4-11','Payment validation rejects fractional/unsafe/negative values, mode-method confusion and missing revisions',async()=>{
  const id=await finalized('validation',u.owner,10001),before=await history(u.owner,id)
  const invalid=[payment(0),payment(-1),payment(0.1),payment(Number.MAX_SAFE_INTEGER+1),payment(1,{paymentMethod:'ONLINE'}),payment(1,{recordingMode:'CASH'}),payment(1,{paymentMethod:'UPI'}),payment(1,{recordingMode:'OFFLINE'}),payment(1,{occurredAt:'2026-02-30T00:00:00Z'}),{operationId:crypto.randomUUID(),entryType:'HOLD',amountPaise:1,recordingMode:'ONLINE'},payment(1,{businessId:state.business}),payment(10002)]
  for(const input of invalid)assert.equal((await record(u.owner,id,input)).status,400)
  assert.equal((await api(u.owner,`/api/admin/customer-requests/${id}/payments`,{method:'POST',body:payment(1)})).status,428)
  assert.equal((await record(u.admin,id,payment(1))).status,403)
  assert.equal((await record(u.admin,id,{operationId:crypto.randomUUID(),entryType:'HOLD',amountPaise:0,recordingMode:'ONLINE'})).status,403)
  assert.deepEqual(await history(u.owner,id),before);assert.equal((await payments(u.owner,id)).entries.length,0)
  return {requestId:id,invalidCases:invalid.length,invalidStatus:400,missingRevisionStatus:428,adminPaymentAndHoldStatus:403,unchangedRevision:before.revision}
})
await check('P4-12','Authorized cross-stall and historical-season contexts cannot read or pay a foreign bill',async()=>{
  const a=saved.lifecycle.id,b=await finalized('bBill',u.ownerB,25003),body=payment(1)
  for(const [id,location]of [[a,state.b],[b,state.a]]) {
    assert.equal((await api(u.dual,`/api/admin/customer-requests/${id}/payments`,{location})).status,404)
    assert.equal((await api(u.dual,`/api/admin/customer-requests/${id}/payments`,{location,method:'POST',revision:0,body})).status,404)
  }
  assert.equal((await api(u.owner,`/api/admin/customer-requests/${a}/payments`,{season:state.historical})).status,404)
  assert.equal((await api(u.owner,`/api/admin/customer-requests/${a}/payments`,{season:state.historical,method:'POST',body,revision:0})).status,403)
  assert.equal((await payments(u.ownerB,b)).entries.length,0)
  return {aRequest:a,bRequest:b,dualMembershipForeignReadWriteStatus:404,authorizedHistoricalReadStatus:404,archivedWriteStatus:403}
})
await check('P4-13','Loose-piece price flooring and decimal agreement preserve exact integer paise',async()=>{
  const input={customer:{name:'Phase 4 rounding',mobile:'9876543210'},items:[{productId:state.products.extra,quantity:2,unitType:'piece'}],pricingMode:'bargain',acceptedAmountPaise:2221}
  const created=await checkout(u.owner,crypto.randomUUID(),input),id=created.request.id;saved.roundingId=id
  const q=await quote(u.owner,id);assert.equal(q.items[0].unitRatePaise,1111);assert.equal(q.totalPaise,2222)
  okay(await api(u.owner,`/api/admin/customer-requests/${id}/quotation/customer-agreed-amount`,{method:'PATCH',revision:(await detail(u.owner,id)).request.revision,body:{acceptedAmountInr:'22.21'}}))
  okay(await api(u.owner,`/api/admin/customer-requests/${id}/finalize`,{method:'PATCH',revision:(await detail(u.owner,id)).request.revision,body:{}}))
  okay(await record(u.owner,id,payment(2220)));assert.equal((await payments(u.owner,id)).summary.outstandingPaise,1);okay(await record(u.owner,id,payment(1)))
  assert.equal((await payments(u.owner,id)).summary.receivedPaise,2221)
  const odd={customer:{name:'Phase 4 fractional box floor',mobile:'9876543210'},items:[{productId:state.products.b,quantity:2,unitType:'piece'}],pricingMode:'selling'}
  const bCreated=await checkout(u.ownerB,crypto.randomUUID(),odd),bQuote=await quote(u.ownerB,bCreated.request.id);saved.pieceFloorId=bCreated.request.id
  assert.equal(bQuote.items[0].unitRatePaise,8334);assert.equal(bQuote.totalPaise,16668)
  return {requestId:id,decimalAgreementPaise:2221,partialPaise:2220,lastPaise:1,finalReceivedPaise:2221,looseRounding:{boxPricePaise:25003,pieces:3,perPiecePaise:8334,quantity:2,totalPaise:16668}}
})
await check('P4-14','Real offline synchronization records device/mode/payment method independently and replays once',async()=>{
  const id=await finalized('offline',u.super,10001),deviceId=crypto.randomUUID(),deviceToken=crypto.randomUUID().replaceAll('-','').repeat(2)
  okay(await api(u.super,'/api/admin/offline/devices',{method:'POST',body:{deviceId,deviceToken}}))
  const operationId=crypto.randomUUID(),occurredAt='2026-11-03T04:30:00.000Z',input={operationId,kind:'PAYMENT',requestId:id,expectedRevision:(await payments(u.super,id)).summary.revision,scope:{businessId:state.business,locationId:state.a,seasonId:state.season,userId:u.super.id,deviceId},deviceToken,capturedRole:'super_admin',occurredAt,body:{operationId,entryType:'PAYMENT',amountPaise:10001,recordingMode:'OFFLINE',paymentMethod:'OTHER',details:'Offline acceptance receipt',occurredAt}}
  const first=okay(await api(u.super,'/api/admin/offline/sync',{method:'POST',body:input})),replay=okay(await api(u.super,'/api/admin/offline/sync',{method:'POST',body:input}));assert.equal(replay.idempotentReplay,true);assert.equal(first.requestId,id)
  const p=await payments(u.super,id);assert.equal(p.entries.length,1);assert.equal(p.entries[0].deviceId,deviceId);assert.equal(p.entries[0].recordingMode,'OFFLINE');assert.equal(p.entries[0].paymentMethod,'OTHER');assert.equal(p.entries[0].occurredAt,occurredAt);assert.equal(p.entries[0].actorUserId,u.super.id)
  return {requestId:id,operationId,paymentId:p.entries[0].paymentId,deviceId,recordingMode:'OFFLINE',paymentMethod:'OTHER',actor:u.super.id,ledgerEntries:1,replay:true}
})

if(state.alternate)await check('P4-15','A second active season cannot read or write the first season payment account',async()=>{
  const id=saved.validation.id,session=okay(await api(u.dual,'/api/admin/session',{season:state.alternate,location:state.a}))
  assert.equal(session.effectiveRole,'owner');assert.equal(session.activeSeasonId,state.alternate)
  const before=await history(u.owner,id)
  for(const method of ['GET','POST'])assert.equal((await api(u.dual,`/api/admin/customer-requests/${id}/payments`,{method,season:state.alternate,location:state.a,...(method==='POST'?{revision:before.revision,body:payment(1)}:{})})).status,404)
  assert.deepEqual(await history(u.owner,id),before)
  return {requestId:id,authorizedAlternateActiveSeason:state.alternate,effectiveRole:session.effectiveRole,readStatus:404,writeStatus:404,unchangedRevision:before.revision}
})
await check('P4-16','Admin catalogue selling-price edits are denied for both field aliases',async()=>{
  const before=okay(await api(u.owner,`/api/admin/products/${state.products.a}`)).product.sellingPricePaise
  for(const field of ['sellingPriceInr','selling_price_inr'])assert.equal((await api(u.admin,`/api/admin/products/${state.products.a}`,{method:'PATCH',body:{[field]:0.01}})).status,403)
  const after=okay(await api(u.owner,`/api/admin/products/${state.products.a}`)).product.sellingPricePaise
  assert.equal(after,before)
  return {deniedStatus:403,fieldAliases:2,cataloguePriceUnchangedPaise:after}
})
await check('P4-17','Unfinalized requests cannot receive money and a fully paid bill cannot acquire a HOLD',async()=>{
  const open=saved.checkoutConcurrency.duplicateId,before=await history(u.owner,open),p=await payments(u.owner,open)
  assert.equal(p.summary.amountDuePaise,null);assert.equal(p.summary.eligible,false);assert.equal((await record(u.owner,open,payment(1))).status,409);assert.deepEqual(await history(u.owner,open),before)
  const paid=saved.samePayment.id,paidBefore=await history(u.owner,paid)
  assert.equal((await record(u.owner,paid,{operationId:crypto.randomUUID(),entryType:'HOLD',amountPaise:0,recordingMode:'ONLINE'})).status,409)
  assert.deepEqual(await history(u.owner,paid),paidBefore)
  return {unfinalizedRequestId:open,paymentBeforeFinalizationStatus:409,paidRequestId:paid,holdAfterFullPaymentStatus:409,noAuditOrBalanceChanges:true}
})
await check('P4-18','Admin checkout hands over atomically to Super Admin and a separate Owner finalizes',async()=>{
  if(!saved.superHandover){saved.superHandover={key:crypto.randomUUID(),input:{customer:{name:'Phase 4 Super Admin recipient',mobile:'9876543210'},items:[{productId:state.products.extra,quantity:1}],pricingMode:'selling',assigneeUserId:u.super.id}};await save()}
  const f=saved.superHandover,created=await checkout(u.admin,f.key,f.input);f.id=created.request.id;f.quotationId=created.quotation.id;await save()
  const d=await detail(u.super,f.id);assert.equal(d.request.creatorUserId,u.admin.id);assert.equal(d.request.assignedToUserId,u.super.id)
  const h=await history(u.super,f.id),assignment=h.events.find(row=>row.eventType==='request_assigned');assert.equal(assignment.actorUserId,u.admin.id)
  okay(await api(u.owner,`/api/admin/customer-requests/${f.id}/quotation/customer-agreed-amount`,{method:'PATCH',revision:d.request.revision,body:{acceptedAmountInr:'30.01'}}))
  okay(await api(u.owner,`/api/admin/customer-requests/${f.id}/finalize`,{method:'PATCH',revision:(await detail(u.owner,f.id)).request.revision,body:{}}))
  assert.equal((await detail(u.owner,f.id)).request.closedByEmail,u.owner.email)
  const replay=await checkout(u.admin,f.key,f.input);assert.equal(replay.idempotentReplay,true);assert.equal(replay.request.id,f.id)
  return {requestId:f.id,creator:u.admin.id,recipient:u.super.id,assigningActor:assignment.actorUserId,finalizer:u.owner.id,amountDuePaise:(await payments(u.owner,f.id)).summary.amountDuePaise,checkoutReplayPreservesFinalizedBill:true}
})
const output=path.join(directory,'http-results-'+Date.now()+'.json')
await writeFile(output,JSON.stringify(progress,null,2),{flag:'wx'})
console.log(JSON.stringify({output,pass:results.filter(row=>row.status==='PASS').length,fail:results.filter(row=>row.status==='FAIL').length}))
