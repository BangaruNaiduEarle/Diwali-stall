import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerOfflineDevice, fetchOfflineCatalogue, sendOfflineOperation } from './adminOffline.js'
import { clearAdminActiveSeasonId, setAdminActiveSeasonId, setAdminLocationSelection } from './adminSeasonRequest.js'

test('offline API transport keeps immutable operation data and attaches only the selected scope and current session cookies', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original; clearAdminActiveSeasonId() })
  setAdminActiveSeasonId('season-2026'); setAdminLocationSelection({ locationModeEnabled: true, activeLocationId: 'a', activeBusinessId: 'shop' })
  const payload = { operationId: 'offline-payment-1', kind: 'PAYMENT', scope: { locationId: 'b' }, occurredAt: '2026-11-01T12:00:00.000Z', body: { amountPaise: 1234, recordingMode: 'OFFLINE', paymentMethod: 'CASH' } }
  globalThis.fetch = async (url, init) => {
    assert.ok(url.endsWith('/offline/sync')); assert.equal(init.credentials, 'include')
    assert.equal(new Headers(init.headers).get('X-Admin-Location-Id'), 'a', 'payload never chooses authorization headers')
    assert.equal(new Headers(init.headers).get('X-Admin-Season-Id'), 'season-2026')
    assert.deepEqual(JSON.parse(init.body), payload)
    return Response.json({ ok: true, operationId: payload.operationId, revision: 9, requestId: 'request-1' })
  }
  assert.equal((await sendOfflineOperation(payload)).revision, 9)
})

test('device registration contains no authentication token cache and catalogue failures remain explicit', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (url, init) => {
    assert.deepEqual(JSON.parse(init.body), { deviceId: 'device-1', deviceToken: 'secret' })
    return Response.json({ ok: true })
  }
  assert.equal((await registerOfflineDevice({ deviceId: 'device-1', deviceToken: 'secret', sessionCookie: 'must-not-store' })).ok, true)
  globalThis.fetch = async () => Response.json({ error: 'unauthorized', message: 'Sign in required.' }, { status: 401 })
  assert.equal((await fetchOfflineCatalogue()).status, 401)
})
