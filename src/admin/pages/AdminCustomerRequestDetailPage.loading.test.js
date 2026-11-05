import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'
import { Browser, delay } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'

// Actual detail page, adjustment editor and payments component. API calls are
// controlled promises; all browser network requests are blocked.
test('Request Detail independent loading and deferred work', async t => {
  const sources = await Promise.all([
    readFile(new URL('./AdminCustomerRequestDetailPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/AdminCustomerRequestAdjustBillPanel.jsx', import.meta.url), 'utf8'),
  ])
  const names = [...new Set(sources.flatMap(source => source.match(/import\s*{([^}]+)}\s*from '\.\.\/api\/adminApi\.js'/)[1].split(',').map(name => name.trim()).filter(Boolean)))]
  const summary = { eligible: true, amountDuePaise: 10000, receivedPaise: 0, outstandingPaise: 10000, paymentStatus: 'UNPAID', revision: 7 }
  const request = { id: 'request-a', customerName: 'Early customer', publicReference: 'DWL-DETAIL', revision: 7,
    status: 'received', source: 'web', finalizationStatus: 'pending', createdAt: '2026-11-05', paymentSummary: summary,
    items: [{ lineId: 'line-a', lineNumber: 1, productId: 'P001', productName: 'Test product', quantity: 1, unitPricePaise: 10000 }] }
  const quotation = { id: 'quote-a', requestRevision: 7, totalPaise: 10000, subtotalPaise: 10000,
    acceptedAmountPaise: 10000, internalFinancialSummary: { basis: 'current_purchase_estimate', purchaseSubtotalPaise: 5000 },
    items: [{ lineNumber: 1, productId: 'P001', productName: 'Test product', quantity: 1, unitRatePaise: 10000, lineTotalPaise: 10000 }] }
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Page from './src/admin/pages/AdminCustomerRequestDetailPage.jsx';
    window.calls=[];window.pending=[];window.requestId='request-a';
    window.session={role:'owner',permissionRole:'owner',activeSeasonId:'season-a',contextKey:'stall-a',locationModeEnabled:true,email:'owner@test.com'};
    window.api=(name,args)=>{window.calls.push({name,args});return new Promise(resolve=>window.pending.push(resolve))};
    const root=createRoot(document.getElementById('root'));let tick=0;window.mount=()=>root.render(React.createElement(Page,{tick:++tick}));window.mount();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'controlled-detail-loading', setup(b) {
    b.onResolve({ filter: /(?:adminApi\.js|adminPayments\.js|AdminSessionContext\.jsx|useAdminSeasonReadOnly\.js|quickBillAssignees\.js|react-router-dom)$/ }, args => ({ path: args.path, namespace: 'controlled' }))
    b.onResolve({ filter: /components\/(?:AdminCustomerRequestQuotationLineCard|QuickBillAssigneeSelect|RequestPaymentPreferences|SignedBillFinalization|AdminConfirmDialog)\.jsx$/ }, args => ({ path: args.path, namespace: 'controlled' }))
    b.onLoad({ filter: /.*/, namespace: 'controlled' }, ({ path: p }) => ({ loader: 'js', contents:
      p.endsWith('adminApi.js') ? names.map(name => `export const ${name}=(...args)=>window.api('${name}',args)`).join('\n') :
      p.endsWith('adminPayments.js') ? `export const fetchRequestPayments=(...args)=>window.api('fetchRequestPayments',args);export const recordRequestPayment=(...args)=>window.api('recordRequestPayment',args)` :
      p.endsWith('AdminSessionContext.jsx') ? 'export const useAdminSession=()=>window.session' :
      p.endsWith('useAdminSeasonReadOnly.js') ? 'export const useAdminSeasonReadOnly=()=>({isReadOnly:false})' :
      p.endsWith('quickBillAssignees.js') ? 'export const useQuickBillAssignees=()=>({users:[],loading:false,error:null})' :
      p === 'react-router-dom' ? 'export const useParams=()=>({id:window.requestId});export const Link=({children})=>children' :
      'export default function Boundary(){return null}',
    }))
  } }], })
  const portServer = createServer()
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
  const port = portServer.address().port
  await new Promise(resolve => portServer.close(resolve))
  const profile = await mkdtemp(path.join(tmpdir(), 'diwali-detail-loading-'))
  const browser = new Browser('detail-loading', profile, port, [])
  browser.intercept = p => browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
  const calls = () => browser.eval('window.calls')
  const resolve = (index, value) => browser.eval(`window.pending[${index}](${JSON.stringify(value)})`)
  const click = label => browser.eval(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`)
  const indexOf = async name => (await calls()).findLastIndex(call => call.name === name)
  const input = (selector, value) => browser.eval(`{
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }`)
  try {
    await browser.launch()
    await browser.eval("document.body.innerHTML='<div id=\"root\"></div>'")
    await browser.eval(bundle.outputFiles[0].text)
    await t.test('starts both GETs before either resolves and renders detail while quotation waits', async () => {
      await browser.wait('window.calls.length===2')
      const initial = await calls()
      assert.deepEqual(initial.map(call => call.name).sort(), ['fetchAdminCustomerRequest', 'fetchQuotationForRequest'])
      await resolve(await indexOf('fetchAdminCustomerRequest'), { ok: true, request })
      await browser.wait('document.body.textContent.includes("Early customer")')
      assert.equal(await browser.eval('document.body.textContent.includes("Loading quotation")'), true)
      assert.equal(await browser.eval('document.body.textContent.includes("Create quotation")'), false)
      assert.equal(await browser.eval('document.querySelector("select").disabled'), true)
      assert.equal(await browser.eval('Boolean(document.querySelector("[aria-label=\\"Payment summary\\"]"))'), true)
      await delay(400)
      assert.equal((await calls()).length, 2)
      await resolve(await indexOf('fetchQuotationForRequest'), { ok: true, data: { quotation } })
      await browser.wait('Boolean(document.querySelector(".admin-request-detail__adjust-bill"))')
      assert.equal(await browser.eval('document.querySelector("select").disabled'), false)
      assert.equal(await browser.eval(`document.querySelector('[aria-label$="purchase price"]').closest('section').querySelectorAll('dd').length`), 1)
      assert.equal(await browser.eval('document.body.textContent.includes("Profit estimate after discount")'), false)
    })

    await t.test('does not preview until editing opens, then previews changed quantities', async () => {
      await delay(400)
      assert.equal((await calls()).filter(call => call.name === 'previewAdminCustomerRequestAdjustBill').length, 0)
      await browser.eval('document.querySelector(".admin-request-detail__adjust-bill summary").click()')
      await browser.wait('window.calls.some(c=>c.name==="previewAdminCustomerRequestAdjustBill")')
      await resolve(await indexOf('previewAdminCustomerRequestAdjustBill'), { ok: true, preview: { totalPaise: 10000 } })
      await browser.wait('!document.querySelector("[aria-label=\\"Increase Box\\"]").disabled')
      await browser.eval('document.querySelector("[aria-label=\\"Increase Box\\"]").click()')
      await browser.wait('window.calls.filter(c=>c.name==="previewAdminCustomerRequestAdjustBill").length===2')
      const call = (await calls())[await indexOf('previewAdminCustomerRequestAdjustBill')]
      assert.equal(call.args[1].items[0].quantity, 2)
      assert.equal(call.args[2].revision, 7)
      await resolve(await indexOf('previewAdminCustomerRequestAdjustBill'), { ok: true, preview: { totalPaise: 20000 } })
    })

    await t.test('defers ledger, preserves recording revision, and loads history once on expansion', async () => {
      assert.equal((await calls()).filter(call => call.name === 'fetchRequestPayments').length, 0)
      await input('form input[inputmode="decimal"]', '10.00')
      await browser.eval('document.querySelector("form").requestSubmit()')
      await browser.wait('window.calls.some(c=>c.name==="recordRequestPayment")')
      const recorded = (await calls())[await indexOf('recordRequestPayment')]
      assert.equal(recorded.args[2].revision, 7)
      assert.equal(recorded.args[1].amountPaise, 1000)
      await resolve(await indexOf('recordRequestPayment'), { ok: true, summary: { ...summary, revision: 8, receivedPaise: 1000, outstandingPaise: 9000 },
        entry: { paymentId: 'new-payment', sequence: 51 } })
      await browser.wait('document.body.textContent.includes("Payment ledger updated.")')
      assert.equal((await calls()).filter(call => call.name === 'fetchAdminCustomerRequest').length, 1)
      assert.equal((await calls()).filter(call => call.name === 'fetchQuotationForRequest').length, 1)
      await input('form input[inputmode="decimal"]', '5.00')
      await browser.eval('document.querySelector("form").requestSubmit()')
      await browser.wait('window.calls.filter(c=>c.name==="recordRequestPayment").length===2')
      assert.equal((await calls())[await indexOf('recordRequestPayment')].args[2].revision, 8)
      await resolve(await indexOf('recordRequestPayment'), { ok: true, summary: { ...summary, revision: 9, receivedPaise: 1500, outstandingPaise: 8500 },
        entry: { paymentId: 'second-payment', sequence: 52 } })
      await browser.wait('document.body.textContent.includes("second-payment")')
      await click('Show payment history')
      await browser.wait('window.calls.some(c=>c.name==="fetchRequestPayments")')
      const entries = Array.from({ length: 50 }, (_, i) => ({ sequence: i + 1, paymentId: 'payment-' + i, entryType: 'PAYMENT', amountPaise: 100, paymentMethod: 'CASH' }))
      await resolve(await indexOf('fetchRequestPayments'), { ok: true, summary: { ...summary, revision: 8 }, entries })
      await browser.wait('document.body.textContent.includes("payment-49")')
      await click('Hide payment history'); await click('Show payment history')
      await delay(100)
      assert.equal((await calls()).filter(call => call.name === 'fetchRequestPayments').length, 1)
      await click('Load more payment history')
      await browser.wait('window.calls.filter(c=>c.name==="fetchRequestPayments").length===2')
      assert.equal((await calls())[await indexOf('fetchRequestPayments')].args[1].afterSequence, 50)
      await resolve(await indexOf('fetchRequestPayments'), { ok: true, summary: { ...summary, revision: 8 }, entries: [{ ...entries[49] }, { sequence: 51, paymentId: 'new-payment', entryType: 'PAYMENT', amountPaise: 1000, paymentMethod: 'CASH' }] })
      await browser.wait('document.body.textContent.includes("new-payment")')
      assert.equal(await browser.eval('document.querySelectorAll("ol li").length'), 51)
    })

    await t.test('history errors keep payment controls blocked and explicit retries do not duplicate GETs', async () => {
      const before = (await calls()).filter(call => call.name === 'fetchRequestPayments').length
      await click('Refresh payments')
      await browser.wait(`window.calls.filter(c=>c.name==='fetchRequestPayments').length===${before + 1}`)
      await resolve(await indexOf('fetchRequestPayments'), { ok: false, message: 'History unavailable' })
      await browser.wait('document.body.textContent.includes("History unavailable")')
      assert.equal(await browser.eval('document.querySelector("form fieldset").disabled'), true)
      await click('Refresh payments')
      await browser.wait(`window.calls.filter(c=>c.name==='fetchRequestPayments').length===${before + 2}`)
      await resolve(await indexOf('fetchRequestPayments'), { ok: true, summary: { ...summary, eligible: false }, entries: [] })
      await browser.wait('document.body.textContent.includes("No payment entries recorded")')
      assert.equal(await browser.eval('Boolean(document.querySelector("form"))'), false)
      assert.equal((await calls()).filter(call => call.name === 'fetchRequestPayments').length, before + 2)
    })

    await t.test('ignores obsolete responses after navigation and preserves missing-quotation behavior', async () => {
      await browser.eval("window.requestId='request-b';window.mount()")
      await browser.wait('window.calls.at(-1)?.args[0]==="request-b"')
      const oldQuote = await indexOf('fetchQuotationForRequest'), oldDetail = await indexOf('fetchAdminCustomerRequest')
      await browser.eval("window.requestId='request-c';window.mount()")
      await browser.wait('window.calls.at(-1)?.args[0]==="request-c"')
      await resolve(await indexOf('fetchAdminCustomerRequest'), { ok: true, request: { ...request, id: 'request-c', customerName: 'Current customer' } })
      await resolve(await indexOf('fetchQuotationForRequest'), { ok: false, status: 404, message: 'No quotation' })
      await browser.wait('document.body.textContent.includes("Create quotation")')
      await resolve(oldDetail, { ok: true, request: { ...request, customerName: 'Obsolete customer' } })
      await resolve(oldQuote, { ok: true, data: { quotation } })
      await delay(100)
      assert.equal(await browser.eval('document.body.textContent.includes("Current customer")'), true)
      assert.equal(await browser.eval('document.body.textContent.includes("Obsolete customer")'), false)
      assert.equal(await browser.eval('document.body.textContent.includes("Create quotation")'), true)
    })

    await t.test('keeps detail errors visible even when quotation succeeds independently', async () => {
      await browser.eval("window.requestId='request-denied';window.mount()")
      await browser.wait('window.calls.at(-1)?.args[0]==="request-denied"')
      await resolve(await indexOf('fetchQuotationForRequest'), { ok: true, data: { quotation } })
      await resolve(await indexOf('fetchAdminCustomerRequest'), { ok: false, message: 'Request access denied' })
      await browser.wait('document.body.textContent.includes("Request access denied")')
      assert.equal(await browser.eval('Boolean(document.querySelector("form"))'), false)
    })
  } finally { await browser.close() }
})
