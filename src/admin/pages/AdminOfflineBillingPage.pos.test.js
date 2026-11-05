import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import WebSocket from '../../../server/node_modules/ws/wrapper.mjs'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'
import { Browser, delay } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'
import { workflowDb } from '../../../server/tests/helpers/workflowSqlite.js'
import { signLocalDevAdminJwt } from '../../../server/src/middleware/localAdminDevAuth.js'
import { Miniflare } from '../../../server/node_modules/miniflare/dist/src/index.js'

test('continuous mobile POS: independent member setup, keyboard editing, offline bills, QR, receipts and stall isolation', { timeout: 240000 }, async t => {
  let db = await workflowDb(t)
  await db.script(readFileSync(new URL('../../../server/database/migrations/0023_offline_sync_receipts.sql', import.meta.url), 'utf8'))
  await db.script(readFileSync(new URL('../../../server/database/migrations/0024_qr_handover.sql', import.meta.url), 'utf8'))
  await db.script(`
    ALTER TABLE location_members ADD COLUMN can_view_final_rate INTEGER NOT NULL DEFAULT 0;
    INSERT INTO admin_users(id,email,display_name,role) VALUES('rajesh','rajesh@test.com','Rajesh','admin');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2026','rajesh','owner');
    INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES('loc-b','season-2026','rajesh','owner');
    INSERT INTO admin_users(id,email,display_name,role) VALUES('pos-admin','pos-admin@test.com','POS Admin','admin'),('pos-super','pos-super@test.com','POS Super','admin');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2026','pos-admin','admin'),('season-2026','pos-super','super_admin');
    INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES('loc-b','season-2026','pos-admin','admin'),('loc-b','season-2026','pos-super','super_admin');
    INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES('loc-a','season-2026','pos-super','super_admin');
    INSERT INTO family_packs(id,slug,name,pack_label,selling_price_paise,season_id,location_id,active) VALUES('FP901','stall-b-celebration','Celebration Pack','Classic',120000,'season-2026','loc-b',1);
    INSERT INTO family_pack_items(family_pack_id,product_id,quantity,unit_label,sort_order) VALUES('FP901','P002',2,'Box',1);
    UPDATE products SET images_json='["/images/pos-test.svg"]' WHERE id='P002';
  `)
  const query = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
  const original = await query("SELECT * FROM products WHERE location_id='loc-a'")
  const originalMemberships = await query('SELECT * FROM location_members ORDER BY admin_user_id,location_id')
  const env = { DB: db, ADMIN_LOCATION_MODE: '1', ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: 'offline-pos-regression-secret-at-least-32-characters', ADMIN_LOCAL_DEV_EMAIL: 'rajesh@test.com' }
  const rootKey = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify'])
  env.HANDOVER_SIGNING_JWK = JSON.stringify(await crypto.subtle.exportKey('jwk', rootKey.privateKey))
  let token = await signLocalDevAdminJwt(env, { email: 'rajesh@test.com' })
  // Hydrate the isolated fixture into actual ephemeral Local D1, then exercise
  // the bundled Worker in workerd. No existing .wrangler persistence is opened.
  const schema = await query("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name")
  const records = []
  for (const table of schema.filter(row => row.type === 'table')) records.push({ name: table.name, rows: await query(`SELECT * FROM "${table.name}"`) })
  const workerBundle = await build({ entryPoints: ['server/src/index.js'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  const { DB: fixtureBinding, ...bindings } = env
  void fixtureBinding
  const runtime = new Miniflare({ modules: true, script: workerBundle.outputFiles[0].text, compatibilityDate: '2025-04-01',
    host: '127.0.0.1', port: 0, bindings, d1Databases: ['DB'], d1Persist: false, cachePersist: false, kvPersist: false, r2Persist: false, durableObjectsPersist: false })
  t.after(() => runtime.dispose())
  db = await runtime.getD1Database('DB')
  for (const row of schema.filter(row => row.type === 'table')) await db.prepare(row.sql).run()
  await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'), ...records.flatMap(table => table.rows.map(row => {
    const names = Object.keys(row)
    return db.prepare(`INSERT INTO "${table.name}" (${names.map(name => `"${name}"`).join(',')}) VALUES (${names.map(() => '?').join(',')})`).bind(...names.map(name => row[name]))
  }))])
  for (const row of schema.filter(row => row.type !== 'table')) await db.prepare(row.sql).run()
  const origin = 'http://127.0.0.1:5193'
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrowserRouter} from 'react-router-dom';
    import Page from './src/admin/pages/AdminOfflineBillingPage.jsx';
    import {AdminSessionProvider} from './src/admin/context/AdminSessionContext.jsx';
    import {setAdminActiveSeasonId,setAdminLocationSelection} from './src/admin/api/adminSeasonRequest.js';
    import {openOfflineStorage} from './src/admin/offline/storage.js';
    setAdminActiveSeasonId('season-2026');setAdminLocationSelection({locationModeEnabled:true,activeLocationId:null,activeBusinessId:null});
    window.readOffline=async()=>{const db=await openOfflineStorage();try{const p=await db.activeProfile();return p?{profile:p,drafts:await db.list('drafts',p.scope),outbox:await db.list('outbox',p.scope)}:null}finally{db.close()}};
    let root;window.mount=()=>{root=createRoot(document.getElementById('root'));root.render(<BrowserRouter><AdminSessionProvider><Page/></AdminSessionProvider></BrowserRouter>)};
    window.unmount=()=>root.unmount();window.mount();
  ` }, bundle: true, write: false, outfile: 'pos.js', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    plugins: [{ name: 'test-shell-preparation-only', setup(b) {
      b.onResolve({ filter: /offline\/appShell\.js$/ }, () => ({ path: 'shell', namespace: 'test' }))
      b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export async function prepareOfflineAppShell(){} export async function offlineAppShellReady(){return false}' }))
    } }],
  })
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  globalThis.WebSocket ??= WebSocket
  const trace = [], sent = []
  let browser = new Browser('offline-pos-mobile', await mkdtemp(join(tmpdir(), 'diwali-offline-pos-')), port, trace)
  let loseAcknowledgement = false
  const intercept = async p => {
    const url = new URL(p.request.url)
    if (url.origin !== origin) return browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
    let response
    if (url.pathname.startsWith('/api/')) {
      if (await browser.eval('navigator.onLine') === false) return browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' })
      const headers = new Headers(p.request.headers); headers.set('Cf-Access-Jwt-Assertion', token)
      const request = new Request(origin + url.pathname + url.search, { method: p.request.method, headers,
        ...(p.request.postData ? { body: p.request.postData } : {}) })
      response = await runtime.dispatchFetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers),
        ...(p.request.postData ? { body: p.request.postData } : {}) })
      if (url.pathname === '/api/admin/offline/sync') {
        sent.push({ body: JSON.parse(p.request.postData), status: response.status })
        if (loseAcknowledgement && response.ok) {
          loseAcknowledgement = false
          return browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionClosed' })
        }
      }
    } else if (url.pathname === '/images/pos-test.svg') response = new Response('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect x="55" y="10" width="70" height="95" rx="8" fill="#176c61"/><path d="M65 25h50M65 40h50M65 55h50" stroke="#e7f4ef" stroke-width="3"/></svg>', { headers: { 'Content-Type': 'image/svg+xml' } })
    else if (url.pathname === '/pos.js') response = new Response(js, { headers: { 'Content-Type': 'text/javascript' } })
    else if (url.pathname === '/pos.css') response = new Response(css, { headers: { 'Content-Type': 'text/css' } })
    else response = new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/pos.css"><style>body{margin:0}</style></head><body><div id="root"></div><script src="/pos.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } })
    await browser.call('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: response.status,
      responseHeaders: [...response.headers].map(([name, value]) => ({ name, value })), body: Buffer.from(await response.text()).toString('base64') })
  }
  browser.intercept = intercept
  const click = label => browser.click(label)
  const goTab = label => browser.eval(`Array.from(document.querySelectorAll('.pos-tabs button')).find(b=>b.textContent.includes(${JSON.stringify(label)})).click()`)
  const openCustomer = async name => {
    await goTab('Bills & sync')
    await browser.wait(`Array.from(document.querySelectorAll('.pos-saved-bill')).some(card=>card.querySelector('h3')?.textContent===${JSON.stringify(name)})`)
    await browser.eval(`Array.from(document.querySelectorAll('.pos-saved-bill')).find(card=>card.querySelector('h3')?.textContent===${JSON.stringify(name)}).querySelector('button').click()`)
  }
  const outbox = () => browser.eval('(async()=> (await window.readOffline()).outbox.sort((a,b)=>a.order-b.order))()')
  const waitSaved = () => browser.wait("document.querySelector('.pos-sale-heading .pos-status')?.textContent==='Saved on device'")
  const retrySessionIfNeeded = async () => {
    if (await browser.eval("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Retry session verification')")) await click('Retry session verification')
  }
  // CDP keyboard input goes through the browser's editing/focus path. Unlike
  // setting an entire value with a synthetic event, it catches save-time blur.
  const typeText = async (selector, value) => {
    await browser.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select();window.typingTarget=el})()`)
    await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    for (const char of value) {
      await browser.call('Input.insertText', { text: char })
      assert.equal(await browser.eval('document.activeElement===window.typingTarget && !window.typingTarget.disabled'), true, `focus while typing ${selector}`)
    }
    assert.equal(await browser.eval('window.typingTarget.value'), value)
  }
  const inputFor = async label => browser.eval(`(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes(${JSON.stringify(label)}));const el=label.querySelector('input,textarea');el.dataset.typing=${JSON.stringify(label)};return '[data-typing="'+${JSON.stringify(label)}+'"]'})()`)
  try {
    await browser.launch()
    await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.call('Page.navigate', { url: origin + '/admin/offline' })
    await browser.wait("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Prepare / refresh selected stall for offline use'&&!b.disabled)")
    await browser.eval("(()=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{};event.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(event)})()")
    await click('Install app')
    await browser.wait("document.querySelector('.pos-install')?.textContent.includes('Waiting for browser confirmation')")
    assert.equal(await browser.eval("document.querySelector('.pos-install').textContent.includes('App installed / standalone mode')"), false)
    await browser.eval("window.dispatchEvent(new Event('appinstalled'))")
    await browser.wait("document.querySelector('.pos-install')?.textContent.includes('App installed / standalone mode')")
    await click('Prepare / refresh selected stall for offline use')
    await browser.wait("Boolean(document.querySelector('.pos-welcome'))")
    await click('Start new bill')
    await browser.wait("Boolean(document.querySelector('input[autocomplete=name]'))")
    await browser.wait("document.querySelector('.pos-product img')?.complete")
    await typeText(await inputFor('Customer name'), 'Rajesh offline customer')
    await browser.eval("window.typingTarget.setSelectionRange(0,6)")
    await browser.call('Input.insertText', { text: 'Suresh' })
    assert.equal(await browser.eval('window.typingTarget.value'), 'Suresh offline customer')
    assert.equal(await browser.eval('document.activeElement===window.typingTarget'), true)
    await typeText(await inputFor('Customer name'), 'Rajesh edited customer')
    await typeText(await inputFor('Mobile number'), '123')
    await waitSaved()
    await browser.eval("document.querySelector('[aria-label=\"Add Product B\"]').click()")
    await waitSaved()
    await click('Review bill')
    await browser.wait("document.querySelector('[role=alert]')?.textContent.includes('10-digit')")
    await typeText(await inputFor('Mobile number'), '9876543210')
    await waitSaved()
    await click('Continue to products')
    await browser.wait("Boolean(document.querySelector('.pos-customer-summary'))")
    // Search, category filtering, pack composition and cart controls are real UI interactions.
    await typeText('[aria-label="Search products"]', 'Celebration')
    await browser.wait("Boolean(document.querySelector('[aria-label=\"Add Celebration Pack\"]'))")
    assert.equal(await browser.eval("document.querySelectorAll('.pos-product:not(.pos-product--pack)').length"), 0)
    await browser.eval("document.querySelector('[aria-label=\"Add Celebration Pack\"]').click()")
    await waitSaved()
    await browser.eval("document.querySelector('[aria-label=\"Clear search\"]').click()")
    await browser.eval("document.querySelector('.pos-bottom-bar__cart').click()")
    await browser.wait("Boolean(document.querySelector('.pos-cart--open'))")
    await browser.eval("document.querySelector('[aria-label=\"Increase Product B\"]').click()")
    await waitSaved()
    await browser.eval("document.querySelector('[aria-label=\"Decrease Product B\"]').click()")
    await waitSaved()
    assert.equal(await browser.eval("document.querySelector('[aria-label=\"Quantity for Product B\"]').value"), '1')
    await typeText('[aria-label="Quantity for Product B"]', '12')
    await typeText('[aria-label="Quantity for Product B"]', '1')
    await browser.eval("document.querySelector('[aria-label=\"Close cart\"]').click()")
    await mkdir('.tmp/offline-pos', { recursive: true })
    for (const width of [390,1440]) {
      await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1050 })
      await delay(80)
      const shot = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await writeFile(`.tmp/offline-pos/${width === 390 ? 'mobile' : 'desktop'}-catalogue.png`, Buffer.from(shot.data, 'base64'))
    }
    await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.offline(true)
    await click('Review bill')
    await typeText(await inputFor('Customer-agreed amount'), '2100')
    await waitSaved()
    await click('Save bill')
    await browser.wait("(async()=> (await window.readOffline()).outbox.some(r=>r.payload.kind==='CREATE'))()")
    // Rapid double submission must not create another CREATE operation.
    assert.equal((await outbox()).filter(row => row.payload.kind === 'CREATE').length, 1)
    await browser.eval("document.querySelector('.pos-bottom-bar__cart').click()")
    await typeText(await inputFor('Selling price override'), '900')
    await typeText(await inputFor('Discount for next adjustment'), '0')
    await waitSaved()
    await browser.eval("document.querySelector('[aria-label=\"Close cart\"]').click()")
    await click('Save item changes')
    await browser.wait("(async()=> (await window.readOffline()).outbox.some(r=>r.payload.kind==='EDIT'))()")
    await click('Save agreed amount')
    await browser.wait("(async()=> (await window.readOffline()).outbox.some(r=>r.payload.kind==='AGREEMENT'))()")
    await click('Finalize bill')
    await browser.wait("document.querySelector('dialog')?.open")
    await click('Confirm finalization')
    await browser.wait("Boolean(document.querySelector('.pos-payment'))")
    await typeText(await inputFor('Received amount'), '500')
    await typeText(await inputFor('Payment details'), 'Cash received at stall')
    await browser.eval("(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save payment');button.click();button.click()})()")
    await browser.wait("(async()=> (await window.readOffline()).outbox.some(r=>r.payload.kind==='PAYMENT'))()")
    assert.equal((await outbox()).filter(row => row.payload.kind === 'PAYMENT').length, 1)
    await click('UPI')
    await browser.field('Received amount', '50')
    await click('Save payment')
    await browser.wait("document.querySelector('[role=alert]')?.textContent.includes('transaction reference')")
    await typeText(await inputFor('Transaction reference'), 'UPI-EDIT-12345')
    await typeText(await inputFor('Transaction reference'), '')
    await browser.field('Ledger action', 'HOLD')
    await typeText(await inputFor('Hold / release details'), 'Awaiting remaining payment')
    await click('Save payment hold')
    await browser.wait("(async()=> (await window.readOffline()).outbox.length===6)()")
    await browser.field('Ledger action', 'RELEASE_HOLD')
    await browser.field('Hold / release details', 'Customer will pay balance at pickup')
    await click('Save hold release')
    await browser.wait("(async()=> (await window.readOffline()).outbox.length===7)()")
    // A second customer uses the same catalogue/device while still offline.
    const preparedDevice = (await browser.eval('window.readOffline()')).profile.scope.deviceId
    const registrations = (await query('SELECT COUNT(*) n FROM offline_sync_devices'))[0].n
    await click('Start next bill')
    await typeText(await inputFor('Customer name'), 'Second offline customer')
    await typeText(await inputFor('Mobile number'), '9876543212')
    await browser.eval("document.querySelector('[aria-label=\"Add Product B\"]').click()")
    await typeText(await inputFor('Customer-agreed amount'), '900')
    await waitSaved()
    await click('Save bill')
    await browser.wait("(async()=> (await window.readOffline()).outbox.length===8)()")
    assert.equal((await browser.eval('window.readOffline()')).profile.scope.deviceId, preparedDevice)
    assert.equal((await query('SELECT COUNT(*) n FROM offline_sync_devices'))[0].n, registrations)
    const captured = await outbox()
    assert.deepEqual(captured.map(row => row.payload.kind), ['CREATE','EDIT','AGREEMENT','CLOSE','PAYMENT','PAYMENT','PAYMENT','CREATE'])
    assert.ok(captured.every(row => row.state === 'pending' && row.payload.scope.locationId === 'loc-b' && row.payload.scope.userId === 'rajesh'))
    assert.equal((await query('SELECT COUNT(*) n FROM customer_requests'))[0].n, 0)
    // IndexedDB survives a complete component/provider restart without a connection.
    await browser.eval('window.unmount()')
    await delay(100)
    await browser.eval('window.mount()')
    await browser.wait("Boolean(document.querySelector('.pos-welcome'))")
    assert.deepEqual((await outbox()).map(row => row.payload.operationId), captured.map(row => row.payload.operationId))
    await goTab('Bills & sync')
    await browser.wait("Boolean(document.querySelector('.pos-saved-bill'))")
    await openCustomer('Rajesh edited customer')
    await browser.wait("Boolean(document.querySelector('.pos-completion'))")
    assert.match(await browser.eval("document.querySelector('.pos-balance-grid').innerText"), /1,600/)
    // Verify mobile and desktop widths, including expanded cart.
    await mkdir('.tmp/offline-pos', { recursive: true })
    for (const width of [360,390,430,768,1440]) {
      await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1050 })
      await delay(80)
      assert.equal(await browser.eval('document.documentElement.scrollWidth<=window.innerWidth'), true, `no horizontal overflow at ${width}`)
      if ([390,1440].includes(width)) {
        const shot = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        await writeFile(`.tmp/offline-pos/${width === 390 ? 'mobile' : 'desktop'}-payment.png`, Buffer.from(shot.data, 'base64'))
      }
    }
    await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.offline(false)
    await goTab('Workspace')
    await click('Retry session verification')
    await browser.wait("Array.from(document.querySelectorAll('select')).some(s=>Array.from(s.options).some(o=>o.value==='loc-b'))")
    await browser.field('Active stall', 'loc-b')
    await browser.wait("Boolean(document.querySelector('.pos-qr'))")
    await goTab('Bills & sync')
    loseAcknowledgement = true
    await click('Synchronize')
    await browser.wait("(async()=> (await window.readOffline()).outbox.some(r=>r.lastError))()")
    assert.equal((await query('SELECT COUNT(*) n FROM customer_requests'))[0].n, 1)
    await delay(2400)
    await click('Synchronize')
    await browser.wait("(async()=> (await window.readOffline()).outbox.every(r=>r.state==='synced'))()")
    assert.equal((await query('SELECT COUNT(*) n FROM customer_requests'))[0].n, 2)
    const requests = await query('SELECT id,status,finalization_status,location_id FROM customer_requests')
    assert.equal(requests[0].location_id, 'loc-b'); assert.equal(requests[0].status, 'closed')
    assert.equal((await query('SELECT COUNT(*) n FROM request_payment_ledger'))[0].n, 3)
    assert.equal((await query('SELECT COUNT(*) n FROM offline_sync_receipts'))[0].n, 8)
    await browser.wait("Array.from(document.querySelectorAll('.pos-saved-bill')).every(card=>card.textContent.includes('DWL-'))")
    await openCustomer('Rajesh edited customer')
    await browser.wait("document.querySelector('.pos-bill-reference')?.textContent.startsWith('DWL-')")
    assert.match(await browser.eval("document.querySelector('.pos-completion').innerText"), /Server acknowledged/)
    assert.match(await browser.eval("document.querySelector('.pos-balance-grid').innerText"), /1,600/)
    // Replaying the exact captured CREATE cannot duplicate a bill.
    const replay = sent.find(row => row.body.kind === 'CREATE').body
    const replayResult = await browser.eval(`(async()=>{const response=await fetch('/api/admin/offline/sync',{method:'POST',headers:{
      'Content-Type':'application/json','X-Admin-Season-Id':'season-2026','X-Admin-Location-Id':'loc-b'},body:${JSON.stringify(JSON.stringify(replay))}});return response.json()})()`)
    assert.equal(replayResult.idempotentReplay, true, JSON.stringify(replayResult))
    const paymentReplay = sent.find(row => row.body.kind === 'PAYMENT').body
    const paymentReplayResult = await browser.eval(`(async()=>{const response=await fetch('/api/admin/offline/sync',{method:'POST',headers:{
      'Content-Type':'application/json','X-Admin-Season-Id':'season-2026','X-Admin-Location-Id':'loc-b'},body:${JSON.stringify(JSON.stringify(paymentReplay))}});return response.json()})()`)
    assert.equal(paymentReplayResult.idempotentReplay, true, JSON.stringify(paymentReplayResult))
    assert.equal((await query('SELECT COUNT(*) n FROM request_payment_ledger'))[0].n, 3)
    const foreignStatus = await browser.eval(`(async()=>{const response=await fetch('/api/admin/offline/catalogue',{headers:{
      'X-Admin-Season-Id':'season-2026','X-Admin-Location-Id':'loc-a'}});return response.status})()`)
    assert.equal(foreignStatus, 403)
    assert.deepEqual(await query("SELECT * FROM products WHERE location_id='loc-a'"), original)
    assert.deepEqual(await query('SELECT * FROM location_members ORDER BY admin_user_id,location_id'), originalMemberships)
    // A stale catalogue produces a real conflict and a visible retained operation.
    await click('Start next bill')
    await browser.field('Customer name', 'Conflict customer')
    await browser.field('Mobile number', '9876543211')
    await waitSaved()
    await browser.eval("document.querySelector('[aria-label=\"Add Product B\"]').click()")
    await waitSaved()
    await click('Review bill')
    await browser.field('Customer-agreed amount', '900')
    await waitSaved()
    await click('Save bill')
    await browser.wait("(async()=> (await window.readOffline()).outbox.length===9)()")
    await db.prepare('UPDATE products SET selling_price_paise=? WHERE id=?').bind(95000,'P002').run()
    await goTab('Bills & sync')
    await click('Synchronize')
    await browser.wait("document.body.textContent.includes('catalogue changed')")
    assert.ok((await outbox()).some(row => row.state === 'conflict'))
    assert.equal((await query('SELECT COUNT(*) n FROM customer_requests'))[0].n, 2)
    // Additional authorized roles each prepare an independent browser/device.
    // QR is optional: both Admin bills are saved before a QR is ever generated.
    const deviceIds = new Set([preparedDevice])
    let qrFrames
    for (const [actor, role] of [['pos-admin','admin'],['pos-super','super_admin']]) {
      await browser.close()
      token = await signLocalDevAdminJwt(env, { email: actor + '@test.com' })
      browser = new Browser(actor, await mkdtemp(join(tmpdir(), 'diwali-pos-member-')), port, trace)
      browser.intercept = intercept
      await browser.launch()
      await browser.call('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true })
      await browser.call('Page.navigate', { url: origin + '/admin/offline' })
      if (role === 'super_admin') {
        await browser.wait("Array.from(document.querySelectorAll('select')).some(s=>Array.from(s.options).some(o=>o.value==='loc-b'))")
        assert.equal(await browser.eval("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Prepare / refresh selected stall for offline use').disabled"), true)
        await browser.field('Active stall', 'loc-b')
      }
      await click('Prepare / refresh selected stall for offline use')
      await browser.wait("Boolean(document.querySelector('.pos-welcome'))")
      const state = await browser.eval('window.readOffline()')
      assert.equal(state.profile.role, role)
      assert.equal(state.profile.scope.userId, actor)
      assert.equal(state.profile.scope.locationId, 'loc-b')
      assert.equal(state.drafts.length, 0)
      assert.equal(deviceIds.has(state.profile.scope.deviceId), false)
      deviceIds.add(state.profile.scope.deviceId)
      await goTab('Workspace')
      await browser.eval("document.querySelector('.pos-qr').open=true")
      await click('Prepare / refresh secure QR handover online')
      await browser.wait("document.body.textContent.includes('QR signing and verification are prepared')")
      await browser.offline(true)
      if (role === 'admin') {
        await goTab('New sale')
        await click('Start new bill')
        for (const customer of ['Admin offline one','Admin offline two']) {
          await typeText(await inputFor('Customer name'), customer)
          await typeText(await inputFor('Mobile number'), '9876543213')
          await browser.eval("document.querySelector('[aria-label=\"Add Product B\"]').click()")
          await waitSaved()
          await click('Save bill')
          assert.equal(await browser.eval("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Finalize bill')"), false)
          if (customer.endsWith('one')) await click('Start next bill')
        }
        assert.equal((await outbox()).length, 2)
        await openCustomer('Admin offline one')
        await goTab('Workspace')
        await browser.eval("document.querySelector('.pos-qr').open=true")
        await browser.field('Intended recipient', 'pos-super')
        await click('Generate request handover QR')
        await browser.wait("Boolean(document.querySelector('[aria-label=\"Complete QR frame sequence\"]')?.value)")
        qrFrames = await browser.eval("document.querySelector('[aria-label=\"Complete QR frame sequence\"]').value")
        assert.ok(qrFrames.length > 100)
        const queued = await outbox()
        await browser.offline(false)
        await retrySessionIfNeeded()
        await goTab('Bills & sync')
        await click('Synchronize')
        await browser.wait("(async()=> (await window.readOffline()).outbox.every(r=>r.state==='synced'))()")
        assert.deepEqual((await outbox()).map(row => row.payload.operationId), queued.map(row => row.payload.operationId))
      } else {
        // Verify/accept actual signed frames through the UI, without camera
        // hardware, then reconcile the Admin-first source without duplication.
        await browser.eval("document.querySelector('.pos-qr details').open=true")
        await browser.area('QR frames to verify', qrFrames)
        await click('Verify all pasted frames')
        await browser.wait("document.body.textContent.includes('Verified request preview')")
        await click('Accept provisionally and save to outbox')
        await browser.wait("Boolean(document.querySelector('.pos-sale-heading'))")
        assert.equal((await outbox())[0].payload.kind, 'HANDOVER')
        await browser.offline(false)
        await goTab('Workspace')
        await retrySessionIfNeeded()
        const before = (await query('SELECT COUNT(*) n FROM customer_requests'))[0].n
        await goTab('Bills & sync')
        await click('Synchronize')
        await browser.wait("(async()=> (await window.readOffline()).outbox.every(r=>r.state==='synced'))()")
        assert.equal((await query('SELECT COUNT(*) n FROM customer_requests'))[0].n, before)
        assert.equal((await query('SELECT COUNT(*) n FROM request_handover_claims'))[0].n, 1)
        await openCustomer('Admin offline one')
        await click('New bill')
        await typeText(await inputFor('Customer name'), 'Super pending B')
        await typeText(await inputFor('Mobile number'), '9876543215')
        await browser.eval("document.querySelector('[aria-label=\"Add Product B\"]').click()")
        await waitSaved(); await click('Save bill')
        await goTab('Workspace')
        await browser.field('Active stall', 'loc-a')
        await click('Prepare / refresh selected stall for offline use')
        await browser.wait("document.querySelector('h1')?.textContent==='A'")
        await goTab('New sale'); await click('Start new bill')
        await typeText(await inputFor('Customer name'), 'Super pending A')
        await typeText(await inputFor('Mobile number'), '9876543216')
        await browser.eval("document.querySelector('[aria-label=\"Add Product A\"]').click()")
        await waitSaved(); await click('Save bill')
        await goTab('Workspace')
        await browser.field('Active stall', 'loc-b')
        await browser.wait("(async()=> (await window.readOffline()).profile.scope.locationId==='loc-b')()")
        assert.ok((await outbox()).every(row => row.payload.scope.locationId === 'loc-b'))
        const sentBefore = sent.length
        await goTab('Bills & sync'); await click('Synchronize')
        await browser.wait("(async()=> (await window.readOffline()).outbox.every(r=>r.state==='synced'))()")
        assert.ok(sent.slice(sentBefore).every(row => row.body.scope.locationId === 'loc-b'))
        assert.equal((await query("SELECT COUNT(*) n FROM customer_requests WHERE location_id='loc-a'"))[0].n, 0)
        await goTab('Workspace'); await browser.field('Active stall', 'loc-a')
        await browser.wait("(async()=> (await window.readOffline()).profile.scope.locationId==='loc-a')()")
        assert.equal((await outbox()).filter(row => row.state === 'pending').length, 1)
      }
    }
    assert.equal(deviceIds.size, 3)
    assert.equal(trace.filter(row => row.interceptionError).length, 0, JSON.stringify(trace))
  } finally { if (trace.some(row => row.interceptionError)) t.diagnostic(JSON.stringify(trace)); await browser.close() }
})
