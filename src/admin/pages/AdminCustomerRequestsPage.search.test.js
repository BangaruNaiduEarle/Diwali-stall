import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'
import { Browser, delay } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'

// Actual page and React hooks in a fresh Chrome profile. No backend, stored data,
// environment files, application server or network API is used.
test('Request Search browser behavior with controlled API responses', async t => {
  const profile = await mkdtemp(path.join(tmpdir(), 'diwali-request-search-'))
  const portServer = createServer()
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
  const port = portServer.address().port
  await new Promise(resolve => portServer.close(resolve))
  const browser = new Browser('request-search', profile, port, [])
  browser.intercept = async p => browser.call('Fetch.failRequest', {
    requestId: p.requestId, errorReason: 'BlockedByClient',
  })
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {MemoryRouter} from 'react-router-dom';
        import Page from './src/admin/pages/AdminCustomerRequestsPage.jsx';
        window.calls=[]; window.pending=[];
        createRoot(document.getElementById('root')).render(
          React.createElement(MemoryRouter,null,React.createElement(Page)));`,
      resolveDir: process.cwd(), loader: 'jsx',
    },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'controlled-search-boundaries', setup(b) {
      b.onResolve({ filter: /(?:adminApi\.js|AdminSessionContext\.jsx)$/ }, args => ({ path: args.path, namespace: 'search-test' }))
      b.onResolve({ filter: /AdminCustomerRequest(?:Card|ListAudit|WorkflowAudit)\.jsx$/ }, args => ({ path: args.path, namespace: 'search-test' }))
      b.onLoad({ filter: /.*/, namespace: 'search-test' }, args => ({
        contents: args.path.endsWith('adminApi.js')
          ? `export function fetchAdminCustomerRequests(opts){window.calls.push({...opts,at:performance.now()});return new Promise(resolve=>window.pending.push(resolve))}`
          : args.path.endsWith('AdminSessionContext.jsx')
            ? `export const useAdminSession=()=>({role:'owner',permissionRole:'owner',activeSeasonId:'test-season',email:'owner@test.com'})`
            : `export default function Boundary(){return null}`,
        loader: 'js',
      }))
    } }],
  })
  const response = (name, total = 1, page = 1, totalPages = 1) => ({
    ok: true,
    requests: total ? [{ id: name, publicReference: 'DWL-TKTSWMFM', customerName: name, status: 'received', createdAt: '2026-11-04' }] : [],
    pagination: { page, limit: 20, total, totalPages },
  })
  const resolve = (index, value) => browser.eval(`window.pending[${index}](${JSON.stringify(value)})`)
  const input = value => browser.eval(`{
    const input=document.querySelector('input[type="search"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }`)
  const calls = () => browser.eval('window.calls')
  const click = text => browser.eval(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`)
  try {
    await browser.launch()
    await browser.eval(`document.body.innerHTML='<div id="root"></div>'`)
    await browser.eval(bundle.outputFiles[0].text)
    await browser.wait('window.calls?.length===1')
    assert.equal((await calls())[0].limit, 20)
    await resolve(0, response('Initial', 60, 1, 3))
    await browser.wait('document.body.textContent.includes("Initial")')

    await t.test('debounces partial Reference ID input and resets pagination', async () => {
      await click('Next')
      await browser.wait('window.calls.length===2')
      assert.equal((await calls())[1].page, 2)
      await resolve(1, response('Second page', 60, 2, 3))
      await browser.wait('document.body.textContent.includes("Second page")')
      await input('DWL-')
      await delay(100)
      await input('  DWL-TKTS  ')
      await delay(100)
      assert.equal((await calls()).length, 2)
      await browser.wait('window.calls.length===3')
      const call = (await calls())[2]
      assert.equal(call.q, 'DWL-TKTS')
      assert.equal(call.page, 1)
      await resolve(2, response('Reference match', 60, 1, 3))
      await browser.wait('document.body.textContent.includes("Reference match")')
      await click('Next')
      await browser.wait('window.calls.length===4')
      assert.equal((await calls())[3].q, 'DWL-TKTS')
      assert.equal((await calls())[3].page, 2)
      assert.equal((await calls())[3].limit, 20)
      await resolve(3, response('Reference page 2', 60, 2, 3))
      await browser.wait('document.body.textContent.includes("Reference page 2")')
    })

    await t.test('clear preserves filters, returns to page one and keeps the original empty state', async () => {
      await browser.eval(`document.querySelector('[aria-label="Clear search"]').click()`)
      await browser.wait('window.calls.length===5')
      assert.equal((await calls())[4].page, 1)
      assert.equal((await calls())[4].q, undefined)
      assert.equal(await browser.eval(`document.querySelector('input[type="search"]').value`), '')
      await resolve(4, response('Cleared'))
      await browser.wait('document.body.textContent.includes("Cleared")')
      await browser.eval(`{
        const select=document.querySelector('[aria-label="Filter by status"]');
        select.value='received';select.dispatchEvent(new Event('change',{bubbles:true}));
      }`)
      await browser.wait('window.calls.length===6')
      await resolve(5, response('Filtered'))
      await browser.wait('document.body.textContent.includes("Filtered")')
      await input('missing')
      await browser.wait('window.calls.length===7')
      assert.equal((await calls())[6].status, 'received')
      await resolve(6, response('', 0))
      await browser.wait('document.body.textContent.includes("No customer requests found.")')
      await click('Clear search')
      await browser.wait('window.calls.length===8')
      assert.equal((await calls())[7].status, 'received')
      assert.equal((await calls())[7].q, undefined)
      await resolve(7, response('', 0))
      await browser.wait('document.body.textContent.includes("No requests match this filter.")')
    })

    await t.test('late successful and failed responses cannot replace newer search results', async () => {
      await input('old')
      await browser.wait('window.calls.length===9')
      await input('new')
      await browser.wait('window.calls.length===10')
      await resolve(9, response('Latest result'))
      await browser.wait('document.body.textContent.includes("Latest result")')
      await resolve(8, response('Obsolete result'))
      await delay(100)
      assert.equal(await browser.eval('document.body.textContent.includes("Obsolete result")'), false)
      await input('old-failure')
      await browser.wait('window.calls.length===11')
      await input('new-success')
      await browser.wait('window.calls.length===12')
      await resolve(11, response('Newest success'))
      await browser.wait('document.body.textContent.includes("Newest success")')
      await resolve(10, { ok: false, message: 'Obsolete error' })
      await delay(100)
      assert.equal(await browser.eval('document.body.textContent.includes("Obsolete error")'), false)
      assert.equal(await browser.eval('document.body.textContent.includes("Newest success")'), true)
    })

    await t.test('clearing during an outstanding search ignores its late response', async () => {
      await input('pending-search')
      await browser.wait('window.calls.length===13')
      await browser.eval(`document.querySelector('[aria-label="Clear search"]').click()`)
      await browser.wait('window.calls.length===14')
      assert.equal((await calls())[13].q, undefined)
      assert.equal((await calls())[13].status, 'received')
      await resolve(13, response('Cleared current results'))
      await browser.wait('document.body.textContent.includes("Cleared current results")')
      await resolve(12, response('Late pre-clear result'))
      await delay(100)
      assert.equal(await browser.eval('document.body.textContent.includes("Late pre-clear result")'), false)
      assert.equal(await browser.eval('document.body.textContent.includes("Cleared current results")'), true)
    })
    await t.test('Previous/Next keep every filter and enforce page boundaries at 20 rows', async () => {
      await browser.eval(`{
        const select=document.querySelector('[aria-label="Filter by finalization status"]');
        select.value='pending';select.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('input[type="checkbox"]').click();
      }`)
      await input('reference')
      await browser.wait("window.calls.at(-1)?.q==='reference'")
      let index=(await calls()).length-1
      await resolve(index,response('All filters',40,1,2))
      await browser.wait('document.body.textContent.includes("All filters")')
      assert.equal(await browser.eval("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Previous').disabled"),true)
      await click('Next')
      await browser.wait(`window.calls.length>${index+1}`)
      index=(await calls()).length-1
      const call=(await calls())[index]
      assert.equal(call.page,2)
      assert.equal(call.limit,20)
      assert.equal(call.status,'received')
      assert.equal(call.q,'reference')
      assert.equal(call.finalizationStatus,'pending')
      assert.equal(call.assignedToMe,true)
      await resolve(index,response('Last filtered page',40,2,2))
      await browser.wait('document.body.textContent.includes("Last filtered page")')
      assert.equal(await browser.eval("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Next').disabled"),true)
      await click('Previous')
      await browser.wait(`window.calls.length>${index+1}`)
      index=(await calls()).length-1
      assert.deepEqual({...((await calls())[index]),at:0},{...call,page:1,at:0})
      await resolve(index,response('First filtered page',40,1,2))
      await browser.wait('document.body.textContent.includes("First filtered page")')
    })
  } finally {
    await browser.close()
  }
})
