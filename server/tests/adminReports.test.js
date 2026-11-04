import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { workflowDb, workflowMigration, paymentMigration, purchaseCostMigration } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { handleAdminReports } from '../src/routes/adminReports.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { handleAdminOfflineRoutes } from '../src/routes/adminOfflineSync.js'
import { getStandaloneReport } from '../src/services/adminReports.js'
import worker from '../src/index.js'

const season='season-2026'
async function api(db,path,{actor='owner',location='loc-a',selectedSeason=season,method='GET',body,revision,mode=true}={}){
  const request=new Request('https://example.test/api/admin/'+path,{method,headers:{'Content-Type':'application/json','X-Admin-Location-Id':location,'X-Admin-Season-Id':selectedSeason,
    'Idempotency-Key':crypto.randomUUID(),...(revision==null?{}:{'If-Match':String(revision)})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const identity={userId:actor,email:actor+'@test.com'},access=await attachAdminRequestContext(request,db,identity,{ADMIN_LOCATION_MODE:mode})
  if(!access.ok)return Response.json(access,{status:access.status})
  if(path.startsWith('reports'))return handleAdminReports(request,{DB:db})
  if(path.startsWith('quick-bill/'))return handleAdminQuickBillRoutes(request,{DB:db},identity)
  if(path.startsWith('offline/'))return handleAdminOfflineRoutes(request,{DB:db},identity)
  return handleAdminCustomerRequestRoutes(request,{DB:db},new URL(request.url),identity)
}
async function okay(response){assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return response.json()}
const report=async(db,type,query='',options={})=>okay(await api(db,'reports/'+type+(query?'?'+query:''),options))
const revision=async(db,id)=>(await db.prepare('SELECT revision FROM customer_requests WHERE id = ?').bind(id).first()).revision
async function setup(t,options={}){
  const db=await workflowDb(t,options)
  await db.script("INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES('P001',5000,'2026-01-01','season-2026','loc-a');")
  return db
}
async function bill(db,{due=17000,quantity=2,unitType='box',product='P001',location='loc-a',selectedSeason=season,closedAt='2026-11-03T12:00:00.000Z',finalize=true}={}){
  const created=await api(db,'quick-bill/checkout',{method:'POST',location,selectedSeason,body:{customer:{name:'Report fixture',mobile:'9876543210'},items:[{productId:product,quantity,unitType}],pricingMode:'bargain',acceptedAmountPaise:due}})
  assert.equal(created.status,201,JSON.stringify(await created.clone().json()));const id=(await created.json()).request.id
  if(finalize){await okay(await api(db,`customer-requests/${id}/finalize`,{method:'PATCH',location,selectedSeason,revision:await revision(db,id)}));await db.prepare('UPDATE customer_requests SET closed_at = ? WHERE id = ?').bind(closedAt,id).run()}
  return id
}
async function payment(db,id,{amount=1000,method='CASH',mode='ONLINE',occurred='2026-11-01T12:00:00.000Z',received='2026-11-04T12:00:00.000Z',entry='PAYMENT'}={}){
  const identity=crypto.randomUUID(),reference=method==='CASH'||entry!=='PAYMENT'?null:identity.toUpperCase()
  await db.prepare(`INSERT INTO request_payment_ledger(payment_id,operation_id,payload_fingerprint,request_id,business_id,location_id,season_id,entry_type,amount_paise,
    recording_mode,payment_method,reference,normalized_reference,actor_user_id,actor_name,actor_role,occurred_at,received_at)
    VALUES(?,?,?,?,'shop','loc-a','season-2026',?,?,?,?,?,?,'owner','Report Owner','owner',?,?)`)
    .bind(identity,identity,'test-fixture',id,entry,entry==='PAYMENT'?amount:0,mode,entry==='PAYMENT'?method:null,reference,reference,occurred,received).run()
}

test('scoped report discovery and method/auth boundaries do not grant Platform or global-role bypass',async t=>{
  const db=await setup(t)
  const owner=await okay(await api(db,'reports'));assert.equal(owner.reports.length,6)
  const admin=await okay(await api(db,'reports',{actor:'admin'}));assert.equal(admin.reports.includes('profit'),false)
  assert.deepEqual(admin.reports,['bills','products'])
  assert.equal((await api(db,'reports/bills',{method:'POST',body:{}})).status,405)
  const response=await worker.fetch(new Request('https://example.test/api/admin/reports'),{DB:{},ADMIN_LOCATION_MODE:true},{})
  assert.equal(response.status,401)
  assert.equal((await api(db,'reports/unknown')).status,404)
  await db.script("INSERT INTO admin_users(id,email,display_name,role) VALUES('platform','platform@test.com','Platform','owner'); INSERT INTO platform_admins(admin_user_id) VALUES('platform');")
  assert.equal((await api(db,'reports/bills',{actor:'platform'})).status,403)
  assert.equal((await api(db,'reports/bills',{location:'loc-b'})).status,403)
})

test('daily, bill-wise and selected-season reports sum frozen finalized amounts exactly once',async t=>{
  const db=await setup(t),first=await bill(db),second=await bill(db,{due:12000})
  await bill(db,{finalize:false})
  await payment(db,first,{amount:1000});await payment(db,first,{amount:2000})
  const daily=await report(db,'sales-by-date');assert.equal(daily.summary.billCount,2);assert.equal(daily.summary.amountDuePaise,29000)
  assert.equal(daily.rows.length,1);assert.equal(daily.rows[0].billCount,2);assert.equal(daily.rows[0].businessDate,'2026-11-03')
  const bills=await report(db,'bills');assert.deepEqual(new Set(bills.rows.map(row=>row.requestId)),new Set([first,second]))
  assert.equal(bills.rows.find(row=>row.requestId===first).receivedPaise,3000);assert.equal(bills.rows.find(row=>row.requestId===first).outstandingPaise,14000)
  assert.equal(bills.rows[0].recordedQuotationTotalPaise,20000,'not substituted for bill due')
  const seasons=await report(db,'seasons');assert.equal(seasons.rows.length,1);assert.equal(seasons.rows[0].seasonId,season);assert.equal(seasons.rows[0].amountDuePaise,29000)
})

test('Asia/Kolkata date filters are inclusive/exclusive at midnight and preserve fractional seconds',async t=>{
  const db=await setup(t)
  for(const closedAt of ['2026-11-03T18:29:59.999Z','2026-11-03T18:30:00.000Z','2026-11-04T18:29:59.999Z','2026-11-04T18:30:00.000Z'])await bill(db,{closedAt})
  const data=await report(db,'sales-by-date','from=2026-11-04&toExclusive=2026-11-05')
  assert.equal(data.timeZone,'Asia/Kolkata');assert.equal(data.rows.length,1);assert.equal(data.rows[0].businessDate,'2026-11-04');assert.equal(data.rows[0].billCount,2)
  assert.equal(data.summary.amountDuePaise,34000);assert.equal(data.filters.fromUtc,'2026-11-03T18:30:00.000Z');assert.equal(data.filters.toExclusiveUtc,'2026-11-04T18:30:00.000Z')
})

test('collections use payment dates, separate method/mode and exclude HOLD without multiplying bill amounts',async t=>{
  const db=await setup(t),id=await bill(db,{closedAt:'2026-11-01T10:00:00.000Z'})
  await payment(db,id,{amount:1000,received:'2026-11-03T18:29:59.999Z'})
  await payment(db,id,{amount:2000,received:'2026-11-03T18:30:00.000Z'})
  await payment(db,id,{amount:3000,method:'UPI',mode:'OFFLINE',received:'2026-11-04T18:29:59.999Z'})
  await payment(db,id,{entry:'HOLD'})
  const query='from=2026-11-04&toExclusive=2026-11-05'
  const collections=await report(db,'collections',query)
  assert.equal(collections.summary.collectedPaise,5000);assert.equal(collections.summary.paymentCount,2);assert.equal(collections.rows.length,2)
  assert.ok(collections.rows.some(row=>row.paymentMethod==='UPI'&&row.recordingMode==='OFFLINE'&&row.collectedPaise===3000))
  assert.equal((await report(db,'collections',query+'&dateBasis=occurred')).summary.collectedPaise,0)
  assert.equal((await report(db,'collections',query+'&paymentMethod=UPI')).summary.collectedPaise,3000)
  const bills=await report(db,'bills');assert.equal(bills.rows[0].receivedPaise,6000);assert.equal(bills.rows[0].outstandingPaise,11000);assert.equal(bills.rows[0].paymentStatus,'HOLD')
})

test('product reports preserve saved units/line prices and do not allocate agreed bill amounts',async t=>{
  const db=await setup(t)
  await bill(db);await bill(db,{quantity:3,unitType:'piece',due:2500})
  await db.prepare("UPDATE products SET selling_price_paise = 99999 WHERE id = 'P001'").bind().run()
  const data=await report(db,'products')
  assert.equal(data.rows.length,2);assert.equal(data.summary.recordedLineSalesPaise,23000)
  assert.equal(data.rows.find(row=>row.unitType==='box').quantity,2);assert.equal(data.rows.find(row=>row.unitType==='piece').quantity,3)
  assert.ok(data.rows.every(row=>row.allocatedFinalRevenuePaise===null));assert.equal((await report(db,'products','unitType=piece')).summary.recordedLineSalesPaise,3000)
})

test('historical profit uses only immutable complete cost snapshots, including legitimate zero costs',async t=>{
  const db=await setup(t),id=await bill(db)
  await db.prepare("UPDATE product_purchase_rates SET unit_rate_paise = 9900 WHERE product_id = 'P001'").bind().run()
  const originalPrepare=db.prepare.bind(db)
  db.prepare=sql=>{assert.ok(!/FROM (product_purchase_rates|private_rates)/i.test(sql));return originalPrepare(sql)}
  const data=await report(db,'profit')
  assert.equal(data.rows[0].requestId,id);assert.equal(data.rows[0].purchaseCostPaise,10000);assert.equal(data.rows[0].profitPaise,7000);assert.equal(data.rows[0].costAvailable,true)
  db.prepare=originalPrepare
  await db.prepare("UPDATE product_purchase_rates SET unit_rate_paise = 0 WHERE product_id = 'P001'").bind().run()
  const zero=await bill(db,{due:9000})
  const result=await report(db,'profit','requestId='+zero)
  assert.equal(result.rows[0].purchaseCostPaise,0);assert.equal(result.rows[0].profitPaise,9000);assert.equal(result.summary.knownProfitPaise,9000)
})

test('pre-0025 finalized bills retain unavailable cost/profit and do not backfill from current rates',async t=>{
  const db=await setup(t,{purchaseCosts:false}),id=await bill(db)
  await db.script(purchaseCostMigration)
  const data=await report(db,'profit')
  assert.equal(data.rows[0].costAvailable,false);assert.equal(data.rows[0].purchaseCostPaise,null);assert.equal(data.rows[0].profitPaise,null)
  assert.equal(data.summary.profitPaise,null);assert.equal(data.summary.unavailableCostBillCount,1)
  assert.equal((await db.prepare('SELECT count(*) n FROM bill_item_purchase_costs WHERE request_id = ?').bind(id).first()).n,0)
})

test('mixed known/missing cost coverage never becomes an estimated complete profit total',async t=>{
  const db=await setup(t);await bill(db)
  await db.prepare("UPDATE product_purchase_rates SET effective_to = '2026-11-02' WHERE product_id = 'P001'").bind().run()
  await bill(db)
  const data=await report(db,'profit')
  assert.equal(data.summary.billCount,2);assert.equal(data.summary.completeCostBillCount,1);assert.equal(data.summary.unavailableCostBillCount,1)
  assert.equal(data.summary.knownPurchaseCostPaise,10000);assert.equal(data.summary.knownProfitPaise,7000)
  assert.equal(data.summary.purchaseCostPaise,null);assert.equal(data.summary.profitPaise,null)
})

test('Family Pack sales keep fixed variant identity and quantities while profit stays unavailable',async t=>{
  const db=await setup(t)
  await db.script(readFileSync(new URL('../database/migrations/0023_offline_sync_receipts.sql',import.meta.url),'utf8'))
  await db.script(`INSERT INTO family_packs(id,slug,name,selling_price_paise,active,season_id,location_id) VALUES('FP001','report-pack','Report Pack',20000,1,'season-2026','loc-a');
    INSERT INTO family_pack_items(family_pack_id,product_id,quantity,unit_label) VALUES('FP001','P001',2,'box');`)
  const scope={businessId:'shop',locationId:'loc-a',seasonId:season,userId:'owner',deviceId:'reports-device'},deviceToken='ab'.repeat(32)
  await okay(await api(db,'offline/devices',{method:'POST',body:{deviceId:scope.deviceId,deviceToken}}))
  const catalogue=await okay(await api(db,'offline/catalogue')),pack=catalogue.familyPacks[0]
  const created=await okay(await api(db,'offline/sync',{method:'POST',body:{operationId:'reports-pack-create',scope,deviceToken,occurredAt:'2026-11-03T10:00:00.000Z',kind:'CREATE',catalogue:catalogue.products,
    lineSnapshots:[{lineId:crypto.randomUUID(),familyPackId:pack.familyPackId,productName:pack.name,quantity:1,unitType:'box',packSnapshot:pack,sellingUnitPaise:pack.sellingUnitPaise}],
    body:{customer:{name:'Pack report',mobile:'9876543210'},items:[{familyPackId:'FP001',quantity:1}],pricingMode:'bargain',acceptedAmountPaise:17000}}}))
  await okay(await api(db,`customer-requests/${created.requestId}/finalize`,{method:'PATCH',revision:await revision(db,created.requestId)}))
  const products=await report(db,'products');assert.equal(products.rows.length,1);assert.equal(products.rows[0].familyPackId,'FP001');assert.equal(products.rows[0].quantity,1)
  const profit=await report(db,'profit');assert.equal(profit.rows[0].profitPaise,null);assert.equal(profit.rows[0].costAvailable,false)
})

test('Admin ordinary reports omit private financial values and profit endpoint is denied by effective role',async t=>{
  const db=await setup(t);await bill(db)
  await db.prepare("UPDATE admin_users SET role = 'owner' WHERE id = 'admin'").bind().run()
  for(const type of ['bills','products']){
    const data=await report(db,type,'',{actor:'admin'})
    assert.ok(!/purchaseCostPaise|profitPaise|knownProfit|recordedQuotationTotalPaise|recordedAdjustmentPaise|recordedLineSalesPaise/.test(JSON.stringify(data)),type)
    if(type==='bills')assert.equal(Object.hasOwn(data.summary,'amountDuePaise'),false)
  }
  assert.equal((await api(db,'reports/profit',{actor:'admin'})).status,403)
  for(const type of ['sales-by-date','collections','seasons'])assert.equal((await api(db,'reports/'+type,{actor:'admin'})).status,403)
  assert.equal((await report(db,'profit','',{actor:'super'})).rows[0].profitPaise,7000)
  await db.script("INSERT INTO location_members VALUES('loc-b','season-2026','owner','admin',NULL);")
  assert.equal((await api(db,'reports/profit',{location:'loc-b'})).status,403)
})

test('authorized second stall never reads first-stall bills or line data, and scope query overrides are rejected',async t=>{
  const db=await setup(t),a=await bill(db)
  await db.script("INSERT INTO location_members VALUES('loc-b','season-2026','owner','owner',NULL);")
  const b=await bill(db,{location:'loc-b',product:'P002',due:9000})
  assert.equal((await report(db,'bills')).rows[0].requestId,a)
  assert.equal((await report(db,'bills','',{location:'loc-b'})).rows[0].requestId,b)
  assert.equal((await api(db,'reports/bills?requestId='+a,{location:'loc-b'})).status,404)
  assert.equal((await report(db,'products','productId=P001',{location:'loc-b'})).rows.length,0)
  assert.equal((await api(db,'reports/bills?businessId=shop')).status,400)
})

test('season-wise report is strictly selected-season; explicit historical membership permits reads without writes',async t=>{
  const db=await setup(t);await bill(db)
  await db.script(`INSERT INTO business_seasons(id,code,label,status) VALUES('season-other','other','Other','active');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-other','owner','owner');
    INSERT INTO location_seasons VALUES('loc-a','season-other',2027,'active');
    INSERT INTO location_members VALUES('loc-a','season-other','owner','owner',NULL);`)
  const other=await bill(db,{selectedSeason:'season-other',due:9000})
  const data=await report(db,'seasons','',{selectedSeason:'season-other'});assert.equal(data.rows.length,1);assert.equal(data.rows[0].seasonId,'season-other');assert.equal(data.summary.amountDuePaise,9000)
  assert.equal((await api(db,'reports/bills?requestId='+other)).status,404)
  await db.prepare("UPDATE business_seasons SET status = 'archived' WHERE id = 'season-other'").bind().run()
  assert.equal((await api(db,'reports/profit',{selectedSeason:'season-other'})).status,200)
  assert.equal((await api(db,'reports/bills',{method:'POST',selectedSeason:'season-other',body:{}})).status,403)
  await db.prepare("DELETE FROM season_members WHERE season_id = 'season-other' AND admin_user_id = 'owner'").bind().run()
  assert.equal((await api(db,'reports/bills',{selectedSeason:'season-other'})).status,403)
})

test('legacy missing bill amounts and finalization dates are unavailable, never estimated from catalogue or migration time',async t=>{
  const db=await workflowDb(t,{migrate:false}),id='11111111-1111-4111-8111-111111111111'
  await db.script(`INSERT INTO customer_requests(id,status,source,season_id,location_id,finalization_status) VALUES('${id}','closed','manual','season-2026','loc-a','finalized');
    INSERT INTO customer_request_items(request_id,line_number,product_id,product_name,quantity,unit_price_paise) VALUES('${id}',1,'P001','Old product',1,10000);
    INSERT INTO quotations(id,customer_request_id,status,subtotal_paise,total_paise,accepted_amount_paise,season_id,location_id) VALUES('old-quote','${id}','draft',10000,10000,NULL,'season-2026','loc-a');
    INSERT INTO quotation_items(quotation_id,line_number,product_id,product_name,quantity,unit_rate_paise,line_total_paise) VALUES('old-quote',1,'P001','Old product',1,10000,10000);`)
  for(const migration of [workflowMigration,paymentMigration,purchaseCostMigration])await db.script(migration)
  const data=await report(db,'sales-by-date');assert.equal(data.rows[0].businessDate,null);assert.equal(data.summary.amountDuePaise,null);assert.equal(data.summary.unavailableAmountBillCount,1)
  const filtered=await report(db,'sales-by-date','from=2026-11-01&toExclusive=2026-11-05');assert.equal(filtered.rows.length,0);assert.equal(filtered.summary.unknownFinalizationDateBillCountInScope,1)
  assert.equal((await report(db,'products')).summary.unavailableBillLineBasisCount,1)
  assert.equal((await report(db,'profit')).summary.profitPaise,null)
})

test('pagination is bounded and deterministic while totals cover all filtered bills/groups',async t=>{
  const db=await setup(t)
  const ids=[];for(let day=1;day<=3;day++)ids.push(await bill(db,{closedAt:`2026-11-0${day}T10:00:00.000Z`}))
  const first=await report(db,'bills','limit=1&page=1'),second=await report(db,'bills','limit=1&page=2')
  assert.equal(first.pagination.total,3);assert.equal(first.pagination.totalPages,3);assert.equal(first.summary.amountDuePaise,51000)
  assert.notEqual(first.rows[0].requestId,second.rows[0].requestId)
  assert.deepEqual((await report(db,'bills','limit=1&page=2')).rows,second.rows)
  assert.equal((await report(db,'sales-by-date','limit=1&page=2')).pagination.total,3)
  assert.equal((await report(db,'bills','limit=1&page=9')).rows.length,0)
})

test('invalid dates, duplicate filters, unsupported bases and excessive pages are rejected explicitly',async t=>{
  const db=await setup(t)
  for(const query of ['from=2026-02-30','from=2026-11-04&toExclusive=2026-11-03','from=2026-11-03&from=2026-11-04','limit=101','page=0','page=10001','dateBasis=occurred','timezone=UTC','seasonId=season-2026'])assert.equal((await api(db,'reports/bills?'+query)).status,400,query)
  assert.equal((await api(db,'reports/collections?paymentMethod=CRYPTO')).status,400)
  assert.equal((await api(db,'reports/products?productId=P001&familyPackId=FP001')).status,400)
})

test('fresh live authority gates cost reads even after a privileged context has been captured',async t=>{
  const db=await setup(t);await bill(db)
  const request=new Request('https://example.test/api/admin/reports/profit',{headers:{'X-Admin-Location-Id':'loc-a','X-Admin-Season-Id':season}})
  assert.equal((await attachAdminRequestContext(request,db,{userId:'owner',email:'owner@test.com'},{ADMIN_LOCATION_MODE:true})).ok,true)
  const context=getAdminContext(request)
  await db.prepare("UPDATE location_members SET role = 'admin' WHERE admin_user_id = 'owner'").bind().run()
  await assert.rejects(getStandaloneReport(db,'profit',new URLSearchParams(),{seasonId:season,context}),error=>error.status===403)
  assert.equal((await api(db,'reports/bills')).status,200)
})

test('safe-integer overflow fails instead of returning rounded aggregate money',async t=>{
  const db=await setup(t)
  await bill(db,{due:Number.MAX_SAFE_INTEGER});await bill(db,{due:Number.MAX_SAFE_INTEGER})
  const response=await api(db,'reports/sales-by-date');assert.equal(response.status,503)
  assert.equal((await response.json()).error,'report_total_out_of_range')
})

test('reports do not mutate financial rows or schema and legacy mode never falls back to an unscoped query',async t=>{
  const db=await setup(t);await bill(db)
  const before=await db.prepare('SELECT * FROM customer_requests').bind().all(),schema=await db.prepare('SELECT * FROM sqlite_master ORDER BY name').bind().all()
  for(const type of ['sales-by-date','bills','collections','products','seasons','profit'])await report(db,type)
  assert.deepEqual(await db.prepare('SELECT * FROM customer_requests').bind().all(),before)
  assert.deepEqual(await db.prepare('SELECT * FROM sqlite_master ORDER BY name').bind().all(),schema)
  const legacy=await setup(t)
  assert.equal((await api(legacy,'reports/bills',{mode:false})).status,503)
})
