import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { workflowDb } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { handleAdminOfflineRoutes } from '../src/routes/adminOfflineSync.js'
import { publicJwk,sign,offlineRequestId,transferScope } from '../../src/shared/handoverProtocol.js'
import { familyPackVersion } from '../../src/shared/familyPackSnapshot.js'

const token='ab'.repeat(32)
async function setup(t){
  const db=await workflowDb(t)
  for(const name of ['0023_offline_sync_receipts.sql','0024_qr_handover.sql'])await db.script(readFileSync(new URL('../database/migrations/'+name,import.meta.url),'utf8'))
  const root=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const env={DB:db,HANDOVER_SIGNING_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',root.privateKey))}
  const api=async(user,path,body,options={})=>{
    const request=new Request('https://test.example/api/admin/offline/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Admin-Location-Id':options.location??'loc-a','X-Admin-Season-Id':'season-2026'},...(body?{body:JSON.stringify(body)}:{})})
    const identity={userId:user,email:user+'@test.com'},attached=await attachAdminRequestContext(request,db,identity,{ADMIN_LOCATION_MODE:true})
    if(!attached.ok)return {status:attached.status,...attached}
    const response=await handleAdminOfflineRoutes(request,options.env??env,identity)
    return {status:response.status,...await response.json()}
  }
  const device=async(user,number=1)=>{
    const deviceId=`device-${user}-${number}`,scope={businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId:user,deviceId}
    assert.equal((await api(user,'devices',{deviceId,deviceToken:token})).status,200)
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
    const preparation=await api(user,'handover/prepare',{deviceId,deviceToken:token,publicKey:publicJwk(await crypto.subtle.exportKey('jwk',pair.publicKey))})
    assert.equal(preparation.status,200,JSON.stringify(preparation))
    const catalogue=(await api(user,'catalogue')).products
    return {user,scope,pair,preparation,catalogue}
  }
  const transfer=async(sender,recipient='owner',more={})=>{
    const sourceOperationId=crypto.randomUUID()
    const payload={v:1,transferId:crypto.randomUUID(),scope:transferScope(sender.scope),requestId:await offlineRequestId(sender.scope,sourceOperationId),revision:null,sourceOperationId,
      creatorUserId:sender.user,recipientUserId:recipient,occurredAt:new Date().toISOString(),sourceOccurredAt:new Date(Date.now()-1000).toISOString(),customer:{name:'QR transfer',mobile:'9876543210'},
      lines:[{lineId:'line-'+crypto.randomUUID(),productId:'P001',productName:'Product A',quantity:2,unitType:'box',packSnapshot:{pack:'10 pieces',company:'Maker',piecesPerPack:10,allowLooseSale:1},sellingUnitPaise:10000}],...more}
    return {payload,certificate:sender.preparation.certificate,signature:await sign(payload,sender.pair.privateKey)}
  }
  const operation=(actor,kind,body,extra={})=>({operationId:crypto.randomUUID(),kind,body,scope:actor.scope,deviceToken:token,capturedRole:actor.preparation.certificate.claims.role,occurredAt:new Date().toISOString(),...extra})
  const accept=(receiver,envelope,extra={})=>operation(receiver,'HANDOVER',{transfer:envelope},{requestId:envelope.payload.requestId,expectedRevision:envelope.payload.revision,catalogue:receiver.catalogue,...extra})
  const send=(actor,op)=>api(actor.user,'sync',op)
  return {db,env,api,device,transfer,operation,accept,send}
}

test('offline handover atomically retains creator, stable IDs, claim, receiver and receipt; finalize/payment actors stay separate',async t=>{
  const {db,device,transfer,accept,send,operation}=await setup(t),admin=await device('admin'),owner=await device('owner'),finalizer=await device('super'),envelope=await transfer(admin)
  const input=accept(owner,envelope),accepted=await send(owner,input)
  assert.equal(accepted.status,200,JSON.stringify(accepted));assert.equal(accepted.requestId,envelope.payload.requestId)
  assert.equal((await send(owner,input)).idempotentReplay,true)
  const request=await db.prepare('SELECT creator_user_id,location_id,season_id FROM customer_requests WHERE id=?').bind(accepted.requestId).first()
  assert.equal(request.creator_user_id,'admin');assert.equal(request.location_id,'loc-a')
  assert.equal((await db.prepare('SELECT line_id FROM customer_request_items WHERE request_id=?').bind(accepted.requestId).first()).line_id,envelope.payload.lines[0].lineId)
  const claim=await db.prepare('SELECT * FROM request_handover_claims WHERE request_id=?').bind(accepted.requestId).first()
  assert.equal(claim.initiator_user_id,'admin');assert.equal(claim.recipient_user_id,'owner');assert.ok(claim.received_at)
  const agreement=operation(owner,'AGREEMENT',{acceptedAmountPaise:15000},{parentOperationId:accepted.operationId})
  const agreed=await send(owner,agreement);assert.equal(agreed.status,200)
  const close=operation(finalizer,'CLOSE',{}, {requestId:accepted.requestId,expectedRevision:agreed.revision}),closed=await send(finalizer,close)
  assert.equal(closed.status,200,JSON.stringify(closed))
  const payment=operation(owner,'PAYMENT',{entryType:'PAYMENT',amountPaise:5000,paymentMethod:'CASH',recordingMode:'OFFLINE'},{requestId:accepted.requestId,expectedRevision:closed.revision})
  assert.equal((await send(owner,payment)).status,200);assert.equal((await send(owner,payment)).idempotentReplay,true)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,1)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_payment_ledger').bind().first()).n,1)
  const events=(await db.prepare('SELECT * FROM request_workflow_events WHERE request_id=?').bind(accepted.requestId).all()).results
  assert.ok(events.some(event=>event.event_type==='handover_accepted'&&event.actor_user_id==='owner'))
  assert.ok(events.some(event=>event.event_type==='request_closed'&&event.actor_user_id==='super'))
  assert.equal((await db.prepare('SELECT actor_user_id FROM request_payment_ledger').bind().first()).actor_user_id,'owner')
  assert.ok(events.some(event=>event.event_type==='request_created'&&event.actor_user_id==='admin'))
  const stale=operation(admin,'EDIT',{items:[{productId:'P001',quantity:5,unitType:'box'}]},{requestId:accepted.requestId,expectedRevision:accepted.revision,catalogue:admin.catalogue})
  assert.equal((await send(admin,stale)).status,409)
})
test('four Admin devices synchronize independent transfers concurrently without duplicate requests or claims',async t=>{
  const {db,device,transfer,accept,send}=await setup(t),owner=await device('owner')
  const admins=await Promise.all([1,2,3,4].map(number=>device('admin',number))),envelopes=await Promise.all(admins.map(admin=>transfer(admin)))
  const operations=envelopes.map(envelope=>accept(owner,envelope)),results=await Promise.all(operations.map(op=>send(owner,op)))
  assert.ok(results.every(result=>result.status===200),JSON.stringify(results))
  const replays=await Promise.all(operations.map(op=>send(owner,op)));assert.ok(replays.every(result=>result.idempotentReplay))
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n,4)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,4)
})
test('two receiving devices competing for one request preserve a detectable claim conflict; two closures cannot both commit',async t=>{
  const {db,device,transfer,accept,send,operation}=await setup(t),admin=await device('admin'),first=await device('owner',1),second=await device('owner',2),envelope=await transfer(admin)
  const inputs=[accept(first,envelope),accept(second,envelope)],results=await Promise.all([send(first,inputs[0]),send(second,inputs[1])])
  assert.equal(results.filter(row=>row.status===200).length,1);assert.equal(results.filter(row=>row.status===409).length,1)
  const accepted=results.find(row=>row.status===200),id=accepted.requestId
  const agreed=await send(first,operation(first,'AGREEMENT',{acceptedAmountPaise:15000},{requestId:id,expectedRevision:accepted.revision}))
  assert.equal(agreed.status,200,JSON.stringify(agreed))
  const closures=[first,second].map(actor=>operation(actor,'CLOSE',{}, {requestId:id,expectedRevision:agreed.revision}))
  const closed=await Promise.all([send(first,closures[0]),send(second,closures[1])])
  assert.equal(closed.filter(row=>row.status===200).length,1);assert.equal(closed.filter(row=>row.status===409).length,1)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,1)
})
test('different authorized Owner and Super Admin recipients cannot both reconcile independently addressed transfers of one request',async t=>{
  const {db,device,transfer,accept,send}=await setup(t),admin=await device('admin'),owner=await device('owner'),superAdmin=await device('super'),first=await transfer(admin)
  const second=structuredClone(first);second.payload.transferId=crypto.randomUUID();second.payload.recipientUserId='super';second.signature=await sign(second.payload,admin.pair.privateKey)
  const results=await Promise.all([send(owner,accept(owner,first)),send(superAdmin,accept(superAdmin,second))])
  assert.equal(results.filter(row=>row.status===200).length,1);assert.equal(results.filter(row=>row.status===409).length,1)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,1)
})
test('tampered QR, cross-stall, unauthorized recipient, revoked sender and missing signing configuration fail closed',async t=>{
  const {db,env,api,device,transfer,accept,send}=await setup(t),admin=await device('admin'),owner=await device('owner'),superAdmin=await device('super'),envelope=await transfer(admin)
  const tampered=structuredClone(envelope);tampered.payload.lines[0].quantity++
  assert.equal((await send(owner,accept(owner,tampered))).status,400)
  assert.equal((await send(superAdmin,accept(superAdmin,envelope))).status,400)
  assert.equal((await send(admin,accept(admin,envelope))).status,403)
  const cross=structuredClone(envelope);cross.payload.scope.locationId='loc-b';cross.signature=await sign(cross.payload,admin.pair.privateKey)
  assert.equal((await send(owner,accept(owner,cross))).status,400)
  assert.equal((await api('owner','handover/prepare',{deviceId:owner.scope.deviceId,deviceToken:token,publicKey:owner.preparation.certificate.claims.publicKey},{env:{...env,HANDOVER_SIGNING_JWK:undefined}})).status,503)
  await db.prepare("UPDATE location_members SET disabled_at='revoked' WHERE admin_user_id='admin'").bind().run()
  assert.equal((await send(owner,accept(owner,envelope))).status,403)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,0)
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n,0)
})
test('Admin-first synchronization and QR acceptance converge on the same original request ID and line identities',async t=>{
  const {db,device,transfer,accept,send,operation}=await setup(t),admin=await device('admin'),owner=await device('owner'),envelope=await transfer(admin,'owner',{customer:{name:'QR transfer',mobile:'9876543210',area:'Test Area',note:'Preserve collection instructions'}})
  const body={customer:envelope.payload.customer,items:envelope.payload.lines.map(line=>({productId:line.productId,quantity:line.quantity,unitType:line.unitType})),pricingMode:'selling'}
  const created=await send(admin,operation(admin,'CREATE',body,{operationId:envelope.payload.sourceOperationId,catalogue:admin.catalogue,lineSnapshots:envelope.payload.lines}))
  assert.equal(created.status,200,JSON.stringify(created));assert.equal(created.requestId,envelope.payload.requestId)
  const changed=structuredClone(envelope);changed.payload.customer.note='Different instructions';changed.signature=await sign(changed.payload,admin.pair.privateKey)
  const rejected=await send(owner,accept(owner,changed));assert.equal(rejected.status,409);assert.equal(rejected.error,'customer_snapshot_conflict')
  const accepted=await send(owner,accept(owner,envelope));assert.equal(accepted.status,200,JSON.stringify(accepted))
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n,1)
  const snapshot=(await db.prepare('SELECT creator_user_id FROM customer_requests WHERE id=?').bind(created.requestId).first());assert.equal(snapshot.creator_user_id,'admin')
})
test('prepared private purchase snapshot is never included in Admin preparation',async t=>{
  const {device}=await setup(t),admin=await device('admin'),owner=await device('owner')
  assert.deepEqual(admin.preparation.privateCatalogue,[])
  assert.equal(owner.preparation.privateCatalogue[0].final_price_paise,8000)
  assert.ok(admin.preparation.recipients.every(row=>['owner','super_admin'].includes(row.role)))
})
test('revoking the sender between verification and commit atomically rolls back request, claim and receipt',async t=>{
  const {db,device,transfer,accept,send}=await setup(t),admin=await device('admin'),owner=await device('owner'),envelope=await transfer(admin)
  const batch=db.batch
  let interrupted=false
  db.batch=async statements=>{
    if(!interrupted&&statements.some(statement=>/^INSERT INTO customer_requests\b/i.test(statement.sql.trim()))){
      interrupted=true
      await db.prepare("UPDATE offline_sync_devices SET disabled_at='revoked' WHERE user_id='admin'").bind().run()
    }
    return batch(statements)
  }
  const result=await send(owner,accept(owner,envelope));assert.equal(result.status,403,JSON.stringify(result))
  for(const table of ['customer_requests','request_handover_claims','offline_sync_receipts'])assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).bind().first()).n,0)
})
test('a competing Admin edit rejects an earlier QR without replacing its newer server version',async t=>{
  const {db,device,transfer,accept,send,operation}=await setup(t),admin=await device('admin'),owner=await device('owner'),envelope=await transfer(admin)
  const items=envelope.payload.lines.map(line=>({productId:line.productId,quantity:line.quantity,unitType:line.unitType}))
  const created=await send(admin,operation(admin,'CREATE',{customer:envelope.payload.customer,items,pricingMode:'selling'}, {operationId:envelope.payload.sourceOperationId,catalogue:admin.catalogue,lineSnapshots:envelope.payload.lines}))
  assert.equal(created.status,200)
  const edit=await send(admin,operation(admin,'EDIT',{items:[{...items[0],quantity:4}]},{requestId:created.requestId,expectedRevision:created.revision,catalogue:admin.catalogue}))
  assert.equal(edit.status,200,JSON.stringify(edit))
  const result=await send(owner,accept(owner,envelope));assert.equal(result.status,409)
  assert.equal((await db.prepare('SELECT quantity FROM customer_request_items WHERE request_id=?').bind(created.requestId).first()).quantity,4)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,0)
})

async function seedOfflinePack(db,api){
  await db.prepare(`INSERT INTO family_packs(id,slug,name,selling_price_paise,pack_label,active,season_id,location_id)
    VALUES('FP001','family-classic','Family Pack Classic',50000,'Classic',1,'season-2026','loc-a')`).bind().run()
  await db.prepare("INSERT INTO family_pack_items(family_pack_id,product_id,quantity,unit_label,sort_order) VALUES('FP001','P001',3,'box',0)").bind().run()
  const catalogue=await api('admin','catalogue')
  assert.equal(catalogue.status,200,JSON.stringify(catalogue));assert.equal(catalogue.familyPacks.length,1)
  return catalogue.familyPacks[0]
}
const packTransferLine=pack=>({lineId:'pack-line-'+crypto.randomUUID(),familyPackId:pack.familyPackId,productName:pack.name,quantity:2,unitType:'box',packSnapshot:pack,sellingUnitPaise:pack.sellingUnitPaise})

test('Admin-created Family Pack request syncs with stable variant/composition/line snapshots and accepts QR idempotently',async t=>{
  const {db,api,device,transfer,operation,accept,send}=await setup(t),pack=await seedOfflinePack(db,api),admin=await device('admin'),owner=await device('owner')
  const line=packTransferLine(pack),envelope=await transfer(admin,'owner',{v:2,lines:[line]})
  const body={customer:envelope.payload.customer,items:[{familyPackId:'FP001',quantity:2}],pricingMode:'selling'}
  const source=operation(admin,'CREATE',body,{operationId:envelope.payload.sourceOperationId,lineSnapshots:[line],catalogue:admin.catalogue})
  const created=await send(admin,source);assert.equal(created.status,200,JSON.stringify(created));assert.equal(created.requestId,envelope.payload.requestId)
  const before=await db.prepare('SELECT line_id,pack_snapshot,unit_price_paise FROM customer_request_items WHERE request_id=?').bind(created.requestId).first()
  assert.equal(before.line_id,line.lineId);assert.deepEqual(JSON.parse(before.pack_snapshot),pack);assert.equal(before.unit_price_paise,50000)
  const input=accept(owner,envelope),accepted=await send(owner,input);assert.equal(accepted.status,200,JSON.stringify(accepted))
  assert.equal((await send(owner,input)).idempotentReplay,true)
  const saved=await db.prepare('SELECT line_id,pack_snapshot,quantity FROM customer_request_items WHERE request_id=?').bind(created.requestId).first()
  assert.deepEqual(JSON.parse(saved.pack_snapshot),pack);assert.equal(saved.line_id,line.lineId);assert.equal(saved.quantity,2)
  assert.equal((await db.prepare('SELECT total_paise FROM quotations WHERE customer_request_id=? AND status!=?').bind(created.requestId,'void').first()).total_paise,100000)
  const snapshot=await api('admin','requests/'+created.requestId)
  assert.deepEqual(snapshot.request.items[0].packSnapshot,pack)
  assert.equal(/purchase|profit|margin/.test(JSON.stringify(snapshot.request.items)),false)
})
test('Owner-first mixed Family Pack QR materializes the original request exactly once and keeps pack snapshots through closure/payment',async t=>{
  const {db,api,device,transfer,operation,accept,send}=await setup(t),pack=await seedOfflinePack(db,api),admin=await device('admin'),owner=await device('owner')
  const base=await transfer(admin),envelope=await transfer(admin,'owner',{v:2,lines:[packTransferLine(pack),base.payload.lines[0]]})
  const input=accept(owner,envelope),accepted=await send(owner,input);assert.equal(accepted.status,200,JSON.stringify(accepted))
  assert.equal((await send(owner,input)).idempotentReplay,true)
  const agreed=await send(owner,operation(owner,'AGREEMENT',{acceptedAmountPaise:110000},{parentOperationId:input.operationId}));assert.equal(agreed.status,200)
  const closed=await send(owner,operation(owner,'CLOSE',{}, {parentOperationId:agreed.operationId}));assert.equal(closed.status,200,JSON.stringify(closed))
  const payment=operation(owner,'PAYMENT',{entryType:'PAYMENT',amountPaise:20000,paymentMethod:'CASH',recordingMode:'OFFLINE'},{parentOperationId:closed.operationId})
  assert.equal((await send(owner,payment)).status,200);assert.equal((await send(owner,payment)).idempotentReplay,true)
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n,1)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_payment_ledger').bind().first()).n,1)
  const rows=(await db.prepare('SELECT line_id,pack_snapshot FROM customer_request_items WHERE request_id=? AND family_pack_id=?').bind(accepted.requestId,'FP001').all()).results
  assert.equal(rows[0].line_id,envelope.payload.lines[0].lineId);assert.deepEqual(JSON.parse(rows[0].pack_snapshot),pack)
})
test('Family Pack catalogue version/composition changes reject sync, preserve original snapshots and never duplicate a transfer claim',async t=>{
  const {db,api,device,transfer,operation,accept,send}=await setup(t),pack=await seedOfflinePack(db,api),admin=await device('admin'),owner=await device('owner')
  const line=packTransferLine(pack),envelope=await transfer(admin,'owner',{v:2,lines:[line]})
  const created=await send(admin,operation(admin,'CREATE',{customer:envelope.payload.customer,items:[{familyPackId:'FP001',quantity:2}],pricingMode:'selling'},{operationId:envelope.payload.sourceOperationId,lineSnapshots:[line],catalogue:admin.catalogue}))
  assert.equal(created.status,200)
  await db.prepare("UPDATE family_pack_items SET quantity=4 WHERE family_pack_id='FP001'").bind().run()
  const result=await send(owner,accept(owner,envelope));assert.equal(result.status,409);assert.equal(result.error,'family_pack_catalogue_conflict')
  const original=await db.prepare('SELECT pack_snapshot,quantity,unit_price_paise FROM customer_request_items WHERE request_id=?').bind(created.requestId).first()
  assert.deepEqual(JSON.parse(original.pack_snapshot),pack);assert.equal(original.quantity,2);assert.equal(original.unit_price_paise,50000)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,0)
  const fresh=(await api('admin','catalogue')).familyPacks[0];assert.notEqual(fresh.catalogueVersion,pack.catalogueVersion)
})
test('Family Pack changes between validation and batch commit roll back all business writes and receipts',async t=>{
  const {db,api,device,transfer,accept,send}=await setup(t),pack=await seedOfflinePack(db,api),admin=await device('admin'),owner=await device('owner'),envelope=await transfer(admin,'owner',{v:2,lines:[packTransferLine(pack)]})
  const batch=db.batch;let changed=false
  db.batch=async statements=>{
    if(!changed&&statements.some(statement=>/^INSERT INTO customer_requests\b/.test(statement.sql.trim()))){changed=true;await db.prepare("INSERT INTO family_pack_items(family_pack_id,product_id,quantity,unit_label,sort_order) VALUES('FP001','P001',9,'piece',1)").bind().run()}
    return batch(statements)
  }
  const result=await send(owner,accept(owner,envelope));assert.equal(result.status,409,JSON.stringify(result))
  for(const table of ['customer_requests','request_handover_claims','offline_sync_receipts'])assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).bind().first()).n,0)
})
test('Family Pack quantity edits preserve snapshots; explicit removal is audited instead of silently retaining a removed pack',async t=>{
  const {db,api,device,transfer,operation,accept,send}=await setup(t),pack=await seedOfflinePack(db,api),admin=await device('admin'),owner=await device('owner'),base=await transfer(admin)
  const line=packTransferLine(pack),envelope=await transfer(admin,'owner',{v:2,lines:[line,base.payload.lines[0]]}),accepted=await send(owner,accept(owner,envelope))
  assert.equal(accepted.status,200,JSON.stringify(accepted))
  const editedLine={...line,quantity:3}
  const edit=await send(owner,operation(owner,'EDIT',{items:[{familyPackId:'FP001',quantity:3},{productId:'P001',quantity:2,unitType:'box'}]},{requestId:accepted.requestId,expectedRevision:accepted.revision,lineSnapshots:[editedLine,base.payload.lines[0]],catalogue:owner.catalogue}))
  assert.equal(edit.status,200,JSON.stringify(edit))
  const saved=await db.prepare('SELECT pack_snapshot,quantity FROM customer_request_items WHERE request_id=? AND family_pack_id=?').bind(accepted.requestId,'FP001').first()
  assert.equal(saved.quantity,3);assert.deepEqual(JSON.parse(saved.pack_snapshot),pack)
  const remove=await send(owner,operation(owner,'EDIT',{items:[{productId:'P001',quantity:2,unitType:'box'}]},{requestId:accepted.requestId,expectedRevision:edit.revision,lineSnapshots:[base.payload.lines[0]],catalogue:owner.catalogue}))
  assert.equal(remove.status,200,JSON.stringify(remove))
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_request_items WHERE request_id=? AND family_pack_id=?').bind(accepted.requestId,'FP001').first()).n,0)
  assert.ok((await db.prepare("SELECT metadata_json FROM request_workflow_events WHERE request_id=? AND event_type='item_removed'").bind(accepted.requestId).all()).results.some(row=>JSON.parse(row.metadata_json).before.packSnapshot.catalogueVersion===pack.catalogueVersion))
})
test('Family Packs with missing/foreign components or incompatible variant definitions are excluded explicitly and rejected on sync',async t=>{
  const {db,api,device,transfer,accept,send}=await setup(t),pack=await seedOfflinePack(db,api),admin=await device('admin'),owner=await device('owner')
  const changed=structuredClone(pack);changed.variant.label='Other';changed.catalogueVersion=await familyPackVersion(changed)
  const variant=await transfer(admin,'owner',{v:2,lines:[packTransferLine(changed)]})
  assert.equal((await send(owner,accept(owner,variant))).status,409)
  await db.prepare("UPDATE family_pack_items SET product_id='P002' WHERE family_pack_id='FP001'").bind().run()
  const catalogue=await api('admin','catalogue');assert.equal(catalogue.familyPacks.length,0);assert.match(catalogue.familyPackIssues[0].message,/foreign/)
  const result=await send(owner,accept(owner,await transfer(admin,'owner',{v:2,lines:[packTransferLine(pack)]})))
  assert.equal(result.status,409)
})
test('an 80-component Family Pack synchronizes atomically with bounded SQL parameters and its fixed selling price',async t=>{
  const {db,api,device,transfer,accept,send}=await setup(t)
  await seedOfflinePack(db,api)
  for(let index=1;index<80;index++){
    const id='P'+(1000+index)
    await db.prepare(`INSERT INTO products(id,category_slug,name,pack,company,selling_price_paise,final_price_paise,pieces_per_pack,allow_loose_sale,season_id,location_id)
      VALUES(?,'cat-a',?,'10 pieces','Maker',10000,8000,10,1,'season-2026','loc-a')`).bind(id,'Component '+index).run()
    await db.prepare("INSERT INTO family_pack_items(family_pack_id,product_id,quantity,unit_label,sort_order) VALUES('FP001',?,?,'box',?)").bind(id,index+1,index).run()
  }
  const pack=(await api('admin','catalogue')).familyPacks[0]
  assert.equal(pack.components.length,80)
  const admin=await device('admin'),owner=await device('owner'),envelope=await transfer(admin,'owner',{v:2,lines:[packTransferLine(pack)]})
  const accepted=await send(owner,accept(owner,envelope));assert.equal(accepted.status,200,JSON.stringify(accepted))
  const snapshot=JSON.parse((await db.prepare('SELECT pack_snapshot FROM customer_request_items WHERE request_id=?').bind(accepted.requestId).first()).pack_snapshot)
  assert.equal(snapshot.components.length,80);assert.equal(snapshot.catalogueVersion,pack.catalogueVersion)
  assert.equal((await db.prepare("SELECT total_paise FROM quotations WHERE customer_request_id=? AND status!='void'").bind(accepted.requestId).first()).total_paise,100000)
})
