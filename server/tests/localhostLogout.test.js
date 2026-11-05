import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { workflowDb } from './helpers/workflowSqlite.js'
import worker from '../src/index.js'
import { hashPassword } from '../src/lib/passwordHash.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { ADMIN_SESSION_COOKIE, ADMIN_DEV_JWT_SUPPRESS_COOKIE } from '../src/lib/adminSessionCookie.js'
import { fetchAdminSession, loginAdmin, logoutAdmin } from '../../src/admin/api/adminApi.js'
import { clearAdminActiveSeasonId, getAdminRequestContext, setAdminActiveSeasonId, setAdminLocationSelection } from '../../src/admin/api/adminSeasonRequest.js'
import { openOfflineStorage } from '../../src/admin/offline/storage.js'

test('localhost logout survives HTTP empty-body normalization, blocks JWT re-login, retains pending work and permits another user', async t => {
  const db = await workflowDb(t)
  const original = { fetch: globalThis.fetch, indexedDB: globalThis.indexedDB }
  globalThis.indexedDB = new IDBFactory()
  clearAdminActiveSeasonId()
  t.after(() => { globalThis.fetch = original.fetch; globalThis.indexedDB = original.indexedDB; clearAdminActiveSeasonId() })
  const env = { DB: db, ADMIN_LOCATION_MODE: '1', ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: 'disposable-local-test-secret-at-least-32-characters' }
  const password = 'disposable-password-for-test'
  const hash = await hashPassword(password)
  for (const user of ['owner', 'super']) await db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').bind(hash, user).run()
  const jwt = await signLocalDevAdminJwt(env, { email: 'owner@test.com' })
  const jar = new Map()
  const receivedCookies = []
  globalThis.fetch = async (path, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Origin', 'http://localhost:5173')
    headers.set('Cf-Access-Jwt-Assertion', jwt)
    headers.set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
    const method = init.method ?? 'GET'
    // Wrangler receives a stream for an HTTP POST even with Content-Length: 0.
    const request = new Request('http://localhost:5173' + path, { ...init, headers,
      ...(method === 'POST' ? { body: init.body ?? '' } : {}) })
    const response = await worker.fetch(request, env, {})
    for (const cookie of response.headers.getSetCookie()) {
      receivedCookies.push(cookie)
      const [name, value] = cookie.split(';')[0].split('=')
      if (/Max-Age=0(?:;|$)/.test(cookie)) jar.delete(name)
      else jar.set(name, value)
    }
    return response
  }

  assert.equal((await globalThis.fetch('/api/admin/auth/logout', { method: 'POST' })).status, 415)
  assert.equal(receivedCookies.length, 0, 'rejected logout cannot clear cookies or suppress JWT')
  assert.equal((await fetchAdminSession()).email, 'owner@test.com', 'proxy JWT authenticates before logout')
  assert.equal((await loginAdmin({ email: 'owner@test.com', password })).ok, true)
  const oldSession = jar.get(ADMIN_SESSION_COOKIE)
  assert.ok(oldSession)
  setAdminActiveSeasonId('season-2026')
  setAdminLocationSelection({ locationModeEnabled: true, activeLocationId: 'loc-a', activeBusinessId: 'shop' })
  const storage = await openOfflineStorage()
  t.after(() => storage.close())
  const scope = { businessId: 'shop', locationId: 'loc-a', seasonId: 'season-2026', userId: 'owner', deviceId: 'test-device' }
  const profile = { scope, role: 'owner', writable: true }
  await storage.activate(profile, [])
  const body = { customer: { name: 'Pending customer', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 1 }] }
  await storage.saveDraft(scope, { draftId: 'retained', body }, { kind: 'CREATE', body })
  const retained = async () => ({ drafts: await storage.list('drafts', scope), versions: await storage.list('versions', scope),
    outbox: await storage.list('outbox', scope), profile: await storage.get('profiles', scope, 'profile') })
  const before = await retained()
  assert.equal(before.outbox.length, 1)

  assert.equal((await logoutAdmin()).ok, true)
  // The provider resets request context and only the offline active-profile pointer.
  clearAdminActiveSeasonId()
  await storage.clearActiveProfile()
  assert.equal(await storage.activeProfile(), null)
  assert.deepEqual(await retained(), before)
  assert.equal(getAdminRequestContext().activeLocationId, null)
  assert.equal(jar.has(ADMIN_SESSION_COOKIE), false)
  assert.equal(jar.get(ADMIN_DEV_JWT_SUPPRESS_COOKIE), '1')
  assert.equal(await db.prepare('SELECT id FROM admin_sessions WHERE id = ?').bind(oldSession).first(), null)
  // Refresh has no React state and keeps only browser cookies plus the injected JWT.
  assert.equal((await fetchAdminSession()).status, 401)
  assert.equal((await fetchAdminSession()).status, 401)

  assert.equal((await loginAdmin({ email: 'super@test.com', password: 'incorrect' })).ok, false)
  assert.equal((await fetchAdminSession()).status, 401)
  assert.equal((await loginAdmin({ email: 'super@test.com', password })).ok, true)
  const next = await fetchAdminSession()
  assert.equal(next.ok, true)
  assert.equal(next.email, 'super@test.com', 'password session takes priority over the previous user proxy JWT')
  assert.notEqual(jar.get(ADMIN_SESSION_COOKIE), oldSession)
  assert.deepEqual(await retained(), before, 'another user cannot overwrite the previous user pending work')
  assert.equal(await storage.activeProfile(), null)
})
