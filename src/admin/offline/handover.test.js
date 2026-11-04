import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { openOfflineStorage } from './storage.js'
import { qrFixture,qrScope,qrCatalogue } from '../../../tests/helpers/handoverFixtures.js'
import { generateHandover,sellingLines } from './handover.js'
import { cameraError,startQrCamera } from './qrCamera.js'
import { offlineFinancialPreview } from './financialPreview.js'
import { synchronizeOutbox } from './synchronize.js'

async function setup(role='owner'){
  const fixture=await qrFixture(),indexedDB=new IDBFactory(),name=crypto.randomUUID(),storage=await openOfflineStorage({indexedDB,name})
  const profile={scope:qrScope,role,writable:true,handover:{rootKey:fixture.rootKey,certificate:fixture.certificate,recipients:[{userId:'owner'}]}}
  await storage.activate(profile,qrCatalogue)
  return {...fixture,storage,indexedDB,name,profile}
}
test('atomic duplicate acceptance across tabs creates one draft/outbox and preserves IDs after restart',async()=>{
  const {storage,indexedDB,name,envelope}=await setup()
  const second=await openOfflineStorage({indexedDB,name})
  const accepted=await Promise.all([storage.acceptHandover(qrScope,envelope,qrCatalogue),second.acceptHandover(qrScope,envelope,qrCatalogue)])
  assert.equal(accepted.filter(value=>value.duplicate).length,1)
  assert.equal(accepted[0].draft.draftId,accepted[1].draft.draftId)
  const row=(await storage.list('outbox',qrScope))[0],draft=accepted[0].draft
  await storage.saveDraft(qrScope,draft,{kind:'CLOSE',body:{}})
  await storage.saveDraft(qrScope,{...draft,localRevision:draft.localRevision+1},{kind:'PAYMENT',body:{entryType:'HOLD',recordingMode:'OFFLINE'}})
  storage.close();second.close()
  const reopened=await openOfflineStorage({indexedDB,name}),rows=(await reopened.list('outbox',qrScope)).sort((a,b)=>a.order-b.order)
  assert.equal(rows.length,3);assert.equal(rows[0].payload.operationId,row.payload.operationId)
  assert.equal(rows[0].payload.body.transfer.payload.requestId,envelope.payload.requestId)
  assert.equal(rows[0].payload.body.transfer.payload.lines[0].lineId,envelope.payload.lines[0].lineId)
  assert.equal(rows[1].payload.parentOperationId,row.payload.operationId)
  assert.equal((await reopened.list('drafts',qrScope))[0].handover.transferId,envelope.payload.transferId)
  reopened.close()
})
test('unauthorized or mismatched catalogue acceptance cannot write any draft or outbox row',async()=>{
  const admin=await setup('admin')
  await assert.rejects(admin.storage.acceptHandover(qrScope,admin.envelope,qrCatalogue),/Owner/)
  assert.equal((await admin.storage.list('outbox',qrScope)).length,0);admin.storage.close()
  const owner=await setup()
  await assert.rejects(owner.storage.acceptHandover(qrScope,owner.envelope,[{...qrCatalogue[0],selling_price_paise:12000}]),/catalogue/)
  assert.equal((await owner.storage.list('drafts',qrScope)).length,0);owner.storage.close()
})
test('sender generation reuses transfer identity and non-extractable key across restart, excludes private fields',async()=>{
  const {storage,indexedDB,name,rootPair}=await setup(),scope={...qrScope,userId:'admin',deviceId:'admin-device-1'}
  const identity=await storage.signingIdentity(scope)
  assert.equal(identity.privateKey.extractable,false)
  const fixture=await qrFixture({rootPair,devicePair:{privateKey:identity.privateKey,publicKey:await crypto.subtle.importKey('jwk',identity.publicKey,{name:'ECDSA',namedCurve:'P-256'},true,['verify'])}})
  const profile={scope,role:'admin',writable:true,handover:{rootKey:fixture.rootKey,certificate:fixture.certificate,recipients:[{userId:'owner'}]}}
  await storage.activate(profile,qrCatalogue)
  const body={customer:{name:'Offline QR',mobile:'9876543210'},items:[{productId:'P001',quantity:2,unitType:'box'}]},draft={draftId:crypto.randomUUID(),body}
  const saved=await storage.saveDraft(scope,draft,{kind:'CREATE',body,catalogue:qrCatalogue,lineSnapshots:sellingLines(body.items,qrCatalogue,draft.draftId)})
  const args={storage,profile,draft:saved.draft,operations:await storage.list('outbox',scope),catalogue:qrCatalogue,recipientUserId:'owner'}
  const first=await generateHandover(args)
  storage.close()
  const reopened=await openOfflineStorage({indexedDB,name}),again=await generateHandover({...args,storage:reopened})
  assert.deepEqual(again,first)
  assert.equal(/purchase|margin|profit|privateKey|deviceToken/.test(JSON.stringify(again)),false)
  const changed=await reopened.saveDraft(scope,{...saved.draft,body:{...body,items:[{...body.items[0],quantity:4}]}},{kind:'EDIT',body:{items:[{...body.items[0],quantity:4}]},catalogue:qrCatalogue})
  const latest=await generateHandover({...args,storage:reopened,draft:changed.draft,operations:await reopened.list('outbox',scope)})
  assert.equal(latest.payload.lines[0].quantity,4);assert.equal(latest.payload.requestId,first.payload.requestId)
  assert.notEqual(latest.payload.transferId,first.payload.transferId)
  assert.equal((await reopened.list('outbox',scope)).length,2)
  assert.equal((await reopened.list('outbox',scope)).find(row=>row.payload.kind==='CREATE').payload.body.items[0].quantity,2)
  reopened.close()
})
test('camera permission failures are actionable and late permission grants stop all tracks after cancellation',async()=>{
  await assert.rejects(startQrCamera({},()=>{},{mediaDevices:{getUserMedia:async()=>{throw Object.assign(Error(),{name:'NotAllowedError'})}}}),/permission was denied/)
  assert.match(cameraError({name:'NotFoundError'}),/No camera/)
  await assert.rejects(startQrCamera({},()=>{},{mediaDevices:{}}),/unavailable/)
  const controller=new AbortController();controller.abort();let stopped=0
  await startQrCamera({},()=>{},{signal:controller.signal,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stopped++}]})}})
  assert.equal(stopped,1)
})
test('private financial estimates never add the reference ₹500 to payable or profit',()=>{
  const draft={body:{items:[{productId:'P001',quantity:2,unitType:'box'}]},agreedInr:'150',discountInr:''}
  const result=offlineFinancialPreview(draft,qrCatalogue,[{id:'P001',purchase_unit_paise:4000,final_price_paise:8000}])
  assert.equal(result.total,15000);assert.equal(result.purchase,8000);assert.equal(result.profit,7000);assert.equal(result.reference,66000)
})
test('a denied sending device blocks only its preserved handover chain, not independent drafts',async()=>{
  const {storage,envelope}=await setup()
  await storage.acceptHandover(qrScope,envelope,qrCatalogue)
  await storage.saveDraft(qrScope,{body:{customer:{name:'Independent',mobile:'9876543210'},items:[{productId:'P001',quantity:1}]}},{kind:'CREATE',body:{customer:{name:'Independent',mobile:'9876543210'},items:[{productId:'P001',quantity:1}]}})
  const result=await synchronizeOutbox({storage,scope:qrScope,deviceToken:'ab'.repeat(32),fetchSnapshot:async()=>({ok:false}),send:async op=>op.kind==='HANDOVER'?{ok:false,status:403,error:'sender_device_denied',message:'Sender revoked'}:{ok:true,operationId:op.operationId,requestId:'independent-request',revision:3}})
  assert.equal(result.acknowledged,1)
  const rows=await storage.list('outbox',qrScope)
  assert.equal(rows.find(row=>row.payload.kind==='HANDOVER').state,'failed')
  assert.equal(rows.find(row=>row.payload.kind==='CREATE').state,'synced')
  storage.close()
})
