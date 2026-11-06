import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { openOfflineStorage } from './storage.js'
import { generateHandover, sellingLines, assertHandoverPreparation } from './handover.js'
import { createFrameCollector, encodeFrames, publicJwk, sign, transferScope, verifyTransfer } from '../../shared/handoverProtocol.js'
import { qrCatalogue } from '../../../tests/helpers/handoverFixtures.js'

test('one pending bill: cached Super Admin recipient, offline generation, frame verification and duplicate-safe acceptance', async () => {
  const indexedDB=new IDBFactory(),name=crypto.randomUUID()
  let storage=await openOfflineStorage({indexedDB,name})
  const root=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const rootKey=publicJwk(await crypto.subtle.exportKey('jwk',root.publicKey))
  const common={businessId:'shop',locationId:'loc-a',seasonId:'season-2026'}
  const sender={scope:{...common,userId:'seller',deviceId:'seller-device'},role:'admin',writable:true}
  const receiver={scope:{...common,userId:'super',deviceId:'receiver-device'},role:'super_admin',writable:true}
  async function prepare(profile,expired=false) {
    const identity=await storage.signingIdentity(profile.scope)
    const claims={v:1,scope:transferScope(profile.scope),userId:profile.scope.userId,deviceId:profile.scope.deviceId,role:profile.role,publicKey:identity.publicKey,
      issuedAt:new Date(Date.now()-10000).toISOString(),expiresAt:new Date(Date.now()+(expired?-1000:86400000)).toISOString()}
    const preparation={rootKey,certificate:{claims,signature:await sign(claims,root.privateKey)},recipients:[{userId:'super',role:'super_admin',name:'Super Admin'}],privateCatalogue:[]}
    await storage.activate(profile,qrCatalogue)
    return storage.saveHandoverPreparation(profile.scope,preparation)
  }
  await prepare(sender); await prepare(receiver)
  const body={customer:{name:'Pending customer',mobile:'9876543210'},items:[{lineId:'box-line',productId:'P001',unitType:'box',quantity:2},{lineId:'piece-line',productId:'P001',unitType:'piece',quantity:3}]}
  const draftId=crypto.randomUUID()
  await storage.saveDraft(sender.scope,{draftId,body},{kind:'CREATE',body:{...body,pricingMode:'selling'},catalogue:qrCatalogue,lineSnapshots:sellingLines(body.items,qrCatalogue,draftId)})
  storage.close(); storage=await openOfflineStorage({indexedDB,name})
  const originalFetch=globalThis.fetch
  globalThis.fetch=()=>{throw Error('No network allowed during QR transfer')}
  try {
    const profile=await storage.get('profiles',sender.scope,'profile')
    const drafts=await storage.list('drafts',sender.scope),operations=await storage.list('outbox',sender.scope)
    assert.equal(drafts.length,1);assert.equal(operations.length,1);assert.equal(operations[0].state,'pending')
    const recipientUserId=profile.handover.recipients.find(user=>user.role==='super_admin').userId
    const args={storage,profile,draft:drafts[0],operations,catalogue:qrCatalogue,recipientUserId}
    const envelope=await generateHandover(args)
    assert.deepEqual(await generateHandover(args),envelope,'same unchanged bill reuses transfer identity')
    const collect=createFrameCollector();let scanned
    for(const frame of encodeFrames(envelope).reverse())scanned=collect(frame)
    const receiverProfile=await storage.get('profiles',receiver.scope,'profile')
    await assertHandoverPreparation(storage,receiverProfile)
    await verifyTransfer(scanned.envelope,{rootKey,scope:receiver.scope,recipientUserId})
    assert.equal(scanned.envelope.payload.lines.reduce((sum,line)=>sum+line.quantity*line.sellingUnitPaise,0),23000)
    assert.equal(scanned.envelope.payload.lines.reduce((sum,line)=>sum+line.quantity*(line.unitType==='piece'?1:line.packSnapshot.piecesPerPack),0),23)
    const accepted=await storage.acceptHandover(receiver.scope,scanned.envelope,qrCatalogue)
    const duplicate=await storage.acceptHandover(receiver.scope,scanned.envelope,qrCatalogue)
    assert.equal(duplicate.duplicate,true);assert.equal(duplicate.draft.draftId,accepted.draft.draftId)
    assert.deepEqual(accepted.draft.body.items.map(line=>[line.unitType,line.quantity]),[['box',2],['piece',3]])
    const received=await storage.list('outbox',receiver.scope)
    assert.equal(received.length,1);assert.equal(received[0].payload.kind,'HANDOVER');assert.equal(received[0].state,'pending')
    assert.equal(accepted.draft.localClosure,undefined,'acceptance never finalizes or records payment')
    assert.equal((await storage.list('outbox',sender.scope))[0].state,'pending')
    await assert.rejects(generateHandover({...args,recipientUserId:'arbitrary'}),/authorized recipient/)
    await assert.rejects(verifyTransfer(envelope,{rootKey,scope:{...receiver.scope,locationId:'other'},recipientUserId}),/different user, business, stall or season/)
    const tampered=structuredClone(envelope);tampered.payload.lines[0].quantity++
    await assert.rejects(verifyTransfer(tampered,{rootKey,scope:receiver.scope,recipientUserId}),/signature/)
    await prepare(receiver,true)
    await assert.rejects(storage.acceptHandover(receiver.scope,envelope,qrCatalogue),/expired/)
    // Simulate a durable revocation directly: activate intentionally preserves
    // current authority when given a stale profile containing QR preparation.
    await storage.transact(['profiles'],'readwrite',tx=>tx.objectStore('profiles').put({...profile,authorityRevoked:true}))
    await assert.rejects(generateHandover(args),/revoked/)
  } finally {globalThis.fetch=originalFetch;storage.close()}
})
