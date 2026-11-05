import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { openOfflineStorage } from './storage.js'
import { synchronizeOutbox } from './synchronize.js'
import { publicJwk,digest,sign,verify,canonicalJson } from '../../shared/handoverProtocol.js'
import { grantOperationMessage,verifyOfflineGrant } from '../../shared/offlineGrant.js'
import { generateHandover,sellingLines } from './handover.js'
import { encodeFrames,createFrameCollector,verifyTransfer,transferScope } from '../../shared/handoverProtocol.js'
import { qrCatalogue } from '../../../tests/helpers/handoverFixtures.js'
import { posSummary } from './posPresentation.js'
import {finalPricePreview} from './finalPricePreview.js'
import {assertSignedBillingSession,openSignedRequest} from './signedBilling.js'
import { packFixture } from '../../../tests/helpers/familyPackFixtures.js'

async function fixture(t,canFinalize=true) {
  const indexedDB=new IDBFactory(),name=crypto.randomUUID(),storage=await openOfflineStorage({indexedDB,name})
  t.after(()=>storage.close())
  const device=await storage.device()
  const scope={businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId:'admin',deviceId:device.deviceId}
  await storage.activate({scope,role:'admin',writable:true},qrCatalogue)
  const identity=await storage.signingIdentity(scope)
  const root=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const finalPrices=[{productId:'P001',finalPricePaise:8000}]
  const claims={v:1,type:'diwali-offline-final-price',grantId:crypto.randomUUID(),scope:{businessId:'shop',locationId:'loc-a',seasonId:'season-2026'},userId:'admin',deviceId:scope.deviceId,ownerUserId:'owner',publicKey:identity.publicKey,canFinalize,
    issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),finalPricesDigest:await digest(finalPrices)}
  const authorization={rootKey:publicJwk(await crypto.subtle.exportKey('jwk',root.publicKey)),grant:{claims,signature:await sign(claims,root.privateKey)},finalPrices}
  await storage.saveAuthorization(scope,authorization)
  const draft=(await storage.saveDraft(scope,{body:{customer:{name:'Local Admin',mobile:'9876543210'},items:[{productId:'P001',quantity:1,unitType:'box'}]}})).draft
  const created=await storage.saveDraft(scope,draft,{kind:'CREATE',body:{customer:draft.body.customer,items:draft.body.items,pricingMode:'selling'},catalogue:qrCatalogue,lineSnapshots:sellingLines(draft.body.items,qrCatalogue,draft.draftId)})
  return {storage,indexedDB,name,scope,authorization,identity,root,created}
}

test('signed online billing cannot cross users or stalls and cannot overwrite a preserved local outbox',async t=>{
  const f=await fixture(t)
  const session={ok:true,effectiveRole:'admin',capabilities:{write:true},userId:f.scope.userId,activeBusinessId:f.scope.businessId,activeLocationId:f.scope.locationId,activeSeasonId:f.scope.seasonId}
  assert.doesNotThrow(()=>assertSignedBillingSession(session,f.scope))
  assert.throws(()=>assertSignedBillingSession({...session,activeLocationId:'other-stall'},f.scope),/matching Admin/)
  assert.throws(()=>assertSignedBillingSession({...session,userId:'another-admin'},f.scope),/matching Admin/)
  const row=await f.storage.updateOperation(f.scope,f.created.operation.operationId,{state:'synced',acknowledgement:{operationId:f.created.operation.operationId,requestId:'request-a',revision:1}})
  assert.equal(row.state,'synced')
  const draft=await f.storage.get('drafts',f.scope,f.created.draft.draftId)
  await f.storage.saveDraft(f.scope,draft,{kind:'AGREEMENT',requestId:'request-a',expectedRevision:1,body:{acceptedAmountPaise:100}})
  await assert.rejects(openSignedRequest(f.storage,{scope:f.scope},{request:{id:'request-a'}}),/preserved local actions/)
  assert.equal((await f.storage.list('outbox',f.scope)).length,2)
})

test('signed Final Price preview follows existing box/piece rounding, counts quantities and never invents missing Family Pack prices',()=>{
  const products=[{id:'A',name:'A',pieces_per_pack:3}],prices=[{productId:'A',finalPricePaise:100}]
  const items=[{productId:'A',quantity:2,unitType:'box'},{productId:'A',quantity:2,unitType:'piece'}]
  assert.equal(finalPricePreview(items,products,prices).total,266)
  assert.equal(finalPricePreview([...items,{familyPackId:'pack',quantity:1}],products,prices).total,null)
  assert.equal(finalPricePreview(items,products,[]).total,null)
})

test('Admin locally queues signed agreement and closure atomically, retaining proof and IDs across restart',async t=>{
  const f=await fixture(t)
  const agreed=await f.storage.saveDraft(f.scope,f.created.draft,{kind:'AGREEMENT',body:{acceptedAmountPaise:100}})
  const closed=await f.storage.saveDraft(f.scope,agreed.draft,{kind:'CLOSE',body:{}})
  assert.equal(agreed.operation.parentOperationId,f.created.operation.operationId)
  assert.equal(closed.operation.parentOperationId,agreed.operation.operationId)
  for(const op of [agreed.operation,closed.operation])await verify(grantOperationMessage(op),op.authorization.proof,f.identity.publicKey)
  assert.equal(f.identity.privateKey.extractable,false)
  const reopened=await openOfflineStorage({indexedDB:f.indexedDB,name:f.name});t.after(()=>reopened.close())
  const persisted=(await reopened.list('outbox',f.scope)).sort((a,b)=>a.order-b.order)
  assert.equal(canonicalJson(persisted[2].payload),canonicalJson(closed.operation))
  const newer={...closed.draft,body:{...closed.draft.body,items:[{productId:'P001',quantity:2}]}}
  await assert.rejects(reopened.saveDraft(f.scope,newer,{kind:'EDIT',body:{items:newer.body.items}}),/queued closure/)
  await assert.rejects(reopened.saveDraft(f.scope,closed.draft,{kind:'PAYMENT',body:{}}),/Only Owner/)
})

test('view-only, wrong-device and tampered price grants cannot authorize an Admin closure',async t=>{
  const f=await fixture(t,false)
  await assert.rejects(f.storage.saveDraft(f.scope,f.created.draft,{kind:'CLOSE',body:{}}),/valid Owner-issued/)
  const wrong=structuredClone(f.authorization);wrong.grant.claims.deviceId='another-device'
  await assert.rejects(f.storage.saveAuthorization(f.scope,wrong),/another user, device or stall/)
  const prices=structuredClone(f.authorization);prices.finalPrices[0].finalPricePaise=1
  await assert.rejects(f.storage.saveAuthorization(f.scope,prices),/snapshot/)
  assert.equal((await f.storage.list('outbox',f.scope)).length,1)
})

test('lost acknowledgement recovery sends original captured proof even after local grant removal; no replacement identity',async t=>{
  const f=await fixture(t),agreed=await f.storage.saveDraft(f.scope,f.created.draft,{kind:'AGREEMENT',body:{acceptedAmountPaise:100}})
  await f.storage.updateOperation(f.scope,f.created.operation.operationId,{state:'synced',acknowledgement:{operationId:f.created.operation.operationId,requestId:'request-one',revision:1}})
  await f.storage.saveAuthorization(f.scope,null)
  let sent
  await synchronizeOutbox({storage:f.storage,scope:f.scope,send:async op=>{sent=op;return {ok:true,operationId:op.operationId,requestId:'request-one',revision:2}}})
  assert.equal(sent.operationId,agreed.operation.operationId)
  assert.equal(sent.occurredAt,agreed.operation.occurredAt)
  assert.equal(sent.authorization.proof,agreed.operation.authorization.proof)
  assert.equal((await f.storage.get('outbox',f.scope,sent.operationId)).state,'synced')
})

test('an expired grant cannot mint a new local action; an imported private field cannot pass the signed snapshot format',async t=>{
  const f=await fixture(t)
  await assert.rejects(verifyOfflineGrant(f.authorization,f.scope,{now:Date.parse(f.authorization.grant.claims.expiresAt)}),/expired/)
  const privateSnapshot=structuredClone(f.authorization);privateSnapshot.finalPrices[0].purchasePricePaise=1
  await assert.rejects(f.storage.saveAuthorization(f.scope,privateSnapshot),/snapshot/)
})

test('cleared authorization cannot be resurrected by a stale profile and explicit grant review preserves rejected descendants',async t=>{
  const f=await fixture(t),stale=await f.storage.get('profiles',f.scope,'profile')
  const agreed=await f.storage.saveDraft(f.scope,f.created.draft,{kind:'AGREEMENT',body:{acceptedAmountPaise:100}})
  const closed=await f.storage.saveDraft(f.scope,agreed.draft,{kind:'CLOSE',body:{}})
  await f.storage.saveAuthorization(f.scope,null)
  await f.storage.activate(stale,[{id:'P001',selling_price_paise:10000}])
  assert.equal((await f.storage.get('profiles',f.scope,'profile')).authorization,null)
  await f.storage.saveAuthorization(f.scope,f.authorization)
  await f.storage.updateOperation(f.scope,agreed.operation.operationId,{state:'failed',lastError:{status:403,code:'offline_grant_denied',message:'Expired'}})
  const replacement=await f.storage.saveDraft(f.scope,closed.draft,{kind:'AGREEMENT',body:{acceptedAmountPaise:100},requestId:'request-one',expectedRevision:2},agreed.operation.operationId)
  assert.notEqual(replacement.operation.operationId,agreed.operation.operationId)
  assert.equal(replacement.operation.resolutionOf,agreed.operation.operationId)
  assert.equal((await f.storage.get('outbox',f.scope,agreed.operation.operationId)).state,'resolved')
  assert.equal((await f.storage.get('outbox',f.scope,closed.operation.operationId)).state,'discarded')
  await verify(grantOperationMessage(replacement.operation),replacement.operation.authorization.proof,f.identity.publicKey)
})

test('finalized Admin bill QR verifies grants, accepts provisionally with locked items, and queues dependent partial payment',async t=>{
  const f=await fixture(t)
  const pack=await packFixture({products:qrCatalogue})
  const mixedItems=[...f.created.draft.body.items,{lineId:crypto.randomUUID(),familyPackId:pack.familyPackId,quantity:1,unitType:'box',familyPackSnapshot:pack}]
  const edited=await f.storage.saveDraft(f.scope,{...f.created.draft,body:{...f.created.draft.body,items:mixedItems}},
    {kind:'EDIT',body:{items:[f.created.draft.body.items[0],{familyPackId:pack.familyPackId,quantity:1}]},catalogue:qrCatalogue,lineSnapshots:sellingLines(mixedItems,qrCatalogue,f.created.draft.draftId)})
  const claims={v:1,scope:transferScope(f.scope),userId:f.scope.userId,deviceId:f.scope.deviceId,role:'admin',publicKey:f.identity.publicKey,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}
  const prep={rootKey:f.authorization.rootKey,grantRootKey:f.authorization.rootKey,certificate:{claims,signature:await sign(claims,f.root.privateKey)},recipients:[{userId:'owner',role:'owner'}]}
  await f.storage.saveHandoverPreparation(f.scope,prep)
  const agreed=await f.storage.saveDraft(f.scope,edited.draft,{kind:'AGREEMENT',body:{acceptedAmountPaise:100}})
  const closed=await f.storage.saveDraft(f.scope,agreed.draft,{kind:'CLOSE',body:{}})
  const profile=await f.storage.get('profiles',f.scope,'profile')
  const envelope=await generateHandover({storage:f.storage,profile,draft:closed.draft,operations:await f.storage.list('outbox',f.scope),catalogue:qrCatalogue,recipientUserId:'owner'})
  assert.equal(envelope.payload.v,3)
  assert.equal(envelope.payload.bill.operations.find(op=>op.kind==='AGREEMENT').authorization.proof,agreed.operation.authorization.proof)
  assert.equal(/"(?:deviceToken|privateKey|purchase_unit_paise)"/.test(JSON.stringify(envelope)),false)
  const collector=createFrameCollector();let collected
  for(const frame of encodeFrames(envelope))collected=collector(frame)
  assert.equal(collected.envelope.payload.bill.agreedAmountPaise,100)
  const receiver=await openOfflineStorage({indexedDB:new IDBFactory(),name:crypto.randomUUID()});t.after(()=>receiver.close())
  const device=await receiver.device(),scope={...f.scope,userId:'owner',deviceId:device.deviceId}
  await receiver.activate({scope,role:'owner',writable:true,handover:{rootKey:prep.rootKey,grantRootKey:prep.grantRootKey}},qrCatalogue)
  await verifyTransfer(envelope,{rootKey:prep.rootKey,grantRootKey:prep.grantRootKey,scope,recipientUserId:'owner'})
  const changedCatalogue=qrCatalogue.map(row=>({...row,selling_price_paise:999999}))
  const accepted=await receiver.acceptHandover(scope,envelope,changedCatalogue)
  assert.equal(accepted.draft.localClosure.receivedFinalized,true)
  let summary=posSummary(accepted.draft,qrCatalogue,await receiver.list('outbox',scope))
  assert.equal(summary.amount,100);assert.equal(summary.itemsSaved,true);assert.equal(summary.confirmed,false)
  assert.equal(posSummary(accepted.draft,changedCatalogue,await receiver.list('outbox',scope)).subtotal,10000+pack.sellingUnitPaise,'a finalized bill never reprices from the receiving catalogue')
  assert.deepEqual(accepted.draft.body.items[1].familyPackSnapshot,pack)
  const paid=await receiver.saveDraft(scope,accepted.draft,{kind:'PAYMENT',body:{entryType:'PAYMENT',amountPaise:50,paymentMethod:'CASH',recordingMode:'OFFLINE'}})
  assert.equal(paid.operation.parentOperationId,accepted.operation.operationId)
  summary=posSummary(paid.draft,qrCatalogue,await receiver.list('outbox',scope))
  assert.equal(summary.received,50);assert.equal(summary.outstanding,50)
  assert.equal((await receiver.acceptHandover(scope,envelope,qrCatalogue)).duplicate,true)
  const refreshed=structuredClone(envelope);refreshed.payload.transferId=crypto.randomUUID();refreshed.signature=await sign(refreshed.payload,f.identity.privateKey)
  await assert.rejects(receiver.acceptHandover(scope,refreshed,qrCatalogue),/already accepted/)
  assert.equal((await receiver.list('outbox',scope)).length,2)
})

test('a never-sent retained cash capture recovers once with the same amount, reference and original time',async t=>{
  const storage=await openOfflineStorage({indexedDB:new IDBFactory(),name:crypto.randomUUID()});t.after(()=>storage.close())
  const device=await storage.device(),scope={businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId:'owner',deviceId:device.deviceId}
  await storage.activate({scope,role:'owner',writable:true},qrCatalogue)
  const requestId=crypto.randomUUID(),snapshot={request:{id:requestId,revision:1,status:'closed'}}
  const body={customer:{name:'Retained cash',mobile:'9876543210'},items:[{productId:'P001',quantity:1,unitType:'box'}]}
  const draft=(await storage.saveDraft(scope,{requestId,body,serverSnapshot:snapshot})).draft
  const occurredAt=new Date().toISOString(),payment={entryType:'PAYMENT',amountPaise:50,paymentMethod:'CASH',recordingMode:'OFFLINE',occurredAt}
  const captured=await storage.saveDraft(scope,draft,{kind:'PAYMENT',body:payment,requestId,occurredAt,expectedRevision:1})
  await storage.updateOperation(scope,captured.operation.operationId,{state:'discarded'})
  const replacement=(await storage.saveDraft(scope,{requestId,body,serverSnapshot:snapshot})).draft
  const recovery={kind:'PAYMENT',body:payment,requestId,occurredAt,expectedRevision:1,resolutionOf:captured.operation.operationId}
  await assert.rejects(storage.saveDraft(scope,replacement,{...recovery,body:{...payment,amountPaise:60}}),/preserve the original/)
  const saved=await storage.saveDraft(scope,replacement,recovery)
  assert.equal(saved.operation.occurredAt,occurredAt)
  assert.equal(saved.operation.resolutionOf,captured.operation.operationId)
  assert.equal((await storage.get('outbox',scope,captured.operation.operationId)).recoveredBy,saved.operation.operationId)
  await assert.rejects(storage.saveDraft(scope,saved.draft,recovery),/recovered once/)
})
