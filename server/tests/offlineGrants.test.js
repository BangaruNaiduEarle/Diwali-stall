import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { workflowDb } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { handleAdminOfflineRoutes } from '../src/routes/adminOfflineSync.js'
import { publicJwk, sign, transferScope, transferCustomer, offlineRequestId } from '../../src/shared/handoverProtocol.js'
import { sellingLines } from '../../src/admin/offline/handover.js'
import { grantOperationMessage, verifyOfflineGrant } from '../../src/shared/offlineGrant.js'
import { Miniflare } from '../node_modules/miniflare/dist/src/index.js'

async function fixture(t, native=false, billing=false) {
  let db=await workflowDb(t)
  for(const file of ['0023_offline_sync_receipts.sql','0024_qr_handover.sql','0028_offline_final_price_grants.sql']) await db.script(readFileSync(new URL('../database/migrations/'+file,import.meta.url),'utf8'))
  if(billing)await db.script(readFileSync(new URL('../database/migrations/0029_billing_finalization_permissions.sql',import.meta.url),'utf8'))
  if(native){
    const schema=(await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").bind().all()).results
    const records=[]
    for(const table of schema.filter(row=>row.type==='table'))records.push({name:table.name,rows:(await db.prepare(`SELECT * FROM "${table.name}"`).bind().all()).results})
    const runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("local fixture")}}',compatibilityDate:'2025-04-01',host:'127.0.0.1',port:0,d1Databases:['DB'],d1Persist:false,cachePersist:false,kvPersist:false,r2Persist:false,durableObjectsPersist:false})
    t.after(()=>runtime.dispose());db=await runtime.getD1Database('DB')
    for(const row of schema.filter(row=>row.type==='table'))await db.prepare(row.sql).run()
    await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'),...records.flatMap(table=>table.rows.map(row=>{const keys=Object.keys(row);return db.prepare(`INSERT INTO "${table.name}" (${keys.map(key=>`"${key}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>row[key]))}))])
    for(const type of ['index','view','trigger'])for(const row of schema.filter(row=>row.type===type))await db.prepare(row.sql).run()
  }
  const baseBatch=db.batch.bind(db)
  db.batch=async statements=>{try{return await baseBatch(statements)}catch(error){db.lastBatchError=error.message;throw error}}
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
  const root=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const env={DB:db,HANDOVER_SIGNING_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',root.privateKey))}
  const scope={businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId:'admin',deviceId:'grant-admin-device'}
  const deviceToken='ab'.repeat(32), publicKey=publicJwk(await crypto.subtle.exportKey('jwk',pair.publicKey))
  const api=async(path,body,actor='admin',location='loc-a')=>{
    const request=new Request('http://localhost/api/admin/offline/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Admin-Season-Id':'season-2026','X-Admin-Location-Id':location},...(body?{body:JSON.stringify(body)}:{})})
    const identity={userId:actor,email:actor+'@test.com'}
    const attached=await attachAdminRequestContext(request,db,identity,{ADMIN_LOCATION_MODE:true})
    if(!attached.ok)return {status:attached.status,...attached}
    const response=await handleAdminOfflineRoutes(request,env,identity)
    return {status:response.status,...await response.json()}
  }
  assert.equal((await api('devices',{deviceId:scope.deviceId,deviceToken})).status,200)
  assert.equal((await api('grants/prepare',{deviceId:scope.deviceId,deviceToken,publicKey})).authorization,null)
  const issue=async(canFinalize=true)=>{
    const input={grantId:crypto.randomUUID(),userId:'admin',deviceId:scope.deviceId,canFinalize,hours:8}
    const result=await api('grants/issue',input,'owner')
    assert.equal(result.status,200,JSON.stringify(result)+' '+(db.lastBatchError??''))
    const prepared=await api('grants/prepare',{deviceId:scope.deviceId,deviceToken,publicKey})
    assert.equal(prepared.status,200,JSON.stringify(prepared))
    return {input,authorization:prepared.authorization}
  }
  const create=async()=>{
    const catalogue=(await api('catalogue')).products
    const op={operationId:crypto.randomUUID(),scope,deviceToken,occurredAt:new Date().toISOString(),kind:'CREATE',catalogue,
      body:{customer:{name:'Granted Admin customer',mobile:'9876543210'},items:[{productId:'P001',quantity:1}],pricingMode:'selling'}}
    const result=await api('sync',op)
    assert.equal(result.status,200,JSON.stringify(result)+' '+(db.lastBatchError??''));return result
  }
  const operation=async(grant,kind,body,extra={})=>{
    const op={operationId:crypto.randomUUID(),scope,capturedRole:'admin',occurredAt:new Date().toISOString(),kind,body,...extra,authorization:{grant:grant.grant}}
    op.authorization.proof=await sign(grantOperationMessage(op),pair.privateKey)
    return {...op,deviceToken}
  }
  const finalizedEnvelope=async(authorizationOverride)=>{
    const authorization=authorizationOverride??(await issue()).authorization
    const prep=await api('handover/prepare',{deviceId:scope.deviceId,deviceToken,publicKey})
    assert.equal(prep.status,200,JSON.stringify(prep))
    const catalogue=(await api('catalogue')).products
    const customer={name:'Finalized QR customer',mobile:'9876543210'},items=[{productId:'P001',quantity:1,unitType:'box'}]
    const creation={operationId:crypto.randomUUID(),scope,capturedRole:'admin',occurredAt:new Date().toISOString(),kind:'CREATE',catalogue,lineSnapshots:sellingLines(items,catalogue,'finalized-qr'),body:{customer,items,pricingMode:'selling'}}
    const agreement=await operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{parentOperationId:creation.operationId})
    const close=await operation(authorization,'CLOSE',{}, {parentOperationId:agreement.operationId})
    const chain=[creation,agreement,close].map(op=>{const {deviceToken,...saved}=op;void deviceToken;return saved})
    const requestId=await offlineRequestId(scope,creation.operationId)
    const payload={v:3,transferId:crypto.randomUUID(),scope:transferScope(scope),requestId,revision:null,sourceOperationId:creation.operationId,creatorUserId:'admin',recipientUserId:'owner',occurredAt:new Date().toISOString(),sourceOccurredAt:creation.occurredAt,customer:transferCustomer(customer),lines:creation.lineSnapshots,bill:{agreedAmountPaise:100,operations:chain}}
    const envelope={payload,certificate:prep.certificate,signature:await sign(payload,pair.privateKey)}
    const ownerScope={...scope,userId:'owner',deviceId:'owner-qr-device'}
    assert.equal((await api('devices',{deviceId:ownerScope.deviceId,deviceToken},'owner')).status,200)
    const handoff={operationId:crypto.randomUUID(),kind:'HANDOVER',scope:ownerScope,deviceToken,capturedRole:'owner',occurredAt:new Date().toISOString(),requestId,expectedRevision:null,body:{transfer:envelope},catalogue}
    return {envelope,handoff,chain,authorization,ownerScope}
  }
  return {db,env,api,scope,deviceToken,publicKey,pair,root,issue,create,operation,finalizedEnvelope}
}

for(const grantor of ['owner','super'])test(`Billing Finalization: ${grantor} grants one Admin; signed online agreement edits, closure and receipt audit retain both actors`,async t=>{
  const f=await fixture(t,grantor==='super',true)
  assert.deepEqual((await f.api('billing-permissions',null,grantor)).permissions,[])
  const permission={userId:'admin',enabled:true,operationId:crypto.randomUUID()}
  assert.equal((await f.api('billing-permissions',permission,grantor)).status,200)
  assert.equal((await f.api('billing-permissions',permission,grantor)).idempotentReplay,true)
  assert.equal((await f.api('billing-permissions',{...permission,operationId:crypto.randomUUID()},grantor)).status,409)
  const prepare=()=>f.api('grants/prepare',{deviceId:f.scope.deviceId,deviceToken:f.deviceToken,publicKey:f.publicKey})
  const authorization=(await prepare()).authorization
  assert.equal(authorization.grant.claims.ownerUserId,grantor)
  await verifyOfflineGrant(authorization,f.scope,{finalize:true})
  assert.equal((await prepare()).authorization.grant.claims.grantId,authorization.grant.claims.grantId)
  const created=await f.create()
  const first=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:1000},{requestId:created.requestId,expectedRevision:created.revision})
  const agreed=await f.api('sync',first);assert.equal(agreed.status,200,JSON.stringify(agreed))
  const edited=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{parentOperationId:first.operationId})
  assert.equal((await f.api('sync',edited)).status,200)
  const close=await f.operation(authorization,'CLOSE',{}, {parentOperationId:edited.operationId})
  const closed=await f.api('sync',close);assert.equal(closed.status,200,JSON.stringify(closed))
  assert.equal(closed.delegation.ownerUserId,grantor);assert.equal(closed.delegation.actorUserId,'admin')
  assert.equal((await f.api('sync',close)).idempotentReplay,true)
  const events=(await f.db.prepare('SELECT actor_user_id,metadata_json FROM request_workflow_events WHERE request_id=?').bind(created.requestId).all()).results
  assert.ok(events.some(row=>row.actor_user_id==='admin'&&JSON.parse(row.metadata_json).before?.acceptedAmountPaise===1000&&JSON.parse(row.metadata_json).after?.acceptedAmountPaise===100))
  const uses=(await f.db.prepare(`SELECT u.kind,g.owner_user_id,g.billing_permission_id FROM offline_final_price_uses u JOIN offline_final_price_grants g ON g.id=u.grant_id WHERE u.request_id=?`).bind(created.requestId).all()).results
  assert.deepEqual(uses.map(row=>row.kind),['AGREEMENT','AGREEMENT','CLOSE'])
  assert.ok(uses.every(row=>row.owner_user_id===grantor&&row.billing_permission_id===permission.operationId))
  const payment={...close,operationId:crypto.randomUUID(),kind:'PAYMENT',body:{entryType:'PAYMENT',amountPaise:100,paymentMethod:'CASH',recordingMode:'OFFLINE'}}
  assert.equal((await f.api('sync',payment)).status,403)
  const revoke={userId:'admin',enabled:false,operationId:crypto.randomUUID()}
  assert.equal((await f.api('billing-permissions',revoke,grantor)).status,200)
  assert.equal((await f.api('billing-permissions',revoke,grantor)).idempotentReplay,true)
  assert.equal((await f.api('billing-permissions',{...revoke,operationId:crypto.randomUUID()},grantor)).status,409)
  const row=await f.db.prepare('SELECT * FROM billing_finalization_permissions WHERE id=?').bind(permission.operationId).first()
  assert.equal(row.revoked_by,grantor);assert.equal(row.revoke_operation_id,revoke.operationId)
  assert.equal((await f.api('sync',close)).idempotentReplay,true)
  assert.equal((await prepare()).authorization,null)
})

test('Billing Finalization: default deny, no self-grant/cross-stall transplant; revocation and issuer demotion reject new proofs',async t=>{
  const f=await fixture(t,false,true),permission={userId:'admin',enabled:true,operationId:crypto.randomUUID()}
  assert.equal((await f.api('billing-permissions',permission)).status,403)
  assert.equal((await f.api('billing-permissions',permission,'super','loc-b')).status,403)
  assert.equal((await f.api('billing-permissions',permission,'super')).status,200)
  const authorization=(await f.api('grants/prepare',{deviceId:f.scope.deviceId,deviceToken:f.deviceToken,publicKey:f.publicKey})).authorization
  const created=await f.create(),operation=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  assert.equal((await f.api('billing-permissions',{userId:'admin',enabled:false,operationId:crypto.randomUUID()},'owner')).status,200)
  assert.equal((await f.api('sync',operation)).status,403)
  assert.equal((await f.api('billing-permissions',{...permission,operationId:crypto.randomUUID()},'super')).status,200)
  await f.db.prepare("UPDATE location_members SET disabled_at='disabled' WHERE location_id='loc-a' AND admin_user_id='super'").bind().run()
  await f.db.prepare("UPDATE location_members SET disabled_at=NULL WHERE location_id='loc-a' AND admin_user_id='super'").bind().run()
  assert.deepEqual((await f.api('billing-permissions',null,'owner')).permissions,[])
  assert.equal((await f.api('grants/prepare',{deviceId:f.scope.deviceId,deviceToken:f.deviceToken,publicKey:f.publicKey})).authorization,null)
})

test('Billing Finalization migration preserves existing signed grants, immutable receipts and independent revocation behavior',async t=>{
  const f=await fixture(t),{authorization}=await f.issue(),created=await f.create()
  const operation=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  assert.equal((await f.api('sync',operation)).status,200)
  const before=await f.db.prepare('SELECT * FROM offline_final_price_grants').bind().all()
  await f.db.script(readFileSync(new URL('../database/migrations/0029_billing_finalization_permissions.sql',import.meta.url),'utf8'))
  const after=await f.db.prepare('SELECT * FROM offline_final_price_grants').bind().all()
  assert.deepEqual(after.results.map(({billing_permission_id,...row})=>{assert.equal(billing_permission_id,null);return row}),before.results)
  assert.deepEqual((await f.api('billing-permissions',null,'owner')).permissions,[])
  assert.equal((await f.api('sync',operation)).idempotentReplay,true)
  const permission={userId:'admin',enabled:true,operationId:crypto.randomUUID()}
  assert.equal((await f.api('billing-permissions',permission,'super')).status,200)
  assert.equal((await f.api('billing-permissions',{userId:'admin',enabled:false,operationId:crypto.randomUUID()},'super')).status,200)
  const close=await f.operation(authorization,'CLOSE',{}, {parentOperationId:operation.operationId})
  assert.equal((await f.api('sync',close)).status,200)
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').bind().all()).results,[])
})

test('Billing Finalization revocation at commit rolls back the agreement and receipt; stale revisions never overwrite amounts',async t=>{
  const f=await fixture(t,false,true)
  const permission={userId:'admin',enabled:true,operationId:crypto.randomUUID()}
  assert.equal((await f.api('billing-permissions',permission,'super')).status,200)
  const authorization=(await f.api('grants/prepare',{deviceId:f.scope.deviceId,deviceToken:f.deviceToken,publicKey:f.publicKey})).authorization
  const created=await f.create()
  const operation=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  const batch=f.db.batch.bind(f.db);let revoked=false
  f.db.batch=async statements=>{
    if(!revoked&&statements.some(row=>row.sql.includes('INSERT INTO offline_final_price_uses'))){
      revoked=true
      await f.db.prepare("UPDATE billing_finalization_permissions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revoked_by='super',revoke_operation_id=? WHERE id=?").bind(crypto.randomUUID(),permission.operationId).run()
    }
    return batch(statements)
  }
  assert.equal((await f.api('sync',operation)).status,403)
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM offline_sync_receipts WHERE operation_id=?').bind(operation.operationId).first()).n,0)
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM offline_final_price_uses WHERE operation_id=?').bind(operation.operationId).first()).n,0)
  assert.equal((await f.api('requests/'+created.requestId,'','owner')).acceptedAmountPaise,null)
  await f.api('billing-permissions',{...permission,operationId:crypto.randomUUID()},'owner')
  const fresh=(await f.api('grants/prepare',{deviceId:f.scope.deviceId,deviceToken:f.deviceToken,publicKey:f.publicKey})).authorization
  const first=await f.operation(fresh,'AGREEMENT',{acceptedAmountPaise:200},{requestId:created.requestId,expectedRevision:created.revision})
  const second=await f.operation(fresh,'AGREEMENT',{acceptedAmountPaise:300},{requestId:created.requestId,expectedRevision:created.revision})
  assert.equal((await f.api('sync',first)).status,200)
  assert.equal((await f.api('sync',second)).status,409)
  assert.equal((await f.api('requests/'+created.requestId,'','owner')).acceptedAmountPaise,200)
})

test('Billing Finalization Super Admin grant supports native Local D1 finalized QR, dependent Owner payment and exact replay',async t=>{
  const f=await fixture(t,true,true)
  assert.equal((await f.api('billing-permissions',{userId:'admin',enabled:true,operationId:crypto.randomUUID()},'super')).status,200)
  const authorization=(await f.api('grants/prepare',{deviceId:f.scope.deviceId,deviceToken:f.deviceToken,publicKey:f.publicKey})).authorization
  const {handoff,ownerScope,chain}=await f.finalizedEnvelope(authorization)
  const accepted=await f.api('sync',handoff,'owner')
  assert.equal(accepted.status,200,JSON.stringify(accepted))
  const payment={operationId:crypto.randomUUID(),kind:'PAYMENT',scope:ownerScope,deviceToken:f.deviceToken,capturedRole:'owner',occurredAt:new Date().toISOString(),parentOperationId:handoff.operationId,body:{entryType:'PAYMENT',amountPaise:100,paymentMethod:'CASH',recordingMode:'OFFLINE'}}
  assert.equal((await f.api('sync',payment,'owner')).status,200)
  assert.equal((await f.api('sync',payment,'owner')).idempotentReplay,true)
  assert.equal((await f.api('sync',{...chain.at(-1),deviceToken:f.deviceToken})).idempotentReplay,true)
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM request_payment_ledger WHERE request_id=?').bind(accepted.requestId).first()).n,1)
})

test('only Owner issues scoped device grants; views contain Final Price and no purchase/profit; issue retries are idempotent',async t=>{
  const f=await fixture(t),{input,authorization}=await f.issue()
  assert.equal((await f.api('grants/issue',{...input,grantId:crypto.randomUUID()},'super')).status,403)
  assert.equal((await f.api('grants/issue',{...input,grantId:crypto.randomUUID()},'admin')).status,403)
  assert.equal((await f.api('grants/issue',input,'owner')).idempotentReplay,true)
  assert.equal((await f.api('grants/issue',{...input,hours:4},'owner')).status,409)
  assert.equal(authorization.finalPrices[0].finalPricePaise,8000)
  assert.equal(/purchase|profit|margin/.test(JSON.stringify(authorization)),false)
  await verifyOfflineGrant(authorization,f.scope,{finalize:true})
  const tampered=structuredClone(authorization);tampered.finalPrices[0].finalPricePaise=1
  await assert.rejects(verifyOfflineGrant(tampered,f.scope),/snapshot/)
  await assert.rejects(verifyOfflineGrant(authorization,{...f.scope,deviceId:'another-device'}),/another user, device or stall/)
  assert.equal((await f.api('grants','', 'owner')).devices.length,1)
})

test('Admin agreement and closure use signed device proofs; keep Admin actor and audit Owner grant; no payment privilege',async t=>{
  const f=await fixture(t),{authorization}=await f.issue(),created=await f.create()
  // Deliberately below Final Price: owner-approved policy permits any positive agreement.
  const agreement=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  const agreed=await f.api('sync',agreement)
  assert.equal(agreed.status,200,JSON.stringify(agreed))
  const close=await f.operation(authorization,'CLOSE',{}, {parentOperationId:agreement.operationId})
  const closed=await f.api('sync',close)
  assert.equal(closed.status,200,JSON.stringify(closed))
  assert.equal(closed.delegation.ownerUserId,'owner');assert.equal(closed.delegation.actorRole,'admin')
  assert.equal((await f.api('sync',close)).idempotentReplay,true)
  const request=await f.db.prepare('SELECT status,closed_by_email FROM customer_requests WHERE id=?').bind(created.requestId).first()
  assert.equal(request.status,'closed');assert.equal(request.closed_by_email,'admin@test.com')
  const receipts=(await f.db.prepare('SELECT actor_role FROM offline_sync_receipts').bind().all()).results
  assert.ok(receipts.every(row=>row.actor_role==='admin'))
  const uses=(await f.db.prepare('SELECT * FROM offline_final_price_uses').bind().all()).results
  assert.equal(uses.length,2);assert.ok(uses.every(row=>row.grant_id===authorization.grant.claims.grantId))
  const snapshot=await f.api('requests/'+created.requestId)
  assert.equal(snapshot.acceptedAmountPaise,100)
  assert.equal(/purchase|profit|margin/.test(JSON.stringify(snapshot)),false)
  const payment={...close,operationId:crypto.randomUUID(),kind:'PAYMENT',body:{entryType:'PAYMENT',amountPaise:100,paymentMethod:'CASH',recordingMode:'OFFLINE'}}
  assert.equal((await f.api('sync',payment)).status,403)
  await assert.rejects(f.db.prepare('DELETE FROM offline_final_price_uses WHERE operation_id=?').bind(close.operationId).run(),/append_only/)
})

test('missing/view-only/revoked/expired/tampered/transplanted grants cannot authorize new agreement or closure',async t=>{
  const f=await fixture(t),created=await f.create()
  const {authorization:view}=await f.issue(false)
  let op=await f.operation(view,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  assert.equal((await f.api('sync',op)).status,403)
  const {authorization}=await f.issue()
  op=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  assert.equal((await f.api('sync',{...op,authorization:undefined})).status,403)
  assert.ok([400,403].includes((await f.api('sync',{...op,body:{acceptedAmountPaise:200}})).status))
  assert.ok([400,403].includes((await f.api('sync',{...op,scope:{...op.scope,deviceId:'another-device'}})).status))
  const forged=structuredClone(op);forged.authorization.grant.claims.expiresAt=new Date(Date.now()+9999999).toISOString()
  assert.ok([400,403].includes((await f.api('sync',forged)).status))
  assert.equal((await f.api('grants/revoke',{grantId:authorization.grant.claims.grantId},'owner')).status,200)
  assert.equal((await f.api('sync',op)).status,403)
  const refreshed=await f.api('grants/prepare',{deviceId:f.scope.deviceId,deviceToken:f.deviceToken,publicKey:f.publicKey})
  assert.equal(refreshed.authorization,null)
  await assert.rejects(verifyOfflineGrant(authorization,f.scope,{now:Date.parse(authorization.grant.claims.expiresAt)}),/expired/)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM offline_final_price_uses').bind().first()).n,0)
})

test('revocation between signature validation and commit rolls back agreement and its receipt/use atomically',async t=>{
  const f=await fixture(t),{authorization}=await f.issue(),created=await f.create()
  const op=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  const batch=f.db.batch.bind(f.db);let changed=false
  f.db.batch=async statements=>{
    if(!changed){changed=true;await f.api('grants/revoke',{grantId:authorization.grant.claims.grantId},'owner')}
    return batch(statements)
  }
  const result=await f.api('sync',op)
  assert.equal(result.status,403,JSON.stringify(result))
  assert.equal((await f.db.prepare('SELECT count(*) n FROM offline_final_price_uses').bind().first()).n,0)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM offline_sync_receipts').bind().first()).n,1)
  assert.equal((await f.db.prepare('SELECT accepted_amount_paise FROM quotations').bind().first()).accepted_amount_paise,null)
})

test('acknowledged delegated replay survives later grant revocation without another mutation',async t=>{
  const f=await fixture(t),{authorization}=await f.issue(),created=await f.create()
  const op=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  assert.equal((await f.api('sync',op)).status,200)
  await f.api('grants/revoke',{grantId:authorization.grant.claims.grantId},'owner')
  assert.equal((await f.api('sync',op)).idempotentReplay,true)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM offline_final_price_uses').bind().first()).n,1)
})

test('current issuer membership and target device/membership are required even for signed grants',async t=>{
  for(const change of ['owner','target','device']) {
    const f=await fixture(t),{authorization}=await f.issue(),created=await f.create()
    const op=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
    if(change==='owner')await f.db.prepare("UPDATE location_members SET role='super_admin' WHERE admin_user_id='owner'").bind().run()
    if(change==='target')await f.db.prepare("UPDATE location_members SET disabled_at='disabled' WHERE admin_user_id='admin'").bind().run()
    if(change==='device')await f.db.prepare("UPDATE offline_sync_devices SET disabled_at='disabled' WHERE user_id='admin'").bind().run()
    assert.equal((await f.api('sync',op)).status,403,change)
  }
})

test('native in-memory Local D1: delegated concurrent replay, positive agreement, closure and atomic receipt stay unique',async t=>{
  const f=await fixture(t,true),{authorization}=await f.issue(),created=await f.create()
  const agreement=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  const attempts=await Promise.all([f.api('sync',agreement),f.api('sync',agreement)])
  assert.ok(attempts.some(result=>result.status===200),JSON.stringify(attempts))
  assert.equal((await f.api('sync',agreement)).idempotentReplay,true)
  const close=await f.operation(authorization,'CLOSE',{}, {parentOperationId:agreement.operationId})
  assert.equal((await f.api('sync',close)).status,200)
  assert.equal((await f.api('sync',close)).idempotentReplay,true)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n,1)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM offline_final_price_uses').bind().first()).n,2)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM offline_sync_receipts').bind().first()).n,3)
  assert.equal((await f.db.prepare('SELECT status FROM customer_requests').bind().first()).status,'closed')
})

test('finalized QR Owner-first reconciliation preserves original Admin closure and allows one dependent Owner payment',async t=>{
  const f=await fixture(t),{handoff,chain,ownerScope}=await f.finalizedEnvelope()
  const accepted=await f.api('sync',handoff,'owner')
  assert.equal(accepted.status,200,JSON.stringify(accepted))
  const pay={operationId:crypto.randomUUID(),kind:'PAYMENT',scope:ownerScope,deviceToken:f.deviceToken,capturedRole:'owner',occurredAt:new Date().toISOString(),parentOperationId:handoff.operationId,body:{entryType:'PAYMENT',amountPaise:100,paymentMethod:'CASH',recordingMode:'OFFLINE'}}
  assert.equal((await f.api('sync',pay,'owner')).status,200)
  assert.equal((await f.api('sync',pay,'owner')).idempotentReplay,true)
  assert.equal((await f.api('sync',handoff,'owner')).idempotentReplay,true)
  for(const source of chain)assert.equal((await f.api('sync',{...source,deviceToken:f.deviceToken})).idempotentReplay,true)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n,1)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM request_payment_ledger').bind().first()).n,1)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,1)
  assert.equal((await f.db.prepare('SELECT closed_by_email FROM customer_requests').bind().first()).closed_by_email,'admin@test.com')
  assert.equal((await f.db.prepare('SELECT actor_user_id FROM request_payment_ledger').bind().first()).actor_user_id,'owner')
})

test('finalized QR Admin-first reconciliation reuses all source receipts and does not re-finalize or duplicate',async t=>{
  const f=await fixture(t),{handoff,chain}=await f.finalizedEnvelope()
  for(const source of chain)assert.equal((await f.api('sync',{...source,deviceToken:f.deviceToken})).status,200)
  const result=await f.api('sync',handoff,'owner')
  assert.equal(result.status,200,JSON.stringify(result))
  assert.equal((await f.db.prepare('SELECT count(*) n FROM offline_final_price_uses').bind().first()).n,2)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM offline_sync_receipts').bind().first()).n,4)
})

test('revoked source grant blocks finalized handoff before recipient acceptance and preserves partial source recovery',async t=>{
  const f=await fixture(t),{handoff,chain,authorization}=await f.finalizedEnvelope()
  await f.api('grants/revoke',{grantId:authorization.grant.claims.grantId},'owner')
  const result=await f.api('sync',handoff,'owner')
  assert.equal(result.status,403,JSON.stringify(result))
  assert.equal((await f.db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,0)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM request_payment_ledger').bind().first()).n,0)
  assert.equal((await f.api('sync',{...chain[0],deviceToken:f.deviceToken})).idempotentReplay,true)
  const created=await f.api('sync',{...chain[0],deviceToken:f.deviceToken})
  const fresh=await f.issue()
  const agreement=await f.operation(fresh.authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision,resolutionOf:chain[1].operationId})
  const close=await f.operation(fresh.authorization,'CLOSE',{}, {parentOperationId:agreement.operationId})
  const operations=[chain[0],agreement,close].map(op=>{const {deviceToken,...saved}=op;void deviceToken;return saved})
  const payload={...handoff.body.transfer.payload,transferId:crypto.randomUUID(),occurredAt:new Date().toISOString(),bill:{agreedAmountPaise:100,operations}}
  const reviewed={...handoff,operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),body:{transfer:{payload,certificate:handoff.body.transfer.certificate,signature:await sign(payload,f.pair.privateKey)}}}
  const recovered=await f.api('sync',reviewed,'owner')
  assert.equal(recovered.status,200,JSON.stringify(recovered))
})

test('native Local D1 finalized handoff and payment chain have unique source, claim and payment receipts',async t=>{
  const f=await fixture(t,true),{handoff,ownerScope}=await f.finalizedEnvelope()
  const result=await f.api('sync',handoff,'owner')
  assert.equal(result.status,200,JSON.stringify(result))
  const pay={operationId:crypto.randomUUID(),kind:'PAYMENT',scope:ownerScope,deviceToken:f.deviceToken,occurredAt:new Date().toISOString(),parentOperationId:handoff.operationId,body:{entryType:'PAYMENT',amountPaise:50,paymentMethod:'CASH',recordingMode:'OFFLINE'}}
  assert.equal((await f.api('sync',pay,'owner')).status,200)
  assert.equal((await f.api('sync',handoff,'owner')).idempotentReplay,true)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n,1)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM offline_sync_receipts').bind().first()).n,5)
})

test('already acknowledged Admin closure can be handed off after grant revocation; lost handoff reply replays its claim',async t=>{
  const f=await fixture(t),{handoff,chain,authorization}=await f.finalizedEnvelope()
  for(const source of chain)assert.equal((await f.api('sync',{...source,deviceToken:f.deviceToken})).status,200)
  await f.api('grants/revoke',{grantId:authorization.grant.claims.grantId},'owner')
  const batch=f.db.batch.bind(f.db);let lost=false
  f.db.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>statement.sql?.includes('INSERT INTO request_handover_claims'))){lost=true;throw Error('lost reply after commit')}return result}
  const first=await f.api('sync',handoff,'owner')
  assert.equal(first.status,200,JSON.stringify(first))
  assert.equal((await f.api('sync',handoff,'owner')).idempotentReplay,true)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM request_handover_claims').bind().first()).n,1)
})

test('two receiver devices cannot both claim finalized QR or send a payment behind the losing acceptance',async t=>{
  const f=await fixture(t),{handoff,ownerScope}=await f.finalizedEnvelope()
  const otherScope={...ownerScope,deviceId:'second-owner-receiver'}
  await f.api('devices',{deviceId:otherScope.deviceId,deviceToken:f.deviceToken},'owner')
  const other={...handoff,operationId:crypto.randomUUID(),scope:otherScope}
  const attempts=await Promise.all([f.api('sync',handoff,'owner'),f.api('sync',other,'owner')])
  assert.equal(attempts.filter(result=>result.status===200).length,1,JSON.stringify(attempts))
  assert.equal(attempts.filter(result=>result.status===409).length,1,JSON.stringify(attempts))
  const loser=attempts[0].status===200?other:handoff
  const payment={operationId:crypto.randomUUID(),scope:loser.scope,deviceToken:f.deviceToken,occurredAt:new Date().toISOString(),kind:'PAYMENT',parentOperationId:loser.operationId,body:{entryType:'PAYMENT',amountPaise:100,paymentMethod:'CASH',recordingMode:'OFFLINE'}}
  assert.equal((await f.api('sync',payment,'owner')).status,409)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM request_payment_ledger').bind().first()).n,0)
})

test('resigning an altered finalized QR cannot substitute the original Admin agreed amount or source proof',async t=>{
  const f=await fixture(t),{handoff}=await f.finalizedEnvelope()
  const forged=structuredClone(handoff)
  forged.body.transfer.payload.bill.operations[1].body.acceptedAmountPaise=200
  forged.body.transfer.payload.bill.agreedAmountPaise=200
  forged.body.transfer.signature=await sign(forged.body.transfer.payload,f.pair.privateKey)
  assert.ok([400,403].includes((await f.api('sync',forged,'owner')).status))
  assert.equal((await f.db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n,0)
})

test('membership removal/re-enabling cannot silently resurrect an old signed grant',async t=>{
  const f=await fixture(t),{authorization}=await f.issue(),created=await f.create()
  const op=await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision})
  await f.db.prepare("UPDATE location_members SET disabled_at='disabled' WHERE admin_user_id='admin'").bind().run()
  await f.db.prepare("UPDATE location_members SET disabled_at=NULL WHERE admin_user_id='admin'").bind().run()
  assert.equal((await f.api('sync',op)).status,403)
  const refreshed=await f.api('grants/prepare',{deviceId:f.scope.deviceId,deviceToken:f.deviceToken,publicKey:f.publicKey})
  assert.equal(refreshed.authorization,null)
  assert.equal((await f.api('grants','', 'owner')).grants[0].invalidatedAt!==null,true)
  const fresh=await f.issue()
  assert.notEqual(fresh.authorization.grant.claims.grantId,authorization.grant.claims.grantId)
})

test('native Local D1 retains one recovered payment and rejects a second replacement or a late original capture',async t=>{
  const f=await fixture(t,true),{authorization}=await f.issue(),created=await f.create()
  const agreed=await f.api('sync',await f.operation(authorization,'AGREEMENT',{acceptedAmountPaise:100},{requestId:created.requestId,expectedRevision:created.revision}))
  const closed=await f.api('sync',await f.operation(authorization,'CLOSE',{}, {parentOperationId:agreed.operationId}))
  const scope={...f.scope,userId:'owner',deviceId:'owner-recovery-device'}
  await f.api('devices',{deviceId:scope.deviceId,deviceToken:f.deviceToken},'owner')
  const originalId=crypto.randomUUID(),occurredAt=new Date().toISOString()
  const recovery={operationId:crypto.randomUUID(),scope,deviceToken:f.deviceToken,capturedRole:'owner',kind:'PAYMENT',requestId:created.requestId,expectedRevision:closed.revision,occurredAt,resolutionOf:originalId,body:{entryType:'PAYMENT',amountPaise:50,paymentMethod:'CASH',recordingMode:'OFFLINE',occurredAt}}
  const first=await f.api('sync',recovery,'owner')
  assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.resolutionOf,originalId)
  assert.equal((await f.api('sync',recovery,'owner')).idempotentReplay,true)
  const second=await f.api('sync',{...recovery,operationId:crypto.randomUUID(),expectedRevision:first.revision},'owner')
  assert.equal(second.status,409)
  const original={...recovery,operationId:originalId,expectedRevision:first.revision};delete original.resolutionOf
  assert.equal((await f.api('sync',original,'owner')).status,409)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM request_payment_ledger').bind().first()).n,1)
})
