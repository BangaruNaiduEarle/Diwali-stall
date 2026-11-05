import { getAdminRequestContext } from './adminSeasonRequest.js'

// Memory only. No bills, payments, sessions or authorization grants enter here.
const entries = new Map()
const MAX_ENTRIES = 40
let epoch = 0
let lastScope = null
const aborted = () => ({ ok: false, status: 0, error: 'aborted', message: 'Request cancelled.' })
const stale = () => ({ ok: false, status: 409, error: 'stale_context', message: 'The selected scope or catalogue changed. Search again.' })

function scopeKey() {
  const scope = getAdminRequestContext()
  if (!scope.identityScope || scope.switching || !scope.activeSeasonId ||
      scope.locationModeEnabled && (!scope.activeBusinessId || !scope.activeLocationId)) return null
  return JSON.stringify([scope.identityScope, scope.activeBusinessId, scope.activeLocationId,
    scope.activeSeasonId, scope.locationModeEnabled, scope.generation])
}

export function invalidateAdminReadCache() {
  epoch += 1
  for (const entry of entries.values()) {
    clearTimeout(entry.abortTimer)
    entry.controller.abort()
  }
  entries.clear()
}

export function cachedAdminRead(path, load, { signal } = {}) {
  const scope = scopeKey()
  if (scope !== lastScope) { invalidateAdminReadCache(); lastScope = scope }
  const pathname = path.split('?')[0]
  const ttl = pathname === '/api/admin/categories' ? 60000
    : pathname === '/api/admin/products' && path.includes('?') ? 2000 : 0
  if (!scope || !ttl) return load(signal)
  if (signal?.aborted) return Promise.resolve(aborted())
  const key = `${scope}:${path}`
  const version = epoch
  let entry = entries.get(key)
  if (entry?.settled && entry.expires <= Date.now()) { entries.delete(key); entry = null }
  if (!entry) {
    entry = { controller: new AbortController(), subscribers: new Set(), settled: false, expires: 0, abortTimer: null }
    const current = entry
    current.promise = Promise.resolve().then(() => load(current.controller.signal)).then(result => {
      current.settled = true
      if (result.ok && version === epoch && scope === scopeKey() && !current.controller.signal.aborted) {
        current.expires = Date.now() + ttl
      } else if (entries.get(key) === current) entries.delete(key)
      return result
    }, () => {
      current.settled = true
      if (entries.get(key) === current) entries.delete(key)
      return aborted()
    })
    entries.set(key, current)
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value
      entries.get(oldest).controller.abort()
      entries.delete(oldest)
    }
  }
  clearTimeout(entry.abortTimer)
  return new Promise(resolve => {
    const subscriber = {}
    entry.subscribers.add(subscriber)
    let finished = false
    const finish = result => {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', cancel)
      entry.subscribers.delete(subscriber)
      if (!entry.settled && entry.subscribers.size === 0) {
        // A same-tick remount can adopt the request before cancellation.
        entry.abortTimer = setTimeout(() => {
          if (!entry.settled && entry.subscribers.size === 0) {
            if (entries.get(key) === entry) entries.delete(key)
            entry.controller.abort()
          }
        }, 0)
      }
      resolve(structuredClone(result))
    }
    const cancel = () => finish(aborted())
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    entry.promise.then(result => finish(!result.ok || version === epoch && scope === scopeKey() ? result : stale()))
  })
}

// Refresh reference/search data when returning from another tab or application.
if (typeof window !== 'undefined') window.addEventListener('focus', invalidateAdminReadCache)
