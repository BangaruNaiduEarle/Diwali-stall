/* Cache only the public build shell. Business data stays in scoped IndexedDB.
 * Vite injects an exact asset allowlist and a content-derived cache version. */
const ASSETS = /* BUILD_ASSETS */ []
const CACHE = 'diwali-offline-shell-development'
const WORKSPACE = '/admin/offline'
async function cacheWorkspace() {
  if (!ASSETS.length) throw Error('Build and preview the app to enable offline navigation.')
  const response = await fetch(WORKSPACE, { cache: 'reload', credentials: 'omit' })
  if (!response.ok || response.redirected || !response.headers.get('Content-Type')?.includes('text/html')) throw Error('Offline workspace shell could not be cached.')
  const html = await response.clone().text()
  const referenced = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => new URL(match[1], self.location.origin))
    .filter(url => url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
  if (!referenced.length || referenced.some(url => !ASSETS.includes(url.pathname))) throw Error('The application was updated. Reload online and prepare again.')
  const cache = await caches.open(CACHE)
  await Promise.all(ASSETS.map(async path => {
    const asset = await fetch(path, { cache: 'reload', credentials: 'omit' })
    if (!asset.ok || asset.redirected || asset.headers.get('Content-Type')?.includes('text/html')) throw Error('Static asset unavailable: ' + path)
    await cache.put(path, asset)
  }))
  // Publish HTML only once every required asset is durable.
  await cache.put(WORKSPACE, response)
}
self.addEventListener('install', event => {
  // Updates wait for old windows to close; never force a reload during entry.
  event.waitUntil(cacheWorkspace())
})
self.addEventListener('message', event => {
  if (event.data?.type === 'CHECK_OFFLINE_WORKSPACE') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE)
      const entries = await Promise.all([WORKSPACE, ...ASSETS].map(path => cache.match(path)))
      event.ports[0]?.postMessage({ ok: ASSETS.length > 0 && entries.every(Boolean) })
    })().catch(() => event.ports[0]?.postMessage({ ok: false })))
    return
  }
  if (event.data?.type !== 'CACHE_OFFLINE_WORKSPACE') return
  event.waitUntil(cacheWorkspace().then(() => event.ports[0]?.postMessage({ ok: true }), error => event.ports[0]?.postMessage({ ok: false, message: error.message })))
})
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('diwali-offline-shell-') && key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (event.request.mode === 'navigate' && url.pathname.replace(/\/$/, '') === WORKSPACE) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request)
        if (response.ok) return response
        return await (await caches.open(CACHE)).match(WORKSPACE) || response
      } catch {
        return await (await caches.open(CACHE)).match(WORKSPACE) || Response.error()
      }
    })())
  } else if (!url.search && ASSETS.includes(url.pathname)) {
    event.respondWith((async () => await (await caches.open(CACHE)).match(url.pathname) || fetch(event.request))())
  }
})
