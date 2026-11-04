import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchReport, fetchReportList } from './adminReports.js'
import { clearAdminActiveSeasonId, setAdminActiveSeasonId, setAdminLocationSelection, setAdminContextSwitching } from './adminSeasonRequest.js'
const scope={businessId:'business',locationId:'a',seasonId:'season'}
const fixture=(type='bills')=>({ok:true,scope,timeZone:'Asia/Kolkata',currency:'INR',report:type,summary:{billCount:1},rows:[{requestId:'id',amountDuePaise:17000}],pagination:{page:1,limit:25,total:1,totalPages:1}})
function context(location='a',season='season'){setAdminActiveSeasonId(season);setAdminLocationSelection({locationModeEnabled:true,activeBusinessId:'business',activeLocationId:location})}
function setup(t,fetcher){const old=globalThis.fetch;globalThis.fetch=fetcher;context();t.after(()=>{globalThis.fetch=old;clearAdminActiveSeasonId()})}
test('report GET attaches confirmed stall/season credentials and no-store; query is forwarded unchanged',async t=>{
  setup(t,async(url,options)=>{assert.equal(url,'/api/admin/reports/bills?from=2026-11-04&toExclusive=2026-11-05&page=2&limit=1');assert.equal(options.headers.get('X-Admin-Location-Id'),'a');assert.equal(options.headers.get('X-Admin-Season-Id'),'season');assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');return Response.json(fixture())})
  assert.equal((await fetchReport('bills','from=2026-11-04&toExclusive=2026-11-05&page=2&limit=1','owner')).ok,true)
})
test('all six existing report routes are supported without client calculations',async t=>{
  setup(t,async url=>Response.json(fixture(url.split('/').at(-1))))
  for(const type of ['sales-by-date','bills','collections','products','seasons','profit'])assert.equal((await fetchReport(type,'','super_admin')).report.report,type)
})
test('discovery intersects server grants with the current effective role and financial calls default-deny for Admin',async t=>{
  let calls=0;setup(t,async()=>{calls++;return Response.json({ok:true,scope,timeZone:'Asia/Kolkata',reports:['bills','products','profit','collections']})})
  assert.deepEqual((await fetchReportList('admin')).reports,['bills','products'])
  assert.equal((await fetchReport('profit','','admin')).status,403);assert.equal(calls,1)
})
test('foreign business/stall/season responses fail closed even without a generation change',async t=>{
  setup(t,async()=>Response.json({...fixture(),scope:{...scope,locationId:'b'}}));assert.equal((await fetchReport('bills','','owner')).error,'invalid_report_response')
  for(const field of ['businessId','seasonId']){globalThis.fetch=async()=>Response.json({...fixture(),scope:{...scope,[field]:'other'}});assert.equal((await fetchReport('bills','','owner')).ok,false)}
})
test('late stall and season responses are rejected by the shared API generation guard',async t=>{
  let finish;setup(t,()=>new Promise(resolve=>{finish=resolve}));const pending=fetchReport('bills','','owner');context('b');finish(Response.json(fixture()));assert.equal((await pending).error,'stale_context')
  const second=fetchReport('bills','','owner');context('b','next');finish(Response.json(fixture()));assert.equal((await second).error,'stale_context')
})
test('Admin payloads with private values or disallowed aggregate amounts fail closed',async t=>{
  setup(t,async()=>Response.json({...fixture(),rows:[{requestId:'id',purchaseCostPaise:1000}]}));assert.equal((await fetchReport('bills','','admin')).ok,false)
  globalThis.fetch=async()=>Response.json({...fixture(),summary:{billCount:1,amountDuePaise:17000}});assert.equal((await fetchReport('bills','','admin')).ok,false)
})
test('null historical profit is preserved; zero and negative recorded values are not recomputed',async t=>{
  const data={...fixture('profit'),rows:[{requestId:'old',costAvailable:false,purchaseCostPaise:null,profitPaise:null},{requestId:'loss',costAvailable:true,purchaseCostPaise:1000,profitPaise:-1}]}
  setup(t,async()=>Response.json(data));assert.deepEqual((await fetchReport('profit','','owner')).report.rows,data.rows)
})
test('malformed money, pagination and report identity are rejected',async t=>{
  setup(t,async()=>Response.json({...fixture(),rows:[{amountDuePaise:1.5}]}));assert.equal((await fetchReport('bills','','owner')).ok,false)
  globalThis.fetch=async()=>Response.json({...fixture(),pagination:{page:1,limit:1000,total:1,totalPages:1}});assert.equal((await fetchReport('bills','','owner')).ok,false)
  globalThis.fetch=async()=>Response.json(fixture('profit'));assert.equal((await fetchReport('bills','','owner')).ok,false)
})
test('authorization, session expiry, network failure and empty data remain explicit',async t=>{
  setup(t,async()=>Response.json({error:'forbidden',message:'Membership removed.'},{status:403}));assert.equal((await fetchReport('bills','','owner')).status,403)
  globalThis.fetch=async()=>Response.json({error:'unauthorized'},{status:401});assert.equal((await fetchReport('bills','','owner')).status,401)
  globalThis.fetch=async()=>{throw Error('offline')};assert.equal((await fetchReport('bills','','owner')).error,'network_error')
  globalThis.fetch=async()=>Response.json({...fixture(),rows:[],pagination:{page:1,limit:25,total:0,totalPages:0}});assert.equal((await fetchReport('bills','','owner')).report.rows.length,0)
})
test('switching and legacy mode never send an unscoped report fetch',async t=>{
  let calls=0;setup(t,async()=>{calls++;return Response.json(fixture())});setAdminContextSwitching(true);assert.equal((await fetchReport('bills','','owner')).ok,false);assert.equal(calls,0)
  clearAdminActiveSeasonId();assert.equal((await fetchReport('bills','','owner')).error,'location_required');assert.equal(calls,0)
})
