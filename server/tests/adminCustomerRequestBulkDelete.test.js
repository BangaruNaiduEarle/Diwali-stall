import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import { workflowDb } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { bulkDeleteAdminCustomerRequests, validateCustomerRequestBulkDelete } from '../src/services/adminCustomerRequestBulkDelete.js'
import { listAdminCustomerRequests, getAdminCustomerRequestById } from '../src/services/adminCustomerRequests.js'
import { getActiveQuotationForRequest } from '../src/services/adminQuotations.js'
import { getRequestPayments, recordRequestPayment } from '../src/services/adminPayments.js'

const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const protectedIds = ['cr-737b1d5a26c757f6588763e787854700', '77ece069-78e3-4fab-8a4d-ad118845dd47']
const retained = ['request_workflow_events','request_payment_accounts','request_payment_ledger','offline_sync_receipts','request_handover_claims','offline_final_price_uses','bill_item_purchase_costs']

test('bulk delete rejects empty, duplicate, oversized, invalid and unexpected input', () => {
  for (const body of [null, [], {}, {requestIds:[]}, {requestIds:[id(1),id(1)]}, {requestIds:['bad']}, {requestIds:[id(1)],seasonId:'other'}, {requestIds:Array.from({length:101},(_,i)=>id(i))}]) {
    assert.equal(validateCustomerRequestBulkDelete(body).ok, false)
  }
  assert.deepEqual(validateCustomerRequestBulkDelete({requestIds:[id(1),id(2)]}), {ok:true,ids:[id(1),id(2)]})
})

async function fixture(t) {
  // Synthetic, fresh :memory: schema/rows only. No config, env file, credentials,
  // retained backup, production inventory or existing local D1 is opened.
  const source = await workflowDb(t, {migrate:false})
  await source.script("INSERT INTO businesses VALUES('other-shop','other-shop','Other shop','permanent','active'); UPDATE business_locations SET business_id='other-shop' WHERE id='loc-b';")
  await source.script("INSERT INTO business_seasons(id,code,label,status) VALUES('season-2025','2025','Previous','active'); INSERT INTO location_seasons VALUES('loc-a','season-2025',2025,'active');")
  for (const requestId of [...Array.from({length:10},(_,i)=>id(i+1)),...protectedIds]) {
    const n = Number(requestId.slice(0,8)), location = n===4?'loc-b':'loc-a', season=n===5?'season-2025':'season-2026'
    await source.prepare(`INSERT INTO customer_requests(id,status,source,season_id,location_id,finalization_status)
      VALUES(?,?,'web',?,?,?)`).bind(requestId,n===6?'closed':'received',season,location,n===6?'finalized':null).run()
    await source.prepare('INSERT INTO customer_request_items(request_id,line_number,product_id,product_name,quantity,unit_price_paise) VALUES(?,1,?,?,1,10000)')
      .bind(requestId,n===4?'P002':'P001','Synthetic product').run()
    await source.prepare(`INSERT INTO quotations(id,customer_request_id,season_id,location_id,subtotal_paise,total_paise,accepted_amount_paise)
      VALUES(?,?,?,?,10000,10000,10000)`).bind('q-'+requestId,requestId,season,location).run()
    await source.prepare('INSERT INTO quotation_items(quotation_id,line_number,product_id,product_name,quantity,unit_rate_paise,line_total_paise) VALUES(?,1,?,?,1,10000,10000)')
      .bind('q-'+requestId,n===4?'P002':'P001','Synthetic product').run()
  }
  for (const file of ['0021_request_workflow_history.sql','0022_request_payment_ledger.sql','0023_offline_sync_receipts.sql','0024_qr_handover.sql','0025_bill_purchase_cost_snapshots.sql','0028_offline_final_price_grants.sql','0030_request_payment_preferences.sql']) {
    await source.script(readFileSync(new URL('../database/migrations/'+file,import.meta.url),'utf8'))
  }
  await source.prepare("UPDATE customer_requests SET status='reviewing' WHERE id=?").bind(id(3)).run()
  await source.prepare(`INSERT INTO request_payment_ledger(payment_id,operation_id,payload_fingerprint,request_id,business_id,location_id,season_id,
    entry_type,amount_paise,recording_mode,payment_method,actor_user_id,actor_role,occurred_at)
    VALUES('fixture-payment','fixture-operation','fixture-fingerprint',?,'shop','loc-a','season-2026','PAYMENT',100,'ONLINE','CASH','owner','owner','2026-11-05T00:00:00Z')`).bind(id(6)).run()
  await source.script(`INSERT INTO offline_sync_devices(business_id,location_id,season_id,user_id,device_id,token_hash)
    VALUES('shop','loc-a','season-2026','owner','fixture-device','${'a'.repeat(64)}');`)
  await source.prepare(`INSERT INTO offline_sync_receipts(operation_id,fingerprint,business_id,location_id,season_id,user_id,device_id,actor_role,operation_type,request_id,revision,occurred_at)
    VALUES('fixture-receipt',?,'shop','loc-a','season-2026','owner','fixture-device','owner','EDIT',?,1,'2026-11-05T00:00:00Z')`).bind('b'.repeat(64),id(3)).run()
  await source.prepare('UPDATE quotation_items SET request_line_id=(SELECT line_id FROM customer_request_items WHERE request_id=?) WHERE quotation_id=?')
    .bind(protectedIds[0],'q-'+id(7)).run()
  await source.prepare("UPDATE customer_requests SET audit_actor_user_id='owner',audit_actor_role='owner' WHERE id=?").bind(id(6)).run()
  await source.prepare(`INSERT INTO bill_item_purchase_costs(quotation_item_id,request_id,quotation_id,request_line_id,business_id,location_id,season_id,
    product_id,quantity,unit_type,bill_line_count,unavailable_reason)
    SELECT qi.id,?,qi.quotation_id,qi.request_line_id,'shop','loc-a','season-2026',qi.product_id,qi.quantity,qi.unit_type,1,'missing_purchase_rate'
    FROM quotation_items qi WHERE qi.quotation_id=?`).bind(id(6),'q-'+id(6)).run()
  const schema = (await source.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").bind().all()).results
  const runtime = new Miniflare({modules:true, script:'export default {fetch(){return new Response("isolated local D1 bulk-delete tests")}}',
    compatibilityDate:'2025-04-01',host:'127.0.0.1',port:0,d1Databases:['DB'],d1Persist:false,cachePersist:false,kvPersist:false,r2Persist:false,durableObjectsPersist:false})
  t.after(()=>runtime.dispose())
  const db = await runtime.getD1Database('DB')
  const tables=schema.filter(row=>row.type==='table'), loaded=new Set()
  for (const row of tables) await db.prepare(row.sql).run()
  async function load(name) {
    if (loaded.has(name)) return
    loaded.add(name)
    for (const fk of (await source.prepare(`PRAGMA foreign_key_list("${name}")`).bind().all()).results) await load(fk.table)
    const rows=(await source.prepare(`SELECT * FROM "${name}"`).bind().all()).results
    if (rows.length) await db.batch(rows.map(row=>db.prepare(`INSERT INTO "${name}" (${Object.keys(row).map(c=>'"'+c+'"').join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row))))
  }
  for (const row of tables) await load(row.name)
  for (const row of schema.filter(row=>row.type!=='table')) await db.prepare(row.sql).run()
  return db
}

async function api(db, requestIds, {actor='owner',body={requestIds},location='loc-a'}={}) {
  const url=new URL('https://fixture.invalid/api/admin/customer-requests/bulk-delete')
  const request=new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Season-Id':'season-2026','X-Admin-Location-Id':location},body:JSON.stringify(body)})
  const identity={userId:actor,email:actor+'@test.com'}
  const attached=await attachAdminRequestContext(request,db,identity,{ADMIN_LOCATION_MODE:true})
  if(!attached.ok)return Response.json(attached,{status:attached.status})
  return handleAdminCustomerRequestRoutes(request,{DB:db},url,identity)
}
const row = (db,table,requestId) => db.prepare(`SELECT * FROM ${table} WHERE ${table==='customer_requests'?'id':table==='quotations'?'customer_request_id':'request_id'}=?`).bind(requestId).all()

async function contextFor(db, revision) {
  const request=new Request('https://fixture.invalid/api/admin/customer-requests/bulk-delete',{method:'POST',headers:{
    'X-Admin-Season-Id':'season-2026','X-Admin-Location-Id':'loc-a',...(revision===undefined?{}:{'If-Match':String(revision)}),
  }})
  const attached=await attachAdminRequestContext(request,db,{userId:'owner',email:'owner@test.com'},{ADMIN_LOCATION_MODE:true})
  assert.equal(attached.ok,true)
  return getAdminContext(request)
}

test('bulk removal archives in local D1 without deleting billing, purchase, stock or reconciliation records', async t => {
  const db=await fixture(t)
  const retainedBefore={}
  for(const table of retained)retainedBefore[table]=(await db.prepare(`SELECT * FROM ${table}`).all()).results
  const protectedSnapshot=async()=>Promise.all(protectedIds.map(async requestId=>({
    request:(await row(db,'customer_requests',requestId)).results,
    items:(await row(db,'customer_request_items',requestId)).results,
    quotations:(await row(db,'quotations',requestId)).results,
    quotationItems:(await db.prepare('SELECT qi.* FROM quotation_items qi JOIN quotations q ON q.id=qi.quotation_id WHERE q.customer_request_id=?').bind(requestId).all()).results,
  })))
  const protectedBefore=await protectedSnapshot()
  const unchangedTables=['customer_request_items','quotations','quotation_items','products','categories','family_packs','private_rates','product_purchase_rates',...retained.filter(table=>table!=='request_workflow_events')]
  const unchangedBefore={}
  for(const table of unchangedTables)unchangedBefore[table]=(await db.prepare(`SELECT * FROM ${table}`).all()).results
  await t.test('rejects unauthenticated, Admin and invalid input without writes',async()=>{
    assert.equal((await api(db,[id(1)],{actor:'admin'})).status,403)
    assert.equal((await api(db,[id(1)],{body:{requestIds:[id(1),id(1)]}})).status,400)
    const request=new Request('https://fixture.invalid/api/admin/customer-requests/bulk-delete',{method:'POST'})
    assert.equal((await handleAdminCustomerRequestRoutes(request,{DB:db},new URL(request.url),{})).status,403)
    await db.prepare("UPDATE location_seasons SET status='archived' WHERE location_id='loc-a' AND season_id='season-2026'").run()
    assert.equal((await api(db,[id(1)])).status,403)
    await db.prepare("UPDATE location_seasons SET status='active' WHERE location_id='loc-a' AND season_id='season-2026'").run()
  })
  await t.test('Owner removes open, closed/finalized, paid, audit/offline-history and shared-record requests from the list only',async()=>{
    const result=await api(db,[id(1),id(3),id(4),id(5),id(6),...protectedIds,id(7),id(99)])
    assert.equal(result.status,200)
    const data=await result.json()
    assert.deepEqual(data.archivedIds,[id(1),id(3),id(6),id(7)]);assert.equal(data.failedCount,5)
    assert.deepEqual(data.deletedIds,data.archivedIds)
    assert.equal(data.failed.find(r=>r.id===id(4)).code,'not_found')
    assert.equal(data.failed.find(r=>r.id===id(5)).code,'not_found')
    for(const requestId of data.archivedIds)assert.equal((await row(db,'customer_requests',requestId)).results.length,1)
    for(const table of unchangedTables)assert.deepEqual((await db.prepare(`SELECT * FROM ${table}`).all()).results,unchangedBefore[table],table+' must be untouched')
    assert.deepEqual((await db.prepare("SELECT * FROM request_workflow_events WHERE event_type!='request_archived'").all()).results,retainedBefore.request_workflow_events)
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM request_workflow_events WHERE event_type='request_archived'").first()).n,4)
    assert.deepEqual(await protectedSnapshot(),protectedBefore)
    assert.ok((await row(db,'customer_requests',id(4))).results.length)
    const context=await contextFor(db)
    const list=await listAdminCustomerRequests(db,{seasonId:'season-2026',context,limit:10,offset:0})
    assert.equal(list.total,6);assert.ok(list.requests.every(request=>!data.archivedIds.includes(request.id)))
    const filtered=await listAdminCustomerRequests(db,{seasonId:'season-2026',context,limit:10,offset:0,status:'closed'})
    assert.equal(filtered.total,0)
    const detail=await getAdminCustomerRequestById(db,id(6),'season-2026',context)
    assert.equal(detail.status,'closed');assert.equal(detail.finalizationStatus,'finalized');assert.equal(detail.items.length,1)
    const quotation=await getActiveQuotationForRequest(db,id(6),'season-2026',context)
    assert.equal(quotation.totalPaise,10000);assert.equal(quotation.acceptedAmountPaise,10000)
    const revision=(await row(db,'customer_requests',id(6))).results[0].revision
    await api(db,[id(6)])
    assert.equal((await row(db,'customer_requests',id(6))).results[0].revision,revision,'archival retry must not change revision')
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM request_workflow_events WHERE request_id=? AND event_type='request_archived'").bind(id(6)).first()).n,1)
  })
  await t.test('Super Admin can archive a request',async()=>{
    assert.deepEqual((await(await api(db,[id(10)],{actor:'super'})).json()).archivedIds,[id(10)])
    assert.equal((await row(db,'customer_requests',id(10))).results.length,1)
  })
  await t.test('billing can collect and replay payments on an archived finalized request; invoice and cost snapshots stay unchanged',async()=>{
    const revision=(await row(db,'customer_requests',id(6))).results[0].revision
    const context=await contextFor(db,revision), options={seasonId:'season-2026',context}
    const before=await getRequestPayments(db,id(6),options)
    assert.equal(before.summary.amountDuePaise,10000);assert.equal(before.summary.receivedPaise,100)
    const body={operationId:'archived-payment-operation',entryType:'PAYMENT',amountPaise:50,recordingMode:'ONLINE',paymentMethod:'CASH'}
    const paid=await recordRequestPayment(db,id(6),body,options)
    assert.equal(paid.ok,true);assert.equal(paid.summary.receivedPaise,150)
    const replay=await recordRequestPayment(db,id(6),body,options)
    assert.equal(replay.idempotentReplay,true);assert.equal(replay.entry.paymentId,paid.entry.paymentId)
    assert.equal((await getRequestPayments(db,id(6),options)).entries.length,2)
    for(const table of ['quotations','quotation_items','bill_item_purchase_costs','request_payment_accounts','offline_sync_receipts','products','product_purchase_rates']) {
      assert.deepEqual((await db.prepare(`SELECT * FROM ${table}`).all()).results,unchangedBefore[table],table)
    }
    assert.equal((await listAdminCustomerRequests(db,{seasonId:'season-2026',context,limit:10,offset:0,status:'closed'})).total,0)
  })
  await t.test('archive-event trigger rejection rolls back revision advancement without changing billing',async()=>{
    const before=(await row(db,'customer_requests',id(2))).results
    await db.prepare(`CREATE TRIGGER fixture_archive_reject BEFORE INSERT ON request_workflow_events WHEN NEW.request_id='${id(2)}' AND NEW.event_type='request_archived' BEGIN SELECT RAISE(ABORT,'fixture_archive_rejected'); END`).run()
    const data=await(await api(db,[id(2)])).json()
    assert.equal(data.failedCount,1);assert.equal(data.deletedCount,0)
    assert.deepEqual((await row(db,'customer_requests',id(2))).results,before)
    assert.equal((await row(db,'quotations',id(2))).results.length,1)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM quotation_items WHERE quotation_id=?').bind('q-'+id(2)).first()).n,1)
  })
  await t.test('failed post-archive assertion rolls back both the marker and revision in D1',async()=>{
    let error=''
    const before=(await row(db,'customer_requests',id(8))).results
    const wrapped=bindAdminServiceMode({prepare:db.prepare.bind(db),batch:async statements=>{
      const modified=[...statements];modified[3]=db.prepare("SELECT json('bulk_delete_assertion_failed')")
      try{return await db.batch(modified)}catch(reason){error=reason.message;throw reason}
    }},{ADMIN_LOCATION_MODE:true})
    const request=new Request('https://fixture.invalid/api/admin/customer-requests/bulk-delete',{method:'POST',headers:{'X-Admin-Season-Id':'season-2026','X-Admin-Location-Id':'loc-a'}})
    await attachAdminRequestContext(request,wrapped,{userId:'owner',email:'owner@test.com'},{ADMIN_LOCATION_MODE:true})
    const data=await bulkDeleteAdminCustomerRequests(wrapped,[id(8)],{seasonId:'season-2026',context:getAdminContext(request)})
    assert.match(error,/malformed JSON/i);assert.equal(data.failedCount,1)
    assert.deepEqual((await row(db,'customer_requests',id(8))).results,before)
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM request_workflow_events WHERE request_id=? AND event_type='request_archived'").bind(id(8)).first()).n,0)
    assert.equal((await row(db,'quotations',id(8))).results.length,1)
    assert.equal((await row(db,'customer_request_items',id(8))).results.length,1)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM quotation_items WHERE quotation_id=?').bind('q-'+id(8)).first()).n,1)
  })
  await t.test('fresh actor authority is checked inside the batch',async()=>{
    const wrapped=bindAdminServiceMode({prepare:db.prepare.bind(db),batch:async statements=>{
      await db.prepare("UPDATE location_members SET role='admin' WHERE admin_user_id='owner' AND location_id='loc-a'").run()
      return db.batch(statements)
    }},{ADMIN_LOCATION_MODE:true})
    const request=new Request('https://fixture.invalid/',{method:'POST',headers:{'X-Admin-Season-Id':'season-2026','X-Admin-Location-Id':'loc-a'}})
    await attachAdminRequestContext(request,wrapped,{userId:'owner',email:'owner@test.com'},{ADMIN_LOCATION_MODE:true})
    const data=await bulkDeleteAdminCustomerRequests(wrapped,[id(9)],{seasonId:'season-2026',context:getAdminContext(request)})
    assert.equal(data.failedCount,1);assert.equal((await row(db,'quotations',id(9))).results.length,1)
    await db.prepare("UPDATE location_members SET role='owner' WHERE admin_user_id='owner' AND location_id='loc-a'").run()
  })
  await t.test('foreign keys and original append-only triggers stay enabled',async()=>{
    assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys,1)
    await assert.rejects(db.prepare('DELETE FROM request_workflow_events').run(),/append_only/i)
    await assert.rejects(db.prepare('DELETE FROM customer_requests WHERE id=?').bind(id(8)).run(),/FOREIGN KEY/i)
    assert.equal((await row(db,'customer_requests',id(8))).results.length,1)
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[])
  })
})
