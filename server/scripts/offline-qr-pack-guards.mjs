// Focused module validation with the actual new signed two-variant transfer.
// Uses fake IndexedDB only; no SQL schemas, migrations or server business writes.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {IDBFactory} from 'fake-indexeddb'
import {openOfflineStorage} from '../../src/admin/offline/storage.js'
import {sellingLines,assertCompleteFamilyDraft} from '../../src/admin/offline/handover.js'
import {adjustmentPayload} from '../../src/admin/lib/billAdjustment.js'
import {verifyTransfer,validatePayload,encodeFrames,createFrameCollector} from '../../src/shared/handoverProtocol.js'
import {validateFamilyPackSnapshot,familyPackVersion} from '../../src/shared/familyPackSnapshot.js'
import {offlineFinancialPreview} from '../../src/admin/offline/financialPreview.js'

const root=path.resolve(process.argv[2]),{directory}=JSON.parse(await readFile(path.join(root,'phase6-current.json'),'utf8'))
assert.ok(directory.startsWith(root+path.sep)&&path.basename(directory).startsWith('p6-'))
const state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')),progress=JSON.parse(await readFile(path.join(directory,'browser-progress.json'),'utf8'))
const {saved}=progress,{envelope,rootKey}=saved.mixed,products=saved.catalogue.products,packs=saved.catalogue.familyPacks,pack=envelope.payload.lines.find(l=>l.familyPackId).packSnapshot,results=[]
const scope={...envelope.payload.scope,userId:state.actors.owner.id,deviceId:'phase6-module-validation'}
const options={rootKey,scope,recipientUserId:state.actors.owner.id}
const focus=new Set(process.argv.slice(3))
async function check(name,category,run){if(focus.size&&!focus.has(name))return;try{const evidence=await run();results.push({name,category,status:'PASS',evidence});console.log('PASS '+name)}catch(error){results.push({name,category,status:'FAIL',error:error.stack});console.log('FAIL '+name+' '+error.message)}}
async function denied(work,pattern){let error;try{await work()}catch(e){error=e}assert.ok(error,'Unsupported input was silently accepted');assert.ok(error.message);if(pattern)assert.match(error.message,pattern);return{rejected:true,message:error.message}}
async function importDenied(currentProducts=products,currentPacks=packs,role='owner'){
 const storage=await openOfflineStorage({indexedDB:new IDBFactory(),name:crypto.randomUUID()})
 try{await storage.activate({scope,role,writable:true,handover:{rootKey}},currentProducts,currentPacks);const evidence=await denied(()=>storage.acceptHandover(scope,envelope,currentProducts,currentPacks));assert.equal((await storage.list('drafts',scope)).length,0);assert.equal((await storage.list('outbox',scope)).length,0);return{...evidence,drafts:0,outbox:0}}finally{storage.close()}
}
await check('P6-GUARD-valid-signature','control',async()=>{await verifyTransfer(envelope,options);return{valid:true,variants:2}})
await check('P6-GUARD-tampered-composition','security',async()=>{const e=structuredClone(envelope);e.payload.lines.find(l=>l.familyPackId).packSnapshot.components[0].quantity++;return denied(()=>verifyTransfer(e,options))})
await check('P6-GUARD-private-field-injection','security',async()=>{const e=structuredClone(envelope);e.payload.lines.find(l=>l.familyPackId).packSnapshot.purchasePricePaise=1;return denied(()=>verifyTransfer(e,options))})
await check('P6-GUARD-invalid-recipient','security',()=>denied(()=>verifyTransfer(envelope,{...options,recipientUserId:state.actors.super.id}),/different user/))
await check('P6-GUARD-expired-preparation','security',()=>denied(()=>verifyTransfer(envelope,{...options,now:Date.parse(envelope.certificate.claims.expiresAt)+1}),/expired/))
await check('P6-GUARD-admin-acceptance','security',()=>importDenied(products,packs,'admin'))
await check('P6-GUARD-missing-component','catalogue',()=>importDenied(products.slice(1),packs))
await check('P6-GUARD-missing-variant','catalogue',()=>importDenied(products,packs.filter(p=>p.familyPackId!==pack.familyPackId)))
await check('P6-GUARD-version-only-mismatch','catalogue',()=>importDenied(products,packs.map(p=>p.familyPackId===pack.familyPackId?{...p,catalogueVersion:'0'.repeat(64)}:p)))
for(const [name,mutate]of [['changed-variant',p=>{p.variant.label='Different variant'}],['changed-units',p=>{p.components[0].unitLabel='piece'}],['changed-composition',p=>{p.components[0].quantity++}],['changed-fixed-price',p=>{p.sellingUnitPaise++}]]){
 await check('P6-GUARD-'+name,'catalogue',async()=>{const current=structuredClone(pack);mutate(current);current.catalogueVersion=await familyPackVersion(current);return importDenied(products,packs.map(p=>p.familyPackId===current.familyPackId?current:p))})
}
for(const [name,mutate]of [['custom-options',p=>{p.variant.options=['custom']}],['empty-components',p=>{p.components=[]}],['nested-pack',p=>{p.components[0].familyPackId=pack.familyPackId}],['component-fraction',p=>{p.components[0].quantity=0.5}],['component-over-limit',p=>{p.components[0].quantity=1000}],['81-components',p=>{p.components=Array.from({length:81},(_,i)=>({...p.components[0],componentId:String(100000+i),productId:'P999'+i}))}]]){
 await check('P6-BLOCK-'+name,'unsupported',()=>{const value=structuredClone(pack);mutate(value);return denied(()=>validateFamilyPackSnapshot(value))})
}
for(const [name,mutate]of [['fractional-whole-pack',l=>{l.quantity=1.5}],['100-whole-packs',l=>{l.quantity=100}],['loose-pack-unit',l=>{l.unitType='piece'}]]){
 await check('P6-BLOCK-'+name,'unsupported',()=>{const p=structuredClone(envelope.payload);mutate(p.lines.find(l=>l.familyPackId));return denied(()=>validatePayload(p))})
}
await check('P6-BLOCK-historical-missing-snapshot','unsupported',()=>denied(()=>sellingLines([{familyPackId:pack.familyPackId,quantity:1,unitType:'box'}],products,'historical'),/historical Family Pack/))
await check('P6-BLOCK-legacy-partial-draft','unsupported',()=>denied(()=>assertCompleteFamilyDraft({serverSnapshot:{request:{items:[{familyPackId:pack.familyPackId}]}}}),/predates complete Family Pack snapshots/))
await check('P6-BLOCK-pack-unit-price-override','unsupported',()=>{const value=adjustmentPayload([{familyPackId:pack.familyPackId,quantity:1,priceInr:'1.00'}],{privileged:true});assert.equal(value.ok,false);assert.match(value.message,/unsupported/);return{rejected:true,message:value.message}})
await check('P6-BLOCK-oversized-cart','unsupported',()=>{const e=structuredClone(envelope);for(const line of e.payload.lines.filter(l=>l.familyPackId))line.packSnapshot.components=Array.from({length:80},(_,i)=>({...line.packSnapshot.components[0],componentId:String(100000+i),productId:'P999'+i,productName:'A'.repeat(300),packSnapshot:{...line.packSnapshot.components[0].packSnapshot,pack:'B'.repeat(300),company:'C'.repeat(300)}}));return denied(()=>encodeFrames(e),/safe transfer limit/)} )
await check('P6-BLOCK-51-request-lines','unsupported',()=>{const e=structuredClone(envelope);e.payload.lines=Array.from({length:51},(_,i)=>({...envelope.payload.lines[0],lineId:'line-'+i,productId:'P999'+i}));return denied(()=>encodeFrames(e),/1–50/)} )
await check('P6-GUARD-incomplete-and-mixed-frames','framing',async()=>{const collect=createFrameCollector();const first=collect(saved.mixed.frames[0]);assert.equal(first.envelope,undefined);assert.equal(first.received,1);const mixed=await denied(()=>collect(saved.normal.frames[0]),/Another transfer/);const conflict=await denied(()=>collect(saved.mixed.frames[0].slice(0,-1)+'Z'),/Conflicting/);return{incompleteDoesNotVerify:true,mixed,conflict}})
await check('P6-GUARD-component-substitution','catalogue',async()=>{const current=structuredClone(pack);current.components[0].productId='P999999999';current.components[0].productName='Unauthorized substitute';current.catalogueVersion=await familyPackVersion(current);return importDenied(products,packs.map(p=>p.familyPackId===current.familyPackId?current:p))})
await check('P6-GUARD-no-inferred-pack-financials','unsupported',()=>{const items=envelope.payload.lines.map(l=>l.familyPackId?{familyPackId:l.familyPackId,quantity:l.quantity,familyPackSnapshot:l.packSnapshot}:{productId:l.productId,quantity:l.quantity,unitType:l.unitType});const value=offlineFinancialPreview({body:{items},agreedInr:'500'},products,products.map(p=>({id:p.id,purchase_unit_paise:5000,final_price_paise:8000})));assert.equal(value.purchase,null);assert.equal(value.profit,null);assert.equal(value.margin,null);assert.equal(value.reference,null);assert.equal(value.total,50000);return{unsupportedEstimatesRemainUnknown:true,payablePaise:value.total,noReferenceAdded:true}})
const output=path.join(directory,'guard-results-'+Date.now()+'.json');await writeFile(output,JSON.stringify({source:'Actual Phase 6 transfer, production modules, fake-indexeddb; no Worker mutations',results},null,2),{flag:'wx'});console.log(JSON.stringify({output,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length}));if(results.some(r=>r.status==='FAIL'))process.exitCode=1
