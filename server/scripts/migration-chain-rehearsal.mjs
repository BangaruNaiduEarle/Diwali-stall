import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { hashPassword } from '../src/lib/passwordHash.js'
import { siteConfig } from '../../src/data/siteConfig.js'
import { publicJwk, sign, offlineRequestId, transferScope } from '../../src/shared/handoverProtocol.js'

const root = 'C:/Users/naidu/AppData/Local/Temp/diwali-release-b38657123a324f3a9e7c02c159b82c79'
const mode = process.argv[2], run = promisify(execFile)
const directory = mode === 'prepare' ? path.join(root,'chain-'+crypto.randomUUID().slice(0,8)) : path.resolve(process.argv[3])
assert.ok(directory.startsWith(path.resolve(root)+path.sep) && path.basename(directory).startsWith('chain-'))
const file = name => path.join(directory,name)
const save = (name,data) => writeFile(file(name),JSON.stringify(data,null,2))
const python = 'C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe'
const inspect = async name => {
  const result=await run(python,['server/scripts/migration-chain-rehearsal-db.py',root,directory,name],{windowsHide:true,maxBuffer:3e6})
  await writeFile(file('inspection-'+name+'.log'),result.stdout);console.log(result.stdout.trim())
}
let state
if(mode === 'prepare'){
  await mkdir(directory);await mkdir(file('migrations'))
  const rootKey=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  state={directory,databaseName:'diwali-chain-rehearsal',databaseId:crypto.randomUUID(),actors:{},requests:{},
    season:'chain-2026',otherSeason:'chain-2027',a:'chain-a',b:'chain-b',business:'chain-business',
    password:'Chain-'+crypto.randomUUID(),rootJwk:await crypto.subtle.exportKey('jwk',rootKey.privateKey)}
  await save('state.json',state)
  await writeFile(file('wrangler.toml'),`name = "diwali-chain-rehearsal"\nmain = "${path.resolve('server/src/index.js').replaceAll('\\','/')}"\ncompatibility_date = "2026-05-01"\n[vars]\nADMIN_LOCATION_MODE = true\nADMIN_LOCAL_DEV_AUTH = false\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${state.databaseName}"\ndatabase_id = "${state.databaseId}"\nmigrations_dir = "migrations"\n`)
  const runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture");}}',compatibilityDate:'2026-05-01',host:'127.0.0.1',port:0,
    d1Databases:{DB:state.databaseId},d1Persist:file('persist/v3/d1'),cachePersist:false,kvPersist:false,r2Persist:false,durableObjectsPersist:false})
  try {const db=await runtime.getD1Database('DB');await db.prepare('SELECT 1').first()}finally{await runtime.dispose()}
  const dir=file('persist/v3/d1/miniflare-D1DatabaseObject'),names=(await readdir(dir)).filter(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite')
  assert.equal(names.length,1);state.databaseFile=path.join(dir,names[0]);await save('state.json',state)
  await inspect('clone');console.log(JSON.stringify({directory,freshD1:true}));process.exit(0)
} else state=JSON.parse(await readFile(file('state.json'),'utf8'))

const migrations=(await readdir('server/database/migrations')).filter(n=>/^002[1-6]_.*\.sql$/.test(n)).sort()
assert.equal(migrations.length,6)
if(mode === 'migrate'){
  const results=[]
  for(const name of migrations){
    const number=name.slice(0,4),contents=await readFile('server/database/migrations/'+name)
    await writeFile(file('migrations/'+name),contents,{flag:'wx'})
    const args=[path.resolve('server/node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply',state.databaseName,'--local','--config',file('wrangler.toml'),'--persist-to',file('persist')]
    let r
    try{r=await run(process.execPath,args,{windowsHide:true,maxBuffer:4e6,env:{...process.env,WRANGLER_SEND_METRICS:'false'}})}
    catch(error){await writeFile(file(number+'.stdout.log'),error.stdout??'');await writeFile(file(number+'.stderr.log'),error.stderr??error.message);throw error}
    await writeFile(file(number+'.stdout.log'),r.stdout);await writeFile(file(number+'.stderr.log'),r.stderr)
    await inspect(number)
    const verification=JSON.parse(await readFile(file('verification-'+number+'.json'),'utf8'))
    assert.equal(verification.migrationNames.length,21+results.length+1)
    assert.equal(verification.migrationNames.at(-1),name)
    results.push({name,status:'PASS',sha256:createHash('sha256').update(contents).digest('hex'),schemaObjects:verification.schemaObjects,newTableRows:verification.newTableRows})
    await save('migration-results.json',results);console.log('PASS '+number)
  }
  const args=[path.resolve('server/node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply',state.databaseName,'--local','--config',file('wrangler.toml'),'--persist-to',file('persist')]
  const r=await run(process.execPath,args,{windowsHide:true,maxBuffer:3e6,env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
  await writeFile(file('no-pending-migrations.stdout.log'),r.stdout);await writeFile(file('no-pending-migrations.stderr.log'),r.stderr)
  await inspect('chain-complete');process.exit(0)
}
if(mode === 'regressions'){
  const groups=[
    ['billing-cost-offline',['server/tests/billPurchaseCostSnapshots.test.js','server/tests/requestPayments.test.js','server/tests/billAdjustmentsHandover.test.js','server/tests/offlineSync.test.js']],
    ['settings',['server/tests/adminStallSettings.test.js','server/tests/adminStallSettingsRuntime.test.js']],
    ['public-compatibility',['server/tests/adminPlatformPublicCatalogue.test.js','server/tests/publicCatalogueLocation.test.js']],
    ['finalization-isolation',['server/tests/adminCustomerRequestFinalizeAgreed.test.js','server/tests/adminBillingLocationApi.test.js']],
    ['legacy',['--test-name-pattern=gate OFF|legacy retries','server/tests/adminQuickBillAtomic.test.js']],
    ['qr-history',['--test-name-pattern=offline handover atomically|Owner-first mixed Family Pack|assignment captures','server/tests/handoverSync.test.js','server/tests/requestWorkflowHistory.test.js']],
  ],results=[]
  for(const [name,selection] of groups){
    const args=['--test','--test-concurrency=1',...selection]
    const r=await run(process.execPath,args,{windowsHide:true,maxBuffer:5e6})
    await writeFile(file(name+'.stdout.log'),r.stdout);await writeFile(file(name+'.stderr.log'),r.stderr)
    const result={name,args,status:'PASS'}
    for(const key of ['pass','fail','skipped','cancelled'])result[key]=Number(r.stdout.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1])
    assert.equal(result.fail,0);results.push(result);await save('regression-results.json',results);console.log(JSON.stringify(result))
  }
  assert.equal(results.reduce((sum,r)=>sum+r.pass,0),117);process.exit(0)
}
if(mode === 'verify'){await inspect('final');process.exit(0)}
if(!['runtime','runtime-resume'].includes(mode))throw Error('Unknown mode')
let results=[],trace=[]
if(mode==='runtime-resume'){
  const prior=JSON.parse(await readFile(file('runtime-results.json'),'utf8'));await save('runtime-attempt-'+Date.now()+'.json',prior)
  results=prior.filter(r=>r.status==='PASS');trace=JSON.parse(await readFile(file('http-trace.json'),'utf8'))
}
const bundle=await build({entryPoints:[path.resolve('server/src/index.js')],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,logLevel:'silent'})
await writeFile(file('worker-bundle.mjs'),bundle.outputFiles[0].text)
const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-01',host:'127.0.0.1',port:0,
  d1Databases:{DB:state.databaseId},d1Persist:file('persist/v3/d1'),cachePersist:false,kvPersist:false,r2Persist:false,durableObjectsPersist:false,
  bindings:{ADMIN_LOCATION_MODE:true,ADMIN_LOCAL_DEV_AUTH:false,HANDOVER_SIGNING_JWK:JSON.stringify(state.rootJwk)}})
let db,base
const sql=async(text,...values)=>db.prepare(text).bind(...values).all()
const first=async(text,...values)=>(await sql(text,...values)).results[0]
const check=async(id,name,callback)=>{
  if(results.some(r=>r.id===id&&r.status==='PASS')){console.log('RETAIN '+id);return}
  try{results.push({id,name,status:'PASS',evidence:await callback()});console.log('PASS '+id)}
  catch(error){results.push({id,name,status:'FAIL',error:error.stack});throw error}
  finally{await save('runtime-results.json',results);await save('http-trace.json',trace);await save('state.json',state)}
}
const api=async(actor,route,{method='GET',body,location=state.actors[actor]?.location??state.a,season=state.season,rev,key}={})=>{
  const r=await fetch(new URL('/api/admin/'+route,base),{method,headers:{Origin:base.origin,'Content-Type':'application/json',Cookie:state.actors[actor]?.cookie??'',
    'X-Admin-Location-Id':location,'X-Admin-Season-Id':season,...(rev==null?{}:{'If-Match':String(rev)}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={error:'non_json_response',message:text.slice(0,250)}}
  trace.push({actor,route,method,location,season,status:r.status,error:data.error})
  return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]}
}
const okay=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r.data));return r.data}
const settings=async(actor='owner',extra={})=>okay(await api(actor,'settings',extra))
const detail=async(id,extra={})=>okay(await api('owner','customer-requests/'+id,extra)).request
const quote=async(id,extra={})=>okay(await api('owner',`customer-requests/${id}/quotation`,extra)).quotation
const close=async(id,extra={})=>api('owner',`customer-requests/${id}/finalize`,{method:'PATCH',rev:(await detail(id,extra)).revision,...extra})
const checkout=async(name,extra={})=>{
  const result=okay(await api('owner','quick-bill/checkout',{method:'POST',key:'chain-'+name,
    body:{customer:{name:'Chain '+name,mobile:'9876543210'},items:[{productId:'P926101',quantity:2}],pricingMode:'bargain',acceptedAmountPaise:17000},...extra}))
  state.requests[name]=result.request.id;return result
}
try{
  base=await runtime.ready;db=await runtime.getD1Database('DB')
  if(!state.seeded){
    const statements=[],add=(text,...values)=>statements.push(db.prepare(text).bind(...values)),hash=await hashPassword(state.password)
    add("INSERT INTO businesses(id,slug,name,business_type) VALUES(?,?,?,'permanent')",state.business,state.business,'Chain business')
    for(const season of [state.season,state.otherSeason])add("INSERT INTO business_seasons(id,code,label,status) VALUES(?,?,?,'active')",season,season,season)
    for(const loc of [state.a,state.b]){
      add('INSERT INTO business_locations(id,business_id,slug,name) VALUES(?,?,?,?)',loc,state.business,loc,loc)
      for(const season of [state.season,state.otherSeason])add('INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(?,?,2026)',loc,season)
      add('INSERT INTO categories(slug,label,season_id,location_id) VALUES(?,?,?,?)',loc+'-cat',loc,state.season,loc)
    }
    for(const [actor,role,loc] of [['owner','owner',state.a],['super','super_admin',state.a],['admin','admin',state.a],['ownerB','owner',state.b]]){
      const id='chain-'+actor.toLowerCase();state.actors[actor]={id,email:id+'@rehearsal.invalid',location:loc}
      add('INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(?,?,?,?,?)',id,state.actors[actor].email,actor,role,hash)
      for(const season of [state.season,state.otherSeason]){
        add('INSERT INTO season_members(season_id,admin_user_id,role) VALUES(?,?,?)',season,id,role)
        add('INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(?,?,?,?)',loc,season,id,role)
        if(actor==='owner')add("INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(?,?,?,'admin')",state.b,season,id)
      }
    }
    add("INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2026',?,'owner')",state.actors.owner.id)
    add("INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES('location-diwali-2026','season-2026',?,'owner')",state.actors.owner.id)
    for(const [id,loc,price,cost] of [['P926101',state.a,10000,5000],['P926102',state.b,22000,7000]]){
      add('INSERT INTO products(id,category_slug,name,pack,company,selling_price_paise,final_price_paise,pieces_per_pack,allow_loose_sale,season_id,location_id) VALUES(?,?,?,?,?,?,8000,10,1,?,?)',id,loc+'-cat',id,'10 pieces','Maker',price,state.season,loc)
      add("INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES(?,?,'2026-01-01',?,?)",id,cost,state.season,loc)
    }
    add("INSERT INTO family_packs(id,slug,name,selling_price_paise,pack_label,active,season_id,location_id) VALUES('FP926101','chain-classic','Chain Classic',25000,'Classic',1,?,?)",state.season,state.a)
    add("INSERT INTO family_pack_items(family_pack_id,product_id,quantity,unit_label) VALUES('FP926101','P926101',2,'box')")
    await db.batch(statements);state.seeded=true;await save('state.json',state)
  }
  for(const actor of Object.keys(state.actors)){
    const r=await api(actor,'auth/login',{method:'POST',body:{email:state.actors[actor].email,password:state.password}});okay(r);state.actors[actor].cookie=r.cookie
  }
  await check('CHAIN-01','Full migrated schema, indexes and historical backfill identities',async()=>{
    const migrationNames=(await sql('SELECT name FROM d1_migrations ORDER BY id')).results.map(r=>r.name)
    assert.deepEqual(migrationNames.slice(-6),migrations)
    for(const table of ['bill_item_purchase_costs','location_settings','location_season_settings','location_settings_events','request_handover_claims','offline_sync_receipts'])assert.ok(await first("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",table))
    for(const index of ['idx_request_item_stable_line','idx_payment_ledger_scope','idx_offline_receipt_scope','idx_bill_purchase_cost_scope','idx_location_settings_events_scope'])assert.ok(await first("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",index))
    const old=await first("SELECT count(*) n FROM customer_request_items WHERE line_id = 'historical-line-' || id")
    return {migrationNames:migrationNames.slice(-6),historicalStableLineIds:old.n}
  })
  await check('CHAIN-02','Historical bills retain amounts and return unavailable cost/profit without invented snapshots',async()=>{
    const row=await first(`SELECT a.* FROM request_payment_accounts a WHERE a.location_id = 'location-diwali-2026'
      AND NOT EXISTS(SELECT 1 FROM customer_request_items i WHERE i.request_id = a.request_id AND i.family_pack_id IS NOT NULL) LIMIT 1`)
    assert.ok(row)
    const historical=await quote(row.request_id,{location:'location-diwali-2026',season:'season-2026'})
    assert.equal(historical.internalFinancialSummary.profitPaise,null);assert.equal(historical.internalFinancialSummary.available,false)
    assert.equal((await first('SELECT count(*) n FROM bill_item_purchase_costs WHERE request_id = ?',row.request_id)).n,0)
    return {requestId:row.request_id,amountDuePaise:row.amount_due_paise,summary:historical.internalFinancialSummary}
  })
  await check('CHAIN-03','Original single-stall defaults and global settings remain compatible',async()=>{
    const result=await settings('owner',{location:'location-diwali-2026',season:'season-2026'})
    for(const key of ['phone','whatsappNumber','locationName','locationDetailLines','locationMapUrl'])assert.deepEqual(result.profile[key],siteConfig[key])
    assert.deepEqual(result.season,{stallDates:siteConfig.stallDates,stallTimings:siteConfig.stallTimings})
    assert.deepEqual(result.revisions,{profile:0,season:0})
    state.platformBefore=await first('SELECT * FROM platform_settings')
    return {sources:result.sources,revisions:result.revisions,originalContactPreserved:true}
  })
  await check('CHAIN-04','Owner/Super Admin save independent settings; Admin read-only and foreign stall roles enforced',async()=>{
    const beforeB=await settings('ownerB'),beforeA=await settings()
    assert.equal(beforeA.profile.phone,'');assert.deepEqual(beforeA.season.stallDates,[])
    const a=okay(await api('owner','settings',{method:'PATCH',body:{profile:{phone:'9876543210',stallName:'Chain A Updated'},expectedProfileRevision:0,season:{stallDates:['2026-11-06'],stallTimings:'9 AM to 10 PM'},expectedSeasonRevision:0}}))
    assert.deepEqual(a.revisions,{profile:1,season:1})
    const superUpdate=okay(await api('super','settings',{method:'PATCH',body:{profile:{whatsappNumber:'9876543211'},expectedProfileRevision:1}}))
    assert.equal(superUpdate.revisions.profile,2);assert.deepEqual(await settings('ownerB'),beforeB)
    const admin=await settings('admin');assert.equal(admin.permissions.canUpdate,false);assert.equal(admin.updated,undefined)
    const body={profile:{phone:'9876543212'},expectedProfileRevision:2}
    assert.equal((await api('admin','settings',{method:'PATCH',body})).status,403)
    assert.equal((await api('owner','settings',{method:'PATCH',location:state.b,body:{...body,expectedProfileRevision:0}})).status,403)
    const b=okay(await api('ownerB','settings',{method:'PATCH',body:{profile:{phone:'9876543213'},expectedProfileRevision:0}}))
    assert.equal(b.revisions.profile,1);assert.equal((await settings()).profile.phone,'9876543210')
    return {aRevisions:superUpdate.revisions,bRevisions:b.revisions,adminWrite:403,lesserStallRoleWrite:403}
  })
  await check('CHAIN-05','Stale/concurrent revisions and season schedules remain isolated',async()=>{
    const revision=(await settings()).revisions.profile
    const replies=await Promise.all(['9876543214','9876543215'].map(phone=>api('owner','settings',{method:'PATCH',body:{profile:{phone},expectedProfileRevision:revision}})))
    assert.deepEqual(replies.map(r=>r.status).sort(),[200,409])
    const next=await settings('owner',{season:state.otherSeason});assert.deepEqual(next.season.stallDates,[])
    okay(await api('owner','settings',{method:'PATCH',season:state.otherSeason,body:{season:{stallDates:['2027-10-29']},expectedSeasonRevision:0}}))
    assert.deepEqual((await settings()).season.stallDates,['2026-11-06'])
    const current=await settings(),events=(await first('SELECT count(*) n FROM location_settings_events')).n
    const noOp=okay(await api('owner','settings',{method:'PATCH',body:{profile:{phone:current.profile.phone},expectedProfileRevision:current.revisions.profile}}))
    assert.equal(noOp.changed,false);assert.equal((await first('SELECT count(*) n FROM location_settings_events')).n,events)
    return {concurrentStatuses:replies.map(r=>r.status),differentSeasonSchedule:true,noOpAddsNoEvent:true}
  })
  await check('CHAIN-06','Atomic settings audit rollback and immutable history on real D1',async()=>{
    const before=await settings(),events=(await first('SELECT count(*) n FROM location_settings_events')).n
    await sql("CREATE TRIGGER chain_fail_settings BEFORE INSERT ON location_settings_events BEGIN SELECT RAISE(ABORT,'chain_audit_failure'); END")
    try{
      const response=await api('owner','settings',{method:'PATCH',body:{profile:{stallName:'Must Roll Back',phone:'9999999999'},expectedProfileRevision:before.revisions.profile,season:{stallTimings:'No'},expectedSeasonRevision:before.revisions.season}})
      assert.equal(response.status,503);assert.deepEqual(await settings(),before)
      assert.equal((await first('SELECT count(*) n FROM location_settings_events')).n,events)
    }finally{await sql('DROP TRIGGER chain_fail_settings')}
    await assert.rejects(sql("UPDATE location_settings_events SET changes_json = '{}'"),/immutable/)
    await assert.rejects(sql('DELETE FROM location_settings_events'),/immutable/)
    return {noPartialUpdate:true,events,immutable:true}
  })
  await check('CHAIN-07','New finalization freezes per-item cost and retains bill/payment arithmetic',async()=>{
    const created=await checkout('financial'),id=created.request.id
    okay(await close(id))
    const row=await first('SELECT * FROM bill_item_purchase_costs WHERE request_id = ?',id)
    assert.equal(row.purchase_line_paise,10000);assert.equal(row.location_id,state.a);assert.equal(row.season_id,state.season)
    const before=(await quote(id)).internalFinancialSummary;assert.equal(before.profitPaise,7000)
    await sql("UPDATE product_purchase_rates SET unit_rate_paise = 6001 WHERE product_id = 'P926101'")
    assert.deepEqual((await quote(id)).internalFinancialSummary,before)
    const pay={operationId:'chain-payment-1',entryType:'PAYMENT',amountPaise:3000,recordingMode:'ONLINE',paymentMethod:'CASH'}
    const paid=okay(await api('owner',`customer-requests/${id}/payments`,{method:'POST',rev:(await detail(id)).revision,body:pay}))
    assert.equal(paid.summary.amountDuePaise,17000);assert.equal(paid.summary.receivedPaise,3000);assert.equal(paid.summary.outstandingPaise,14000)
    okay(await api('owner',`customer-requests/${id}/payments`,{method:'POST',rev:(await detail(id)).revision,body:pay}))
    const retry=await Promise.all([close(id),close(id),close(id)]);retry.forEach(okay)
    assert.equal((await first('SELECT count(*) n FROM bill_item_purchase_costs WHERE request_id = ?',id)).n,1)
    await assert.rejects(sql('UPDATE bill_item_purchase_costs SET purchase_unit_paise = 1 WHERE request_id = ?',id),/immutable/)
    await assert.rejects(sql('DELETE FROM bill_item_purchase_costs WHERE request_id = ?',id),/immutable/)
    assert.equal((await api('owner',`customer-requests/${id}/payments`,{location:state.b})).status,404)
    assert.equal((await api('owner',`customer-requests/${id}/payments`,{season:state.otherSeason})).status,404)
    return {requestId:id,costPaise:10000,profitPaise:7000,paymentSummary:paid.summary,duplicateSnapshots:0}
  })
  await check('CHAIN-08','Signed mixed Family Pack QR handover, offline closure/payment and retries remain atomic',async()=>{
    const device=async actor=>{
      const deviceId='chain-device-'+actor,deviceToken=crypto.randomUUID().replaceAll('-','').repeat(2)
      const scope={businessId:state.business,locationId:state.a,seasonId:state.season,userId:state.actors[actor].id,deviceId}
      okay(await api(actor,'offline/devices',{method:'POST',body:{deviceId,deviceToken}}))
      const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
      const preparation=okay(await api(actor,'offline/handover/prepare',{method:'POST',body:{deviceId,deviceToken,publicKey:publicJwk(await crypto.subtle.exportKey('jwk',pair.publicKey))}}))
      const catalogue=okay(await api(actor,'offline/catalogue'))
      return {actor,scope,deviceToken,pair,preparation,catalogue}
    }
    const admin=await device('admin'),owner=await device('owner'),pack=admin.catalogue.familyPacks[0],sourceOperationId=crypto.randomUUID()
    assert.ok(pack);assert.deepEqual(admin.preparation.privateCatalogue,[])
    const payload={v:2,transferId:crypto.randomUUID(),scope:transferScope(admin.scope),requestId:await offlineRequestId(admin.scope,sourceOperationId),revision:null,sourceOperationId,
      creatorUserId:admin.scope.userId,recipientUserId:owner.scope.userId,occurredAt:new Date().toISOString(),sourceOccurredAt:new Date().toISOString(),customer:{name:'Chain mixed transfer',mobile:'9876543210'},
      lines:[{lineId:'chain-pack-line',familyPackId:pack.familyPackId,productName:pack.name,quantity:1,unitType:'box',packSnapshot:pack,sellingUnitPaise:pack.sellingUnitPaise},
        {lineId:'chain-product-line',productId:'P926101',productName:'P926101',quantity:1,unitType:'box',packSnapshot:{pack:'10 pieces',company:'Maker',piecesPerPack:10,allowLooseSale:1},sellingUnitPaise:10000}]}
    const envelope={payload,certificate:admin.preparation.certificate,signature:await sign(payload,admin.pair.privateKey)}
    const operation=(kind,body,extra={})=>({operationId:crypto.randomUUID(),kind,body,scope:owner.scope,deviceToken:owner.deviceToken,occurredAt:new Date().toISOString(),...extra})
    const send=async op=>okay(await api('owner','offline/sync',{method:'POST',body:op}))
    const handover=operation('HANDOVER',{transfer:envelope},{requestId:payload.requestId,expectedRevision:null,catalogue:owner.catalogue.products})
    const accepted=await send(handover);assert.equal((await send(handover)).idempotentReplay,true)
    const agreed=await send(operation('AGREEMENT',{acceptedAmountPaise:30000},{parentOperationId:accepted.operationId}))
    const closed=await send(operation('CLOSE',{}, {parentOperationId:agreed.operationId}))
    const pay=operation('PAYMENT',{entryType:'PAYMENT',amountPaise:2500,recordingMode:'OFFLINE',paymentMethod:'CASH'},{parentOperationId:closed.operationId})
    await send(pay);assert.equal((await send(pay)).idempotentReplay,true)
    const count=async table=>(await first(`SELECT count(*) n FROM ${table} WHERE request_id = ?`,payload.requestId)).n
    assert.equal(await count('request_handover_claims'),1);assert.equal(await count('offline_sync_receipts'),4)
    assert.equal(await count('request_payment_ledger'),1);assert.equal(await count('bill_item_purchase_costs'),2)
    const item=await first('SELECT pack_snapshot FROM customer_request_items WHERE request_id = ? AND family_pack_id = ?',payload.requestId,pack.familyPackId)
    assert.deepEqual(JSON.parse(item.pack_snapshot),pack)
    const financial=(await quote(payload.requestId)).internalFinancialSummary;assert.equal(financial.profitPaise,null)
    state.requests.qr=payload.requestId
    return {requestId:payload.requestId,claims:1,receipts:4,payments:1,costRows:2,familyPackProfitUnavailable:true}
  })
  await check('CHAIN-09','Final scope, audit and schema compatibility invariants',async()=>{
    assert.deepEqual(await first('SELECT * FROM platform_settings'),state.platformBefore)
    assert.deepEqual((await sql('PRAGMA foreign_key_check')).results,[])
    const foreign=await first(`SELECT count(*) n FROM bill_item_purchase_costs c JOIN request_payment_accounts a ON a.request_id = c.request_id
      WHERE c.business_id != a.business_id OR c.location_id != a.location_id OR c.season_id != a.season_id OR c.quotation_id != a.quotation_id`)
    assert.equal(foreign.n,0)
    return {platformSettingUnchanged:true,costScopeMismatches:0,foreignKeyViolations:0}
  })
}finally{await runtime.dispose()}
await inspect('final')
