import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import WebSocket from '../../../server/node_modules/ws/wrapper.mjs'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'
import { Browser } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'
import { workflowDb } from '../../../server/tests/helpers/workflowSqlite.js'
import { signLocalDevAdminJwt } from '../../../server/src/middleware/localAdminDevAuth.js'
import worker from '../../../server/src/index.js'

test('Rajesh creates the first category and product in Stall B, with visible errors and no Stall A changes', async t => {
  // Disposable in-memory SQLite only; never opens Local D1 or a remote database.
  const db = await workflowDb(t, { migrate: false })
  await db.script(`
    ALTER TABLE location_members ADD COLUMN can_view_final_rate INTEGER NOT NULL DEFAULT 0;
    DELETE FROM products WHERE location_id='loc-b';
    DELETE FROM categories WHERE location_id='loc-b';
    INSERT INTO admin_users(id,email,display_name,role) VALUES('rajesh','rajesh@test.com','Rajesh','admin');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2026','rajesh','owner');
    INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES('loc-b','season-2026','rajesh','owner');
  `)
  const query = async sql => (await db.prepare(sql).bind().all()).results
  const original = await query("SELECT * FROM products WHERE location_id='loc-a'")
  const originalCategories = await query("SELECT * FROM categories WHERE location_id='loc-a'")
  const env = { DB: db, ADMIN_LOCATION_MODE: '1', ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: 'product-create-test-secret-at-least-32-characters', ADMIN_LOCAL_DEV_EMAIL: 'rajesh@test.com' }
  const token = await signLocalDevAdminJwt(env, { email: 'rajesh@test.com' })
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Page from './src/admin/pages/AdminProductCreatePage.jsx';
    import {setAdminActiveSeasonId,setAdminLocationSelection} from './src/admin/api/adminSeasonRequest.js';
    setAdminActiveSeasonId('season-2026');
    setAdminLocationSelection({locationModeEnabled:true,activeLocationId:'loc-b',activeBusinessId:'shop'});
    createRoot(document.getElementById('root')).render(React.createElement(Page));
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    plugins: [{ name: 'product-page-session', setup(b) {
      b.onResolve({ filter: /(?:AdminSessionContext\.jsx|useAdminSeasonReadOnly\.js|react-router-dom)$/ }, args => ({ path: args.path, namespace: 'test' }))
      b.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'js', contents:
        path.endsWith('AdminSessionContext.jsx') ? `export const useAdminSession=()=>({role:'admin',permissionRole:'owner',activeSeasonId:'season-2026'})` :
        path.endsWith('useAdminSeasonReadOnly.js') ? `export const useAdminSeasonReadOnly=()=>({isReadOnly:false})` :
        `export const useNavigate=()=>((path)=>{window.destination=path});export const Link=({children})=>children`,
      }))
    } }],
  })
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  globalThis.WebSocket ??= WebSocket
  const trace = [], requests = []
  const browser = new Browser('stall-b-product-create', await mkdtemp(join(tmpdir(), 'diwali-product-create-')), port, trace)
  let failProduct = false
  browser.intercept = async p => {
    const url = new URL(p.request.url)
    if (url.origin !== 'http://127.0.0.1:5193') return browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
    let response
    if (url.pathname.startsWith('/api/')) {
      requests.push({ method: p.request.method, path: url.pathname, headers: p.request.headers, body: p.request.postData })
      if (failProduct && url.pathname === '/api/admin/products' && p.request.method === 'POST') {
        failProduct = false
        return browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionClosed' })
      }
      const headers = new Headers(p.request.headers)
      headers.set('Cf-Access-Jwt-Assertion', token)
      response = await worker.fetch(new Request('http://127.0.0.1:5193' + url.pathname + url.search, {
        method: p.request.method, headers, ...(p.request.postData ? { body: p.request.postData } : {}),
      }), env, {})
    } else response = new Response('<html><body><div id="root"></div></body></html>', { headers: { 'Content-Type': 'text/html' } })
    await browser.call('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: response.status,
      responseHeaders: [...response.headers].map(([name, value]) => ({ name, value })),
      body: Buffer.from(await response.text()).toString('base64') })
  }
  try {
    await browser.launch()
    await browser.call('Page.navigate', { url: 'http://127.0.0.1:5193/admin/products/new' })
    await browser.wait("Boolean(document.getElementById('root'))")
    await browser.eval(bundle.outputFiles[0].text)
    await browser.wait("document.body.textContent.includes('This stall has no categories')")
    await browser.field('Product ID', 'P990001')
    await browser.field('Name', 'Stall B new product')
    await browser.click('Create product')
    await browser.wait("document.querySelector('[role=alert]')?.textContent.includes('Create its first category')")
    assert.equal(requests.some(r => r.path === '/api/admin/products' && r.method === 'POST'), false)
    assert.equal(await browser.eval("document.activeElement.getAttribute('role')"), 'alert')
    await browser.field('New category name', 'Stall B category')
    await browser.field('New category slug', 'cat-a')
    await browser.click('Create category for this stall')
    await browser.wait("document.querySelector('[role=alert]')?.textContent.includes('Category slug already exists')")
    await browser.field('New category slug', 'stall-b-category')
    await browser.click('Create category for this stall')
    await browser.wait("document.getElementById('product-category')?.value==='stall-b-category'")
    assert.equal(await browser.eval("document.getElementById('product-name').value"), 'Stall B new product')
    // The original stall's globally reserved product ID must produce a visible error.
    await browser.field('Product ID', 'P001')
    await browser.click('Create product')
    await browser.wait("document.querySelector('[role=alert]')?.textContent.includes('Product id already exists')")
    await browser.field('Product ID', 'P990001')
    failProduct = true
    await browser.click('Create product')
    await browser.wait("document.querySelector('[role=alert]')?.textContent.includes('Could not reach the admin API')")
    assert.equal(await browser.eval("document.querySelector('button[type=submit]').disabled"), false)
    await browser.click('Create product')
    await browser.wait("window.destination==='/admin/products/P990001/edit'")
    const product = await query("SELECT id,name,category_slug,location_id,season_id FROM products WHERE id='P990001'")
    assert.deepEqual(product, [{ id: 'P990001', name: 'Stall B new product', category_slug: 'stall-b-category', location_id: 'loc-b', season_id: 'season-2026' }])
    assert.deepEqual(await query("SELECT * FROM products WHERE location_id='loc-a'"), original)
    assert.deepEqual(await query("SELECT * FROM categories WHERE location_id='loc-a'"), originalCategories)
    assert.deepEqual(await query("SELECT * FROM platform_admins WHERE admin_user_id='rajesh'"), [])
    for (const request of requests) {
      const headers = new Headers(request.headers)
      assert.equal(headers.get('X-Admin-Season-Id'), 'season-2026')
      assert.equal(headers.get('X-Admin-Location-Id'), 'loc-b')
    }
    assert.equal(trace.filter(row => row.interceptionError).length, 0, JSON.stringify(trace))
  } finally { await browser.close() }
})
