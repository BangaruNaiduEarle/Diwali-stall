import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { prepareOfflineAppShell, offlineAppShellReady } from './appShell.js'

const source = readFileSync(new URL('../../../public/offline-billing-sw.js', import.meta.url), 'utf8')
  .replace('/* BUILD_ASSETS */ []', JSON.stringify(['/assets/app.js', '/assets/style.css', '/assets/lazy.js', '/manifest.webmanifest', '/icons/diwali-192.png']))
function worker() {
  const handlers = new Map(), entries = new Map(), fetches = []
  const cache = { put: async (key, value) => entries.set(String(key), value), match: async key => entries.get(String(key)) }
  const context = {
    self: { location: { origin: 'https://test.example' }, addEventListener: (type, handler) => handlers.set(type, handler), skipWaiting: async () => {}, clients: { claim: async () => {} } },
    URL, Response, caches: { open: async () => cache, keys: async () => [], delete: async () => true }, fetch: async (url, init) => {
      fetches.push({ url: String(url), init })
      if (String(url) === '/admin/offline') return new Response('<script src="/assets/app.js"></script><link href="/assets/style.css"><link href="https://foreign.test/font.css">', { headers: { 'Content-Type': 'text/html' } })
      return new Response('static asset')
    },
  }
  vm.runInNewContext(source, context)
  return { handlers, entries, fetches, context }
}
test('offline shell precaches only public static assets and workspace HTML without cookies', async () => {
  const { handlers, entries, fetches } = worker()
  let done
  handlers.get('install')({ waitUntil: promise => { done = promise } }); await done
  assert.equal(entries.size, 6)
  assert.ok(entries.has('/admin/offline')); assert.ok(entries.has('/assets/app.js')); assert.ok(entries.has('/assets/lazy.js'))
  assert.ok(fetches.every(row => row.init.credentials === 'omit'))
  assert.ok(!fetches.some(row => row.url.includes('/api/') || row.url.includes('foreign.test')))
})
test('service worker never intercepts API/auth requests and reloads only the offline workspace from cached HTML', async () => {
  const { handlers, entries, context } = worker()
  const saved = new Response('saved offline shell'); entries.set('/admin/offline', saved)
  for (const path of ['/api/admin/session','/api/admin/offline/catalogue','/admin/customer-requests', '/assets/private.json', '/assets/app.js?token=private']) {
    let handled = false
    handlers.get('fetch')({ request: { url: 'https://test.example' + path, method: 'GET', mode: path.startsWith('/api/') ? 'cors' : 'navigate' }, respondWith: () => { handled = true } })
    assert.equal(handled, false)
  }
  context.fetch = async () => { throw Error('offline') }
  let result
  handlers.get('fetch')({ request: { url: 'https://test.example/admin/offline?requestId=one', method: 'GET', mode: 'navigate' }, respondWith: response => { result = response } })
  assert.equal(await (await result).text(), 'saved offline shell')
})
test('shell refresh acknowledgement occurs only after all assets have been cached', async () => {
  const { handlers, entries } = worker()
  let done, message
  handlers.get('message')({ data: { type: 'CACHE_OFFLINE_WORKSPACE' }, ports: [{ postMessage: value => { message = value; assert.equal(entries.size, 6) } }], waitUntil: promise => { done = promise } })
  await done; assert.equal(message.ok, true)
})

test('failed asset preparation preserves an existing shell and reports failure', async () => {
  const { handlers, entries, context } = worker()
  entries.set('/admin/offline', new Response('previous shell'))
  const originalFetch = context.fetch
  context.fetch = (url, init) => url === '/assets/lazy.js' ? Promise.resolve(new Response('missing', { status: 404 })) : originalFetch(url, init)
  let done, message
  handlers.get('message')({ data: { type: 'CACHE_OFFLINE_WORKSPACE' }, ports: [{ postMessage: value => { message = value } }], waitUntil: promise => { done = promise } })
  await done
  assert.equal(message.ok, false)
  assert.equal(await entries.get('/admin/offline').text(), 'previous shell')
})

test('cached assets reopen offline and server errors fall back to workspace shell', async () => {
  const { handlers, entries, context } = worker()
  entries.set('/assets/lazy.js', new Response('lazy chunk'))
  entries.set('/admin/offline', new Response('saved shell'))
  context.fetch = async () => new Response('unavailable', { status: 503 })
  for (const [path, mode, expected] of [['/assets/lazy.js', 'cors', 'lazy chunk'], ['/admin/offline', 'navigate', 'saved shell']]) {
    let response
    handlers.get('fetch')({ request: { url: 'https://test.example' + path, method: 'GET', mode }, respondWith: value => { response = value } })
    assert.equal(await (await response).text(), expected)
  }
})
test('browser preparation waits for service-worker cache confirmation and reports failure', async () => {
  const active = { postMessage: (message, ports) => ports[0].postMessage({ ok: true }) }
  await prepareOfflineAppShell({ register: async () => ({ active }) })
  await assert.rejects(prepareOfflineAppShell({ register: async () => ({ active: { postMessage: (message, ports) => ports[0].postMessage({ ok: false, message: 'missing built assets' }) } }) }), /missing built assets/)
})

test('reload readiness checks every cached asset without fetching or trusting profile metadata', async () => {
  const { handlers, entries, fetches } = worker()
  let done, result
  const check = async () => {
    handlers.get('message')({ data: { type: 'CHECK_OFFLINE_WORKSPACE' }, ports: [{ postMessage: value => { result = value } }], waitUntil: promise => { done = promise } })
    await done
    return result.ok
  }
  assert.equal(await check(), false)
  handlers.get('install')({ waitUntil: promise => { done = promise } }); await done
  const downloaded = fetches.length
  assert.equal(await check(), true)
  entries.delete('/assets/lazy.js')
  assert.equal(await check(), false)
  assert.equal(fetches.length, downloaded)
})

test('browser readiness is false without an active worker and follows its cache acknowledgement', async () => {
  assert.equal(await offlineAppShellReady({}), false)
  for (const ready of [false,true]) {
    const active = { postMessage: (message, ports) => {
      assert.equal(message.type, 'CHECK_OFFLINE_WORKSPACE')
      ports[0].postMessage({ ok: ready })
    } }
    assert.equal(await offlineAppShellReady({ getRegistration: async () => ({ active }) }), ready)
  }
})

test('a waiting app update is explicit and never forces reload during a sale',async()=>{
  let cached=false
  await assert.rejects(prepareOfflineAppShell({register:async()=>({waiting:{},active:{postMessage:()=>{cached=true}}})}),/app update is waiting/i)
  assert.equal(cached,false)
})
