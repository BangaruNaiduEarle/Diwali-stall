import {synchronizeOutbox} from './synchronize.js'
import {verifyOfflineGrant} from '../../shared/offlineGrant.js'

export function assertSignedBillingSession(session,scope){
  if(!session.ok||session.effectiveRole!=='admin'||session.capabilities?.write!==true||
    session.userId!==scope.userId||session.activeBusinessId!==scope.businessId||session.activeLocationId!==scope.locationId||session.activeSeasonId!==scope.seasonId)throw Error('Sign in to the matching Admin, stall and season before continuing.')
}

// The online UI uses the same scoped key, IDB transactions, immutable outbox,
// signed operations and sync endpoint as the POS. It never calls legacy financial routes.
export async function prepareSignedBilling(storage,api){
  const confirmed=await api.session()
  const device=await storage.device()
  const scope={businessId:confirmed.activeBusinessId,locationId:confirmed.activeLocationId,seasonId:confirmed.activeSeasonId,userId:confirmed.userId,deviceId:device.deviceId}
  assertSignedBillingSession(confirmed,scope)
  const registered=await api.register(device)
  if(!registered.ok)throw Error(registered.message)
  const catalogue=await api.catalogue()
  if(!catalogue.ok)throw Error(catalogue.message)
  if([registered.scope,catalogue.scope].some(result=>['businessId','locationId','seasonId','userId'].some(key=>result?.[key]!==scope[key])))throw Error('The selected billing scope changed during preparation.')
  const identity=await storage.signingIdentity(scope)
  const prepared=await api.authorization({deviceId:device.deviceId,deviceToken:device.deviceToken,publicKey:identity.publicKey})
  if(!prepared.ok)throw Error(prepared.message)
  if(!prepared.authorization){
    if(await storage.get('profiles',scope,'profile'))await storage.saveAuthorization(scope,null)
    throw Error('No signed Billing Finalization authorization is available. Ask this stall Owner or Super Admin to grant permission, then prepare again.')
  }
  if(prepared.authorization.grant?.claims?.canFinalize===false){
    if(await storage.get('profiles',scope,'profile'))await storage.saveAuthorization(scope,prepared.authorization)
    throw Error('This signed grant permits Final Price viewing only. Billing Finalization authorization is required.')
  }
  await verifyOfflineGrant(prepared.authorization,scope,{finalize:true})
  assertSignedBillingSession(await api.session(),scope)
  const previous=await storage.get('profiles',scope,'profile')
  await storage.activate({scope,role:'admin',writable:true,email:confirmed.email,confirmedAt:new Date().toISOString(),label:`${confirmed.business?.name??scope.businessId} / ${confirmed.location?.name??scope.locationId}`,
    ...(previous?.handover&&previous.role==='admin'&&!previous.authorityRevoked?{handover:{...previous.handover,privateCatalogue:[]}}:{})},catalogue.products,catalogue.familyPacks??[],catalogue.familyPackIssues??[])
  return storage.saveAuthorization(scope,prepared.authorization)
}

export async function openSignedRequest(storage,profile,snapshot){
  const requestId=snapshot.request.id
  const rows=await storage.list('outbox',profile.scope)
  const drafts=await storage.list('drafts',profile.scope)
  const ids=new Set(drafts.filter(row=>row.requestId===requestId).map(row=>row.draftId))
  if(rows.some(row=>ids.has(row.draftId)&&!['synced','resolved','discarded'].includes(row.state)))throw Error('This bill has preserved local actions. Open Offline Billing to synchronize or review them before opening another version.')
  const request=snapshot.request
  const saved=await storage.saveDraft(profile.scope,{draftId:crypto.randomUUID(),requestId,expectedRevision:request.revision,serverSnapshot:snapshot,familyPackSnapshotsVersion:1,
    agreedInr:snapshot.acceptedAmountPaise==null?'':(snapshot.acceptedAmountPaise/100).toFixed(2),discountInr:'',
    body:{customer:{name:request.customerName,mobile:request.customerPhone},items:request.items.map(item=>item.familyPackId?{lineId:item.lineId,familyPackId:item.familyPackId,quantity:item.quantity,unitType:'box',familyPackSnapshot:item.packSnapshot}:{lineId:item.lineId,productId:item.productId,quantity:item.quantity,unitType:item.unitType??'box'})}})
  return saved.draft
}

export async function synchronizeSignedDraft(storage,scope,draftId,api,isCurrent){
  assertSignedBillingSession(await api.session(),scope)
  if(!isCurrent())return
  // An explicit operator retry may bypass the automatic backoff, while keeping
  // exactly the original signed operation, timestamp and operation ID.
  for(const row of await storage.list('outbox',scope))if(row.draftId===draftId&&row.state==='pending'&&row.nextAttemptAt>0)await storage.updateOperation(scope,row.payload.operationId,{nextAttemptAt:0})
  const device=await storage.device()
  const ownStorage={get:storage.get.bind(storage),updateOperation:storage.updateOperation.bind(storage),
    list:async(...args)=>(await storage.list(...args)).filter(row=>args[0]!=='outbox'||row.draftId===draftId)}
  return synchronizeOutbox({storage:ownStorage,scope,deviceToken:device.deviceToken,send:api.send,fetchSnapshot:api.snapshot,isCurrent})
}
