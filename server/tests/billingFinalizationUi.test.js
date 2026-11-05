import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import WebSocket from '../node_modules/ws/wrapper.mjs'
import {build} from '../node_modules/esbuild/lib/main.js'
import {Browser} from '../scripts/offline-qr-pack-browser-client.mjs'
import {workflowDb} from './helpers/workflowSqlite.js'
import {attachAdminRequestContext} from '../src/middleware/requireAdmin.js'
import {handleAdminOfflineRoutes} from '../src/routes/adminOfflineSync.js'

test('Users Billing Finalization is separate; Super Admin grant drives real signed online edits, lost-reply retry, closure and revocation', {timeout:90000},async t=>{
  const db=await workflowDb(t)
  for(const file of ['0023_offline_sync_receipts.sql','0024_qr_handover.sql','0028_offline_final_price_grants.sql','0029_billing_finalization_permissions.sql'])await db.script(readFileSync(new URL('../database/migrations/'+file,import.meta.url),'utf8'))
  const root=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const env={DB:db,HANDOVER_SIGNING_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',root.privateKey))}
  async function api(path,body,actor='admin'){
    const req=new Request('http://localhost/api/admin/offline/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Admin-Location-Id':'loc-a','X-Admin-Season-Id':'season-2026'},...(body?{body:JSON.stringify(body)}:{})})
    const identity={userId:actor,email:actor+'@test.com'}
    const access=await attachAdminRequestContext(req,db,identity,{ADMIN_LOCATION_MODE:true})
    assert.equal(access.ok,true)
    return handleAdminOfflineRoutes(req,env,identity)
  }
  const scope={businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId:'admin',deviceId:'seed-device'},deviceToken='ab'.repeat(32)
  assert.equal((await api('devices',{deviceId:scope.deviceId,deviceToken})).status,200)
  const catalogue=await (await api('catalogue')).json()
  const created=await (await api('sync',{operationId:crypto.randomUUID(),kind:'CREATE',scope,deviceToken,occurredAt:new Date().toISOString(),catalogue:catalogue.products,body:{customer:{name:'Online signed Admin',mobile:'9876543210'},items:[{productId:'P001',quantity:1}],pricingMode:'selling'}})).json()
  assert.equal(created.ok,true)
  const sessionSource=`const role=()=>window.actor==='super'?'super_admin':window.actor;const session=()=>({ok:true,status:'authenticated',userId:window.actor,email:window.actor+'@test.com',effectiveRole:role(),permissionRole:role(),role:role(),activeBusinessId:'shop',activeLocationId:'loc-a',activeSeasonId:'season-2026',contextKey:'shop:loc-a:'+window.actor,seasonStatus:'active',locationModeEnabled:true,location:{name:'A'},capabilities:{write:true},refreshSession:async()=>({ok:true})});`
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Users from './src/admin/pages/AdminUsersPage.jsx';import Bill from './src/admin/components/SignedBillFinalization.jsx';const root=createRoot(document.getElementById('root'));window.actor='super';window.showUsers=actor=>{window.actor=actor;root.render(<MemoryRouter><Users key={actor}/></MemoryRouter>)};window.showBill=()=>{window.actor='admin';root.render(<MemoryRouter><Bill requestId=${JSON.stringify(created.requestId)} onAcknowledged={()=>{window.acknowledged=(window.acknowledged||0)+1}}/></MemoryRouter>)};window.showUsers('super');`},bundle:true,write:false,outfile:'billing-ui.js',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'session-and-transport-only',setup(b){
    b.onResolve({filter:/AdminSessionContext\.jsx$/},()=>({path:'session',namespace:'fixture'}))
    b.onResolve({filter:/useAdminSeasonReadOnly\.js$/},()=>({path:'readOnly',namespace:'fixture'}))
    b.onResolve({filter:/api\/adminApi\.js$/},()=>({path:'adminApi',namespace:'fixture'}))
    b.onResolve({filter:/api\/adminOffline\.js$/},()=>({path:'offlineApi',namespace:'fixture'}))
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>{
      if(path==='session')return {contents:sessionSource+'export const useAdminSession=session;'}
      if(path==='readOnly')return {contents:'export const useAdminSeasonReadOnly=()=>({isReadOnly:false});'}
      if(path==='adminApi')return {contents:sessionSource+`export const fetchAdminSession=async()=>session();export const fetchAdminUsers=async()=>({ok:true,users:[{id:'admin',email:'admin@test.com',role:'admin',effectiveRole:'admin',disabled:false,canViewFinalRate:false}]});`+['createAdminUser','disableAdminUser','enableAdminUser','resetAdminUserPassword','removeAdminLocationMember','updateAdminUserRole','updateAdminFinalRateAccess'].map(name=>`export const ${name}=async()=>{throw Error('Unrelated action must not be called')};`).join('')}
      return {contents:`const call=async(path,body)=>{const r=await fetch('/api/admin/offline/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Test-Actor':window.actor},...(body?{body:JSON.stringify(body)}:{})});return {...await r.json(),ok:r.ok,status:r.status}};export const registerOfflineDevice=d=>call('devices',{deviceId:d.deviceId,deviceToken:d.deviceToken});export const fetchOfflineCatalogue=()=>call('catalogue');export const prepareOfflineAuthorization=b=>call('grants/prepare',b);export const fetchOfflineRequest=id=>call('requests/'+id);export const sendOfflineOperation=b=>call('sync',b);export const fetchBillingPermissions=()=>call('billing-permissions');export const setBillingPermission=b=>call('billing-permissions',b);`}
    })
  }}]})
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve))
  globalThis.WebSocket??=WebSocket
  const trace=[],origin='http://127.0.0.1:5197',browser=new Browser('signed-billing-ui',await mkdtemp(join(tmpdir(),'diwali-signed-billing-')),port,trace)
  let lostReply=false
  browser.intercept=async event=>{
    const url=new URL(event.request.url)
    if(url.origin!==origin)return browser.call('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'})
    let response
    if(url.pathname==='/billing-ui.js')response=new Response(bundle.outputFiles[0].text,{headers:{'Content-Type':'application/javascript'}})
    else if(url.pathname.startsWith('/api/admin/offline/')){
      const body=event.request.postData?JSON.parse(event.request.postData):null
      const actor=Object.entries(event.request.headers).find(([name])=>name.toLowerCase()==='x-test-actor')?.[1]??'admin'
      response=await api(url.pathname.slice('/api/admin/offline/'.length),body,actor)
      if(body?.kind==='AGREEMENT'&&!lostReply&&response.ok){lostReply=true;response=Response.json({message:'Simulated lost acknowledgement'},{status:503})}
    }else response=new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/billing-ui.js"></script></body></html>',{headers:{'Content-Type':'text/html'}})
    await browser.call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:response.status,responseHeaders:[...response.headers].map(([name,value])=>({name,value})),body:Buffer.from(await response.text()).toString('base64')})
  }
  try{
    await browser.launch();await browser.call('Page.navigate',{url:origin})
    await browser.wait("Boolean(document.querySelector('input[aria-label=\"Billing Finalization for admin@test.com\"]'))&&!document.querySelector('input[aria-label=\"Billing Finalization for admin@test.com\"]').disabled")
    assert.equal(await browser.eval("document.querySelector('input[aria-label=\"Billing Finalization for admin@test.com\"]').checked"),false)
    await browser.eval("document.querySelector('input[aria-label=\"Billing Finalization for admin@test.com\"]').click()")
    await browser.wait("document.body.textContent.includes('Billing Finalization enabled')")
    assert.equal(await browser.eval("document.querySelector('input[aria-label=\"Final Rate for admin@test.com\"]').checked"),false)
    await browser.eval('window.showBill()');await browser.click('Prepare signed billing')
    await browser.wait("document.body.textContent.includes('Selected items Final Price sum: ₹80.00')")
    assert.equal(await browser.eval("document.body.textContent.includes('Grantor: super')"),true)
    await browser.field('Customer-agreed final amount','10.00');await browser.click('Save agreed amount')
    await browser.wait("document.body.textContent.includes('Simulated lost acknowledgement')")
    await browser.eval('new Promise(resolve=>setTimeout(resolve,1200))')
    await browser.click('Retry signed synchronization');await browser.wait('window.acknowledged===1')
    await browser.field('Customer-agreed final amount','1.00');await browser.click('Save agreed amount');await browser.wait('window.acknowledged===2')
    await browser.click('Finalize bill');await browser.click('Confirm finalization');await browser.wait('window.acknowledged===3')
    assert.equal(await browser.eval("document.body.textContent.includes('Bill finalized; amounts and items are locked.')"),true)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM offline_final_price_uses WHERE request_id=?').bind(created.requestId).first()).n,3)
    assert.equal((await db.prepare("SELECT closed_by_email FROM customer_requests WHERE id=?").bind(created.requestId).first()).closed_by_email,'admin@test.com')
    await browser.eval("window.showUsers('super')");await browser.wait("Boolean(document.querySelector('input[aria-label=\"Billing Finalization for admin@test.com\"]')?.checked)")
    await browser.eval("document.querySelector('input[aria-label=\"Billing Finalization for admin@test.com\"]').click()")
    await browser.wait("document.body.textContent.includes('Billing Finalization revoked')")
    const permission=await db.prepare('SELECT grantor_user_id,revoked_by FROM billing_finalization_permissions').bind().first()
    assert.equal(permission.grantor_user_id,'super');assert.equal(permission.revoked_by,'super')
    await browser.eval('window.showBill()');await browser.click('Prepare signed billing')
    await browser.wait("document.body.textContent.includes('No signed Billing Finalization authorization is available')")
    assert.equal(await browser.eval("document.body.textContent.includes('Selected items Final Price sum')"),false)
    const profiles=await browser.snapshot()
    assert.ok(profiles.profiles.every(row=>!row.authorization))
    assert.equal(trace.filter(row=>row.interceptionError).length,0,JSON.stringify(trace))
  }finally{await browser.close()}
})
