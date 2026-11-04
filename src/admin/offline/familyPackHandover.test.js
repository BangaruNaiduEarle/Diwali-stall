import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { openOfflineStorage } from './storage.js'
import { generateHandover,sellingLines,matchTransferCatalogue } from './handover.js'
import { qrFixture,qrCatalogue,qrScope } from '../../../tests/helpers/handoverFixtures.js'
import { packFixture } from '../../../tests/helpers/familyPackFixtures.js'
import { createFrameCollector,encodeFrames,verifyTransfer,sign } from '../../shared/handoverProtocol.js'
import { familyPackVersion,transferProductIds } from '../../shared/familyPackSnapshot.js'
import { offlineFinancialPreview } from './financialPreview.js'

async function setup(products=qrCatalogue){
  const indexedDB=new IDBFactory(),name=crypto.randomUUID(),sender=await openOfflineStorage({indexedDB,name}),scope={...qrScope,userId:'admin',deviceId:'admin-device-1'}
  const identity=await sender.signingIdentity(scope)
  const fixture=await qrFixture({devicePair:{privateKey:identity.privateKey,publicKey:await crypto.subtle.importKey('jwk',identity.publicKey,{name:'ECDSA',namedCurve:'P-256'},true,['verify'])}})
  const pack=await packFixture({products}),profile={scope,role:'admin',writable:true,handover:{rootKey:fixture.rootKey,certificate:fixture.certificate,recipients:[{userId:'owner'}]}}
  await sender.activate(profile,products,[pack])
  const receiverIndexedDB=new IDBFactory(),receiverName=crypto.randomUUID(),receiver=await openOfflineStorage({indexedDB:receiverIndexedDB,name:receiverName}),receiverProfile={...profile,scope:qrScope,role:'owner'}
  await receiver.activate(receiverProfile,products,[pack])
  const draft={draftId:crypto.randomUUID(),body:{customer:{name:'Family Customer',mobile:'9876543210'},items:[{lineId:'pack-line-'+crypto.randomUUID(),familyPackId:pack.familyPackId,quantity:2,unitType:'box',familyPackSnapshot:structuredClone(pack)}]}}
  const lines=sellingLines(draft.body.items,products,draft.draftId)
  const saved=await sender.saveDraft(scope,draft,{kind:'CREATE',body:{customer:draft.body.customer,items:[{familyPackId:pack.familyPackId,quantity:2}],pricingMode:'selling'},lineSnapshots:lines,catalogue:products})
  const envelope=await generateHandover({storage:sender,profile,draft:saved.draft,operations:await sender.list('outbox',scope),catalogue:products,recipientUserId:'owner'})
  return {...fixture,pack,products,profile,scope,sender,receiver,receiverProfile,receiverIndexedDB,receiverName,envelope,draft:saved.draft}
}
test('Family Pack generation uses signed v2, stable variant/components/line IDs and unchanged saved snapshots after catalogue refresh',async()=>{
  const fixture=await setup(),{sender,receiver,pack,profile,scope,products,draft,envelope}=fixture
  assert.equal(envelope.payload.v,2);assert.equal(envelope.payload.lines[0].packSnapshot.variant.id,'FP001')
  assert.deepEqual(envelope.payload.lines[0].packSnapshot,pack)
  assert.equal(/purchase|profit|margin|privateKey|deviceToken|final_price/.test(JSON.stringify(envelope)),false)
  const changed=structuredClone(pack);changed.sellingUnitPaise++;changed.components[0].quantity++;changed.catalogueVersion=await familyPackVersion(changed)
  await sender.activate(profile,products,[changed])
  const repeat=await generateHandover({storage:sender,profile,draft,operations:await sender.list('outbox',scope),catalogue:products,recipientUserId:'owner'})
  assert.deepEqual(repeat,envelope)
  assert.deepEqual((await sender.get('drafts',scope,draft.draftId)).body.items[0].familyPackSnapshot,pack)
  sender.close();receiver.close()
})
test('multipart Family Pack QR decodes with the existing camera codec, verifies completely and accepts offline once across tabs/restart',async()=>{
  const fixture=await setup(),{envelope,rootKey,receiver,receiverIndexedDB,receiverName,pack,sender,products}=fixture
  const frames=encodeFrames(envelope),collect=createFrameCollector();let complete
  for(const frame of frames){
    const symbol=QRCode.create(frame,{errorCorrectionLevel:'M'}),scale=5,width=(symbol.modules.size+8)*scale,pixels=new Uint8ClampedArray(width*width*4).fill(255)
    for(let row=0;row<symbol.modules.size;row++)for(let col=0;col<symbol.modules.size;col++)if(symbol.modules.get(row,col))for(let y=0;y<scale;y++)for(let x=0;x<scale;x++){const offset=(((row+4)*scale+y)*width+(col+4)*scale+x)*4;pixels[offset]=pixels[offset+1]=pixels[offset+2]=0}
    const decoded=jsQR(pixels,width,width);assert.equal(decoded?.data,frame);complete=collect(decoded.data)
  }
  await verifyTransfer(complete.envelope,{rootKey,scope:qrScope,recipientUserId:'owner'})
  const other=await openOfflineStorage({indexedDB:receiverIndexedDB,name:receiverName})
  const accepted=await Promise.all([receiver.acceptHandover(qrScope,complete.envelope,products),other.acceptHandover(qrScope,complete.envelope,products)])
  assert.equal(accepted.filter(result=>result.duplicate).length,1)
  const row=(await receiver.list('outbox',qrScope))[0]
  assert.deepEqual(row.payload.body.transfer.payload.lines[0].packSnapshot,pack)
  assert.deepEqual(row.payload.catalogue.map(product=>product.id),transferProductIds(envelope.payload.lines))
  receiver.close();other.close()
  const reopened=await openOfflineStorage({indexedDB:receiverIndexedDB,name:receiverName})
  assert.equal((await reopened.list('outbox',qrScope))[0].payload.operationId,row.payload.operationId)
  assert.deepEqual((await reopened.list('drafts',qrScope))[0].body.items[0].familyPackSnapshot,pack)
  reopened.close();sender.close()
})
test('missing components, changed variants/composition/price/version/units and private-field injection cannot be imported',async()=>{
  const {sender,receiver,envelope,products,pack,rootKey,devicePair}=await setup()
  assert.equal(matchTransferCatalogue(envelope.payload,[],[pack])[0].matches,false)
  assert.equal(matchTransferCatalogue(envelope.payload,products,[])[0].matches,false)
  for(const change of [value=>value.components[0].quantity++,value=>value.variant.label='Different',value=>value.sellingUnitPaise++,value=>value.components[0].unitLabel='piece']){
    const current=structuredClone(pack);change(current);current.catalogueVersion=await familyPackVersion(current)
    await assert.rejects(receiver.acceptHandover(qrScope,envelope,products,[current]),/catalogue/)
  }
  const alteredProducts=[{...products[0],pieces_per_pack:5}]
  assert.equal(matchTransferCatalogue(envelope.payload,alteredProducts,[pack])[0].matches,false)
  await assert.rejects(receiver.acceptHandover(qrScope,envelope,products,[{...pack,catalogueVersion:'0'.repeat(64)}]),/catalogue/)
  const tampered=structuredClone(envelope);tampered.payload.lines[0].packSnapshot.components[0].quantity++
  await assert.rejects(verifyTransfer(tampered,{rootKey,scope:qrScope,recipientUserId:'owner'}))
  tampered.signature=await sign(tampered.payload,devicePair.privateKey)
  await assert.rejects(verifyTransfer(tampered,{rootKey,scope:qrScope,recipientUserId:'owner'}),/catalogue version/)
  const unsafe=structuredClone(envelope);unsafe.payload.lines[0].packSnapshot.purchasePricePaise=1
  await assert.rejects(verifyTransfer(unsafe,{rootKey,scope:qrScope,recipientUserId:'owner'}))
  assert.equal((await receiver.list('drafts',qrScope)).length,0)
  sender.close();receiver.close()
})
test('80-component Family Pack multipart transfer retains every quantity, unit and ID; oversized requests are rejected',async()=>{
  const products=Array.from({length:80},(_,index)=>({...qrCatalogue[0],id:'P'+(1000+index),name:'Family component '+index}))
  const {sender,receiver,envelope,rootKey}=await setup(products),frames=encodeFrames(envelope),collect=createFrameCollector();let result
  assert.ok(frames.length>20)
  for(const frame of [...frames].reverse())result=collect(frame)
  await verifyTransfer(result.envelope,{rootKey,scope:qrScope,recipientUserId:'owner'})
  const accepted=await receiver.acceptHandover(qrScope,result.envelope,products)
  assert.equal(accepted.draft.body.items[0].familyPackSnapshot.components.length,80)
  assert.equal(accepted.draft.body.items[0].familyPackSnapshot.components[79].quantity,82)
  assert.equal((await receiver.list('outbox',qrScope))[0].payload.catalogue.length,80)
  const oversized=structuredClone(envelope)
  oversized.payload.lines=Array.from({length:10},(_,index)=>({...structuredClone(envelope.payload.lines[0]),lineId:'line-'+index,familyPackId:'FP'+(100+index),packSnapshot:{...structuredClone(envelope.payload.lines[0].packSnapshot),familyPackId:'FP'+(100+index),variant:{...envelope.payload.lines[0].packSnapshot.variant,id:'FP'+(100+index)}}}))
  assert.throws(()=>encodeFrames(oversized),/safe transfer limit/)
  sender.close();receiver.close()
})
test('mixed product/pack lines and price estimates preserve fixed pack price while ordinary product QR remains v1',async()=>{
  const {sender,receiver,profile,scope,products,draft,pack}=await setup()
  const mixed=await sender.saveDraft(scope,{...draft,body:{...draft.body,items:[...draft.body.items,{productId:'P001',quantity:1,unitType:'piece'}]}})
  const envelope=await generateHandover({storage:sender,profile,draft:mixed.draft,operations:await sender.list('outbox',scope),catalogue:products,recipientUserId:'owner'})
  assert.equal(envelope.payload.lines.length,2);assert.equal(envelope.payload.v,2)
  const estimate=offlineFinancialPreview(mixed.draft,products,[{id:'P001',purchase_unit_paise:100,final_price_paise:1000}])
  assert.equal(estimate.selling,pack.sellingUnitPaise*2+1000);assert.equal(estimate.purchase,null);assert.equal(estimate.profit,null)
  const ordinary=await sender.saveDraft(scope,{draftId:crypto.randomUUID(),body:{customer:draft.body.customer,items:[{productId:'P001',quantity:1,unitType:'box'}]}},{kind:'CREATE',body:{customer:draft.body.customer,items:[{productId:'P001',quantity:1,unitType:'box'}]},catalogue:products})
  const normal=await generateHandover({storage:sender,profile,draft:ordinary.draft,operations:await sender.list('outbox',scope),catalogue:products,recipientUserId:'owner'})
  assert.equal(normal.payload.v,1);assert.equal(Object.hasOwn(normal.payload.lines[0],'familyPackId'),false)
  assert.throws(()=>sellingLines([{familyPackId:'FP001',quantity:1,unitType:'box'}],products,'old-draft'),/historical Family Pack/)
  sender.close();receiver.close()
})
test('legacy drafts that previously omitted Family Packs cannot silently delete them through QR or item editing',async()=>{
  const {sender,receiver,profile,scope,products,draft}=await setup()
  const legacy=await sender.saveDraft(scope,{...draft,body:{...draft.body,items:[{productId:'P001',quantity:1,unitType:'box'}]},serverSnapshot:{request:{items:[{familyPackId:'FP001'}],creatorUserId:'admin',createdAt:new Date().toISOString()}}})
  await assert.rejects(generateHandover({storage:sender,profile,draft:legacy.draft,operations:await sender.list('outbox',scope),catalogue:products,recipientUserId:'owner'}),/predates complete Family Pack snapshots/)
  const pending=(await sender.list('outbox',scope))[0]
  assert.equal(pending.payload.lineSnapshots[0].familyPackId,'FP001')
  sender.close();receiver.close()
})
