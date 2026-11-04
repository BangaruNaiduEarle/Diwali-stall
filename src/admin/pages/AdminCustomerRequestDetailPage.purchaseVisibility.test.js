import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'
import { Browser } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'

test('Request Details purchase visibility uses existing role gate and resets across contexts', async () => {
  const source = await readFile(new URL('./AdminCustomerRequestDetailPage.jsx', import.meta.url), 'utf8')
  const apiNames = source.match(/import\s*{([^}]+)}\s*from '\.\.\/api\/adminApi\.js'/)[1].split(',').map(s => s.trim()).filter(Boolean)
  const fixture = {
    request: { id: 'request-a', status: 'closed', source: 'web', items: [{ lineId: 'line-a', productName: 'Test product' }] },
    quotation: { id: 'quote-a', totalPaise: 20000, items: [],
      internalPricingPreview: { sellingSubtotalPaise: 20000, finalSubtotalPaise: 15000 },
      internalFinancialSummary: { basis: 'finalization_purchase_snapshot', available: true,
        lines: [{ lineId: 'line-a', purchaseUnitPaise: 12345 }], purchaseSubtotalPaise: 24690, profitPaise: -4690 } },
  }
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Page from './src/admin/pages/AdminCustomerRequestDetailPage.jsx';
    window.fixture=${JSON.stringify(fixture)};
    window.session={role:'owner',permissionRole:'owner',activeSeasonId:'season-a',contextKey:'stall-a',email:'owner@test.com'};
    window.requestId='request-a';
    const root=createRoot(document.getElementById('root'));let tick=0;
    window.rerender=()=>root.render(React.createElement(Page,{tick:++tick}));window.rerender();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'controlled-detail-boundaries', setup(b) {
      b.onResolve({ filter: /(?:adminApi\.js|AdminSessionContext\.jsx|useAdminSeasonReadOnly\.js|quickBillAssignees\.js|react-router-dom)$/ }, args => ({ path: args.path, namespace: 'test' }))
      b.onResolve({ filter: /components\/.*\.jsx$/ }, args => ({ path: args.path, namespace: 'test' }))
      b.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: p }) => ({ loader: 'js', contents:
        p.endsWith('adminApi.js') ? apiNames.map(name => `export async function ${name}(){${
          name === 'fetchAdminCustomerRequest' ? 'return {ok:true,request:window.fixture.request}' :
          name === 'fetchQuotationForRequest' ? 'return {ok:true,data:{quotation:window.fixture.quotation}}' :
          'throw Error("Unexpected API mutation")'
        }}`).join('\n') :
        p.endsWith('AdminSessionContext.jsx') ? 'export const useAdminSession=()=>window.session' :
        p.endsWith('useAdminSeasonReadOnly.js') ? 'export const useAdminSeasonReadOnly=()=>({isReadOnly:true})' :
        p.endsWith('quickBillAssignees.js') ? 'export const useQuickBillAssignees=()=>({users:[],loading:false,error:null})' :
        p === 'react-router-dom' ? 'export const useParams=()=>({id:window.requestId}); export const Link=({children})=>children' :
        'export default function Boundary(){return null}',
      }))
    } }],
  })
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const profile = await mkdtemp(path.join(tmpdir(), 'diwali-purchase-visibility-'))
  const browser = new Browser('purchase-visibility', profile, port, [])
  browser.intercept = p => browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
  const shown = `document.querySelector('[aria-label="Hide purchase price"]')`
  const hidden = `document.querySelector('[aria-label="Show purchase price"]')`
  const section = `document.querySelector('[aria-label$="purchase price"]').closest('section')`
  const waitFor = expression => browser.wait(`Boolean(${expression})`)
  const click = async () => { await browser.eval(`document.querySelector('[aria-label$="purchase price"]').click()`) }
  const hide = async () => { await click(); await waitFor(hidden) }
  try {
    await browser.launch()
    await browser.eval(`document.body.innerHTML='<div id="root"></div>'`)
    await browser.eval(result.outputFiles[0].text)
    await waitFor(shown)
    const originalAmounts = await browser.eval(`Array.from(${section}.querySelectorAll('dd'),e=>e.textContent)`)
    assert.equal(originalAmounts.length, 3)
    assert.match(originalAmounts[0], /123/)
    assert.match(originalAmounts[1], /247/)
    assert.equal(await browser.eval(`${shown}.querySelector('svg').classList.contains('lucide-eye')`), true)
    const outside = await browser.eval(`Array.from(document.querySelector('#root').children[0].children).filter(e=>e!==${section}).map(e=>e.textContent).join('|')`)
    await hide()
    assert.deepEqual(await browser.eval(`Array.from(${section}.querySelectorAll('dd'),e=>e.textContent)`), ['••••', '••••', originalAmounts[2]])
    assert.equal(await browser.eval(`${hidden}.getAttribute('aria-pressed')`), 'false')
    assert.equal(await browser.eval(`${hidden}.querySelector('svg').classList.contains('lucide-eye-off')`), true)
    assert.equal(await browser.eval(`Array.from(document.querySelector('#root').children[0].children).filter(e=>e!==${section}).map(e=>e.textContent).join('|')`), outside)
    await click(); await waitFor(shown)
    assert.deepEqual(await browser.eval(`Array.from(${section}.querySelectorAll('dd'),e=>e.textContent)`), originalAmounts)

    // Keep the page mounted: each identity change must reset its local preference.
    for (const change of [
      `window.session.contextKey='stall-b'`,
      `window.requestId='request-b'`,
      `window.session.email='another-owner@test.com'`,
      `window.session.activeSeasonId='season-b'`,
      `window.session.permissionRole='super_admin'`,
    ]) {
      await hide()
      await browser.eval(`${change};window.rerender()`)
      await waitFor(shown)
      assert.deepEqual(await browser.eval(`Array.from(${section}.querySelectorAll('dd'),e=>e.textContent)`), originalAmounts)
    }
    await browser.eval(`window.session.permissionRole='admin';window.session.capabilities={canViewFinalPrice:true};window.rerender()`)
    await browser.wait(`!document.querySelector('[aria-label$="purchase price"]')`)
    assert.equal(await browser.eval('document.body.textContent.includes("purchase per unit")'), false)
    assert.equal(await browser.eval('document.body.textContent.includes("₹123")'), false)
    await browser.eval(`window.session.permissionRole='super_admin';window.rerender()`)
    await waitFor(shown)
    // Legacy workspace key is constant; account email still isolates the toggle.
    await browser.eval(`window.session.contextKey='legacy-season-workspace';window.session.activeSeasonId=null;window.rerender()`)
    await waitFor(shown); await hide()
    await browser.eval(`window.session.email='legacy-other@test.com';window.rerender()`)
    await waitFor(shown)
  } finally { await browser.close() }
})
