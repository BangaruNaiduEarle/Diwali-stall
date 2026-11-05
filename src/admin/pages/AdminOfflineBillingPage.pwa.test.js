import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import WebSocket from '../../../server/node_modules/ws/wrapper.mjs'
import { Browser } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'

// Run after the local build. This uses actual built assets, the real manifest
// and real service worker, with no existing site profile or D1 connection.
test('built localhost PWA verifies its cache, reloads offline and detects missing cached assets', { timeout: 90000 }, async t => {
  const root = resolve('dist')
  const html = await readFile(join(root, 'index.html'))
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    response.setHeader('Cache-Control', 'no-store')
    try {
      if (path.startsWith('/api/')) {
        response.writeHead(401, { 'Content-Type': 'application/json' })
        return response.end(JSON.stringify({ error: 'unauthorized', message: 'Local shell test has no signed-in session.' }))
      }
      if (path === '/readiness.js') {
        response.setHeader('Content-Type', 'text/javascript')
        return response.end(await readFile('src/admin/offline/appShell.js'))
      }
      if (path === '/admin/offline' || path === '/') {
        response.setHeader('Content-Type', 'text/html')
        return response.end(html)
      }
      const file = resolve(root, '.' + path)
      if (!file.startsWith(root + '\\') && !file.startsWith(root + '/')) { response.writeHead(403); return response.end() }
      response.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream')
      response.end(await readFile(file))
    } catch { response.writeHead(404); response.end('missing local asset') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const origin = `http://127.0.0.1:${server.address().port}`
  const debugServer = createServer()
  await new Promise(resolve => debugServer.listen(0, '127.0.0.1', resolve))
  const port = debugServer.address().port
  await new Promise(resolve => debugServer.close(resolve))
  globalThis.WebSocket ??= WebSocket
  const trace = []
  const browser = new Browser('offline-pos-pwa', await mkdtemp(join(tmpdir(), 'diwali-pos-pwa-')), port, trace)
  browser.intercept = p => browser.call(new URL(p.request.url).origin === origin ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
    requestId: p.requestId, ...(new URL(p.request.url).origin === origin ? {} : { errorReason: 'BlockedByClient' }),
  })
  try {
    await browser.launch()
    await browser.call('Page.navigate', { url: origin + '/admin/offline' })
    await browser.wait("Boolean(document.querySelector('.pos-setup'))")
    const manifest = await browser.eval("fetch('/manifest.webmanifest').then(r=>r.json())")
    assert.equal(manifest.start_url, '/admin/offline')
    assert.equal(manifest.display, 'standalone')
    assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'))
    await browser.eval("import('/readiness.js').then(module=>{window.shellTools=module})")
    assert.equal(await browser.eval('window.shellTools.offlineAppShellReady()'), false)
    await browser.eval('window.shellTools.prepareOfflineAppShell()')
    assert.equal(await browser.eval('window.shellTools.offlineAppShellReady()'), true)
    await browser.wait('Boolean(navigator.serviceWorker.controller)')
    // The SW refuses API/auth caching; this shell-only test saves no identity.
    assert.equal(await browser.eval("(async()=>{const keys=await caches.keys();for(const key of keys){const cache=await caches.open(key);if((await cache.keys()).some(r=>new URL(r.url).pathname.startsWith('/api/')))return false}return true})()"), true)
    await browser.offline(true)
    await browser.call('Page.reload', { ignoreCache: true })
    await browser.wait("Boolean(document.querySelector('.offline-pos .pos-tabs'))")
    assert.equal(await browser.eval('navigator.onLine'), false)
    await browser.eval("(async()=>{const keys=await caches.keys();const cache=await caches.open(keys.find(k=>k.startsWith('diwali-offline-shell-')));const asset=(await cache.keys()).find(r=>new URL(r.url).pathname.endsWith('.js'));await cache.delete(asset)})()")
    assert.equal(await browser.eval("new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>{channel.port1.close();resolve(e.data.ok)};navigator.serviceWorker.controller.postMessage({type:'CHECK_OFFLINE_WORKSPACE'},[channel.port2])})"), false)
    assert.equal(trace.filter(row => row.interceptionError).length, 0, JSON.stringify(trace))
  } finally { await browser.close() }
})
