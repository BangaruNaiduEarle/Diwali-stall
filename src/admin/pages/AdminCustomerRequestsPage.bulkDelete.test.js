import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'
import { Browser } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'

test('bulk-delete API adapter posts exact selected IDs through the authenticated client',async()=>{
  const original=globalThis.fetch
  globalThis.fetch=async(url,init)=>{
    assert.equal(new URL(String(url),'http://localhost').pathname,'/api/admin/customer-requests/bulk-delete')
    assert.equal(init.method,'POST');assert.equal(init.credentials,'include')
    assert.deepEqual(JSON.parse(init.body),{requestIds:['selected-one','selected-two']})
    return Response.json({deletedIds:['selected-one'],archivedIds:['selected-one'],failed:[{id:'selected-two',message:'Protected request'}],deletedCount:1,failedCount:1})
  }
  try{
    const {bulkDeleteAdminCustomerRequests}=await import('../api/adminApi.js')
    const result=await bulkDeleteAdminCustomerRequests(['selected-one','selected-two'])
    assert.equal(result.ok,true);assert.deepEqual(result.deletedIds,['selected-one']);assert.equal(result.failed[0].id,'selected-two')
  }finally{globalThis.fetch=original}
})

test('request list removes bulk controls while preserving Open, filters, refresh and pagination', async t => {
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
    import Page from './src/admin/pages/AdminCustomerRequestsPage.jsx';
    window.calls=[];window.pending=[];
    window.session={role:'owner',permissionRole:'owner',activeSeasonId:'season-a',contextKey:'stall-a',email:'owner@test.com',locationModeEnabled:true,capabilities:{write:true},seasonStatus:'active'};
    window.api=(name,args)=>{window.calls.push({name,args});return new Promise(resolve=>window.pending.push(resolve))};
    const root=createRoot(document.getElementById('root'));let tick=0;window.render=()=>root.render(React.createElement(MemoryRouter,null,React.createElement(Page,{tick:++tick})));window.render();
  `},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'controlled-bulk-boundaries',setup(b){
    b.onResolve({filter:/(?:adminApi\.js|AdminSessionContext\.jsx)$/},args=>({path:args.path,namespace:'controlled'}))
    b.onResolve({filter:/AdminCustomerRequest(?:Card|ListAudit|WorkflowAudit)\.jsx$/},args=>({path:args.path,namespace:'controlled'}))
    b.onLoad({filter:/.*/,namespace:'controlled'},({path:p})=>({loader:'js',contents:p.endsWith('adminApi.js')?
      `export const fetchAdminCustomerRequests=(opts)=>window.api('list',opts);export const bulkDeleteAdminCustomerRequests=(ids)=>window.api('delete',ids)`:
      p.endsWith('AdminSessionContext.jsx')?'export const useAdminSession=()=>window.session':'export default function Boundary(){return null}'}))
  }}]})
  const portServer=createServer()
  await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve))
  const port=portServer.address().port
  await new Promise(resolve=>portServer.close(resolve))
  const browser=new Browser('bulk-delete',await mkdtemp(path.join(tmpdir(),'diwali-list-bulk-')),port,[])
  browser.intercept=p=>browser.call('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})
  const response=(ids,page=1,total=ids.length,totalPages=Math.ceil(total/10))=>({ok:true,requests:ids.map(id=>({id,publicReference:id,customerName:id,status:'received',createdAt:'2026-11-05',itemCount:1})),pagination:{page,limit:10,total,totalPages}})
  const resolve=(index,value)=>browser.eval(`window.pending[${index}](${JSON.stringify(value)})`)
  const click=label=>browser.eval(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`)
  const last=async name=>browser.eval(`window.calls.findLastIndex(c=>c.name==='${name}')`)
  try {
    await browser.launch();await browser.eval("document.body.innerHTML='<div id=\"root\"></div>'");await browser.eval(bundle.outputFiles[0].text)
    await browser.wait('window.calls.length===1');await resolve(0,response(['a','b'],1,11,2))
    await browser.wait('document.body.textContent.includes("Page 1 of 2")')
    const assertNoBulk = async () => {
      assert.equal(await browser.eval('Boolean(document.querySelector("[aria-label^=\\"Select\\"]"))'),false)
      assert.equal(await browser.eval('Boolean(document.querySelector("[role=alertdialog]"))'),false)
      assert.equal(await browser.eval('document.body.textContent.includes("Delete Selected") || document.body.textContent.includes("Select All") || /[0-9]+ selected/.test(document.body.textContent)'),false)
      assert.equal(await browser.eval('window.calls.some(c=>c.name==="delete")'),false)
    }
    await assertNoBulk()
    assert.deepEqual(await browser.eval('Array.from(document.querySelectorAll("a")).map(a=>a.getAttribute("href"))'),['/admin/customer-requests/a','/admin/customer-requests/b'])
    // Assigned-to-me is a filter checkbox and must remain.
    assert.equal(await browser.eval('document.querySelectorAll("input[type=checkbox]").length'),1)
    await browser.eval('document.querySelector("[aria-label=\\"Filter by status\\"]").value="received";document.querySelector("[aria-label=\\"Filter by status\\"]").dispatchEvent(new Event("change",{bubbles:true}))')
    await browser.wait('window.calls.at(-1).args.status==="received"')
    await resolve(await last('list'),response(['a','b'],1,11,2))
    await browser.wait('document.body.textContent.includes("Page 1 of 2")')
    await click('Next');await browser.wait('window.calls.at(-1).args.page===2')
    assert.equal(await browser.eval('window.calls.at(-1).args.status'), 'received')
    await resolve(await last('list'),response(['last'],2,11,2))
    await browser.wait('document.body.textContent.includes("Page 2 of 2")')
    await assertNoBulk()
    await click('Previous');await browser.wait('window.calls.at(-1).args.page===1')
    await resolve(await last('list'),response(['a','b'],1,11,2))
    await browser.wait('document.body.textContent.includes("Page 1 of 2")')
    const count = await browser.eval('window.calls.length')
    await click('Refresh');await browser.wait(`window.calls.length>${count}`)
    await resolve(await last('list'),response(['a','b'],1,11,2))
    await browser.wait('document.body.textContent.includes("Page 1 of 2")')
    await assertNoBulk()
  } finally {await browser.close()}
})
