// Read-only API rehearsal against a fresh copy of the established disposable fixture.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

const root='C:/Users/naidu/AppData/Local/Temp/diwali-release-b38657123a324f3a9e7c02c159b82c79'
const source=JSON.parse(await readFile(path.join(root,'chain-687017a4/state.json'),'utf8'))
const directory=path.join(root,'reports-backend-'+crypto.randomUUID().slice(0,8))
await mkdir(directory)
const file=name=>path.join(directory,name),save=(name,value)=>writeFile(file(name),JSON.stringify(value,null,2))
const state={sourceDatabase:source.databaseFile,databaseId:crypto.randomUUID()}
const run=promisify(execFile)
const inspect=async operation=>{const result=await run('C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe',['server/scripts/reports-backend-db.py',directory,operation],{windowsHide:true});console.log(result.stdout.trim())}
const options={modules:true,compatibilityDate:'2026-05-01',host:'127.0.0.1',port:0,d1Databases:{DB:state.databaseId},d1Persist:file('persist/v3/d1'),cachePersist:false,kvPersist:false,r2Persist:false,durableObjectsPersist:false}
const empty=new Miniflare({...options,script:'export default {fetch(){return new Response("fixture")}}'})
try{await (await empty.getD1Database('DB')).prepare('SELECT 1').first()}finally{await empty.dispose()}
const data=file('persist/v3/d1/miniflare-D1DatabaseObject'),names=(await readdir(data)).filter(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite')
assert.equal(names.length,1);state.databaseFile=path.join(data,names[0]);await save('state.json',state);await inspect('clone')
const bundle=await build({entryPoints:[path.resolve('server/src/index.js')],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,logLevel:'silent'})
const runtime=new Miniflare({...options,script:bundle.outputFiles[0].text,bindings:{ADMIN_LOCATION_MODE:true,ADMIN_LOCAL_DEV_AUTH:false}})
const results=[],trace=[],cookies={}
try{
  const base=new URL(await runtime.ready),db=await runtime.getD1Database('DB')
  const api=async(actor,route,{method='GET',body,location=source.a,season=source.season}={})=>{
    const response=await fetch(new URL('/api/admin/'+route,base),{method,headers:{Origin:base.origin,'Content-Type':'application/json',Cookie:cookies[actor]??'',
      'X-Admin-Location-Id':location,'X-Admin-Season-Id':season},...(body===undefined?{}:{body:JSON.stringify(body)})})
    const data=await response.json();trace.push({actor,route,method,location,season,status:response.status,error:data.error})
    return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],cache:response.headers.get('cache-control')}
  }
  const check=async(name,fn)=>{const evidence=await fn();results.push({name,status:'PASS',evidence});console.log('PASS '+name)}
  for(const actor of ['owner','super','admin','ownerB']){
    const response=await api(actor,'auth/login',{method:'POST',body:{email:source.actors[actor].email,password:source.password}})
    assert.equal(response.status,200,JSON.stringify(response.data));cookies[actor]=response.cookie
  }
  await check('D1-REPORT-01 six scoped report routes and direct SQL reconciliation',async()=>{
    const expected=await db.prepare("SELECT COUNT(*) count,SUM(a.amount_due_paise) amount FROM customer_requests r LEFT JOIN request_payment_accounts a ON a.request_id=r.id AND a.location_id=r.location_id AND a.season_id=r.season_id WHERE r.location_id=? AND r.season_id=? AND r.status='closed' AND r.finalization_status='finalized'").bind(source.a,source.season).first()
    for(const type of ['sales-by-date','bills','collections','products','seasons','profit']){
      const r=await api('owner','reports/'+type);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.cache,'no-store');assert.equal(r.data.scope.locationId,source.a)
      if(['bills','sales-by-date','seasons','profit'].includes(type)){assert.equal(r.data.summary.billCount,expected.count);assert.equal(r.data.summary.knownAmountDuePaise,expected.amount??0)}
      if(type==='profit'){assert.ok(r.data.summary.unavailableCostBillCount>0);assert.equal(r.data.summary.profitPaise,null)}
    }
    const totals=await db.prepare("SELECT COUNT(*) count,COALESCE(SUM(amount_paise),0) amount FROM request_payment_ledger WHERE location_id=? AND season_id=? AND entry_type='PAYMENT'").bind(source.a,source.season).first()
    const collections=(await api('owner','reports/collections')).data.summary;assert.equal(collections.paymentCount,totals.count);assert.equal(collections.collectedPaise,totals.amount)
    return {bills:expected.count,knownAmountDuePaise:expected.amount,payments:totals.count,collectedPaise:totals.amount}
  })
  await check('D1-REPORT-02 role projections, aggregate denials and Super Admin access',async()=>{
    for(const type of ['bills','products']){const r=await api('admin','reports/'+type);assert.equal(r.status,200);assert.ok(!/purchaseCostPaise|profitPaise|recordedQuotationTotalPaise|recordedAdjustmentPaise|recordedLineSalesPaise/.test(JSON.stringify(r.data)));if(type==='bills')assert.equal(Object.hasOwn(r.data.summary,'amountDuePaise'),false)}
    for(const type of ['sales-by-date','collections','seasons','profit'])assert.equal((await api('admin','reports/'+type)).status,403)
    assert.equal((await api('super','reports/profit')).status,200)
    assert.equal((await api('owner','reports/profit',{location:source.b})).status,403)
    return {adminOperationalRead:200,adminFinancialAggregates:403,superProfit:200,ownerInAAdminInB:403}
  })
  await check('D1-REPORT-03 cross-stall/season IDs, validation and pagination',async()=>{
    const a=(await api('owner','reports/bills')).data.rows[0].requestId
    assert.equal((await api('ownerB','reports/bills?requestId='+a,{location:source.b})).status,404)
    assert.equal((await api('owner','reports/bills?requestId='+a,{season:source.otherSeason})).status,404)
    assert.equal((await api('owner','reports/bills?from=2026-02-30')).status,400)
    const page=await api('owner','reports/bills?limit=1');assert.equal(page.status,200);assert.equal(page.data.rows.length,1);assert.ok(page.data.pagination.total>1)
    return {foreignRequest:404,foreignSeasonRequest:404,invalidDate:400,pagedTotal:page.data.pagination.total}
  })
}finally{await runtime.dispose();await save('runtime-results.json',results);await save('http-trace.json',trace);await inspect('verify');console.log(JSON.stringify({directory,checks:results.length}))}
