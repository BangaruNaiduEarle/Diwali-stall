import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { withRequestContext } from '../src/middleware/requestContext.js'
import { isUnsafeMethod } from '../src/middleware/adminRequestSecurity.js'
import { trustedRequestOrigin } from '../src/lib/trustedRequestOrigin.js'
import { parseCorsAllowedOrigins } from '../src/lib/cors.js'
import { readJsonBody, isJsonContentType } from '../src/lib/http.js'
import { hashPassword, verifyPassword } from '../src/lib/passwordHash.js'

const api = 'https://api.test', frontend = 'https://frontend.test'
const cors = { CORS_ALLOWED_ORIGINS: frontend }
const cookie = 'diwali_admin_session=session-valid'
const req = (path, { method = 'POST', origin = frontend, cookies = cookie, type = 'application/json', body, headers = {} } = {}) => new Request(api + path, {
  method, headers: { ...(origin == null ? {} : { Origin: origin }), ...(cookies == null ? {} : { Cookie: cookies }),
    ...(type == null ? {} : { 'Content-Type': type }), ...headers }, ...(body === undefined ? {} : { body }),
})
const bombDb = { prepare() { throw Error('Blocked request reached D1') }, batch() { throw Error('Blocked request reached D1') } }

describe('unsafe request origin boundary', () => {
  it('classifies every method outside GET/HEAD/OPTIONS as unsafe', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) assert.equal(isUnsafeMethod(method), false)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'CONNECT', 'CUSTOM']) assert.equal(isUnsafeMethod(method), true)
  })

  for (const path of ['/api/admin/auth/login', '/api/admin/auth/logout', '/api/admin/auth/bootstrap-owner', '/api/admin/platform/seasons/season-2030/archive', '/api/admin/users/target/reset-password']) {
    it(`blocks hostile simple POST before authentication, body parsing or D1: ${path}`, async () => {
      const request = req(path, { origin: 'https://evil.test', type: 'text/plain', body: '{}' })
      const response = await worker.fetch(request, { ...cors, DB: bombDb }, {})
      assert.equal(response.status, 403); assert.equal((await response.json()).error, 'untrusted_origin')
      assert.equal(request.bodyUsed, false)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
    })
  }

  for (const origin of [null, '', 'null', '*', 'https://frontend.test/path', 'https://frontend.test?x=1', 'https://user:pw@frontend.test', 'https://frontend.test#fragment', 'https://frontend.test, https://evil.test', 'https://frontend.test.evil.test']) {
    it(`rejects missing/invalid/untrusted cookie mutation origin: ${String(origin)}`, async () => {
      const response = await worker.fetch(req('/api/admin/auth/logout', { origin, headers: { 'X-Forwarded-Host': 'frontend.test', Referer: frontend + '/admin' } }), { ...cors, DB: bombDb }, {})
      assert.equal(response.status, 403)
    })
  }

  it('rejects all unsafe cookie methods and does not let token headers bypass cookie precedence', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await worker.fetch(req('/api/admin/platform/seasons/season-2030', { method, origin: null, headers: { 'Cf-Access-Jwt-Assertion': 'not-a-CSRF-exemption' } }), { ...cors, DB: bombDb }, {})
      assert.equal(response.status, 403)
    }
    assert.equal((await worker.fetch(req('/api/admin/auth/logout', { origin: null, cookies: 'diwali_admin_session=%invalid' }), { DB: bombDb }, {})).status, 403)
  })

  it('does not authorize by forwarded headers or accept Origin:null with CORS disabled', async () => {
    const allowed = parseCorsAllowedOrigins(cors)
    assert.equal(trustedRequestOrigin(req('/api/admin/auth/logout', { origin: 'https://evil.test', headers: { 'X-Forwarded-Host': 'frontend.test' } }), allowed), null)
    assert.equal((await worker.fetch(req('/api/admin/auth/logout', { origin: 'null' }), { DB: bombDb }, {})).status, 403)
  })

  it('allows same-origin, configured CORS frontend and proxy origins without requiring selector headers', async () => {
    for (const [origin, headers] of [[api, {}], [frontend, {}], [frontend, { 'X-Forwarded-Host': 'frontend.test' }]]) {
      let calls = 0
      const response = await withRequestContext(req('/api/admin/platform/seasons/season-2030/archive', { origin, headers }), cors, () => { calls++; return Response.json({ ok: true }) })
      assert.equal(response.status, 200); assert.equal(calls, 1)
    }
  })

  it('preserves cookie-free CLI mutations but rejects browser-signalled missing Origin', async () => {
    let calls = 0
    const run = request => withRequestContext(request, cors, () => { calls++; return Response.json({ ok: true }) })
    assert.equal((await run(req('/api/admin/auth/login', { cookies: null, origin: null, body: '{}' }))).status, 200)
    assert.equal((await run(req('/api/admin/auth/login', { cookies: null, origin: null, body: '{}', headers: { 'Sec-Fetch-Site': 'cross-site' } }))).status, 403)
    assert.equal((await run(req('/api/admin/auth/login', { cookies: null, origin: 'https://evil.test', body: '{}' }))).status, 403)
    assert.equal(calls, 1)
  })

  it('preserves GET/HEAD and OPTIONS preflight behavior', async () => {
    let calls = 0
    for (const method of ['GET', 'HEAD']) {
      const response = await withRequestContext(req('/api/admin/session', { method, origin: 'https://evil.test' }), cors, () => { calls++; return new Response(null) })
      assert.equal(response.status, 200)
    }
    const response = await withRequestContext(req('/api/admin/platform/seasons', { method: 'OPTIONS', headers: {
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type, X-Admin-Season-Id, X-Admin-Location-Id',
    } }), cors, () => { throw Error('Preflight executed a route') })
    assert.equal(response.status, 204); assert.equal(calls, 2)
    assert.match(response.headers.get('Access-Control-Allow-Headers'), /X-Admin-Location-Id/)
  })
})

describe('JSON mutation media type', () => {
  for (const type of [null, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/json; charset=latin1', 'application/json, text/plain', 'application/json; charset=utf-8; charset=latin1']) {
    it(`rejects ${String(type)} before route execution and without consuming JSON`, async () => {
      const request = req('/api/admin/auth/login', { type, body: '{"email":"test@test.com"}' })
      const response = await worker.fetch(request, { ...cors, DB: bombDb }, {})
      assert.equal(response.status, 415); assert.equal(request.bodyUsed, false)
      const parsed = await readJsonBody(request)
      assert.equal(parsed.status, 415); assert.equal(request.bodyUsed, false)
    })
  }
  it('accepts JSON with optional UTF-8 charset and preserves invalid/empty/oversized JSON errors', async () => {
    for (const type of ['application/json', 'Application/JSON; charset=UTF-8', 'application/json; charset="utf-8"']) {
      assert.equal(isJsonContentType(type), true)
      assert.deepEqual(await readJsonBody(req('/api/admin/auth/login', { type, body: '{"ok":true}' })), { ok: true, value: { ok: true } })
    }
    assert.equal((await readJsonBody(req('/api/admin/auth/login', { body: '{' }))).error, 'invalid_json')
    assert.equal((await readJsonBody(req('/api/admin/auth/login', { body: '' }))).error, 'invalid_json')
    assert.equal((await readJsonBody(req('/api/admin/auth/login', { body: '12345' }), 2)).status, 413)
  })
  it('permits bodyless platform POST/DELETE actions, but still checks origins', async () => {
    for (const method of ['POST', 'DELETE']) {
      const response = await withRequestContext(req('/api/admin/platform/action', { method, type: null }), cors, () => Response.json({ ok: true }))
      assert.equal(response.status, 200)
    }
  })
})

const password = 'security-test-password'
const passwordHash = await hashPassword(password)

function authDb() {
  const users = new Map(['owner', 'target'].map(id => [id, { id, email: `${id}@test.com`, role: id === 'owner' ? 'owner' : 'admin', disabled_at: null, password_hash: passwordHash }]))
  const sessions = new Map([['session-valid', 'owner'], ['target-one', 'target'], ['target-two', 'target']])
  const season = { id: 'season-2030', code: '2030', label: 'Test season', status: 'active' }
  const db = { users, sessions, season, writes: [], prepare(raw) {
    const sql = raw.replace(/\s+/g, ' ').trim()
    const bind = (...v) => ({
      async first() {
        if (sql.includes('FROM admin_sessions s')) {
          const user = users.get(sessions.get(v[0]))
          return user ? { ...user, session_id: v[0], expires_at: '2099-01-01T00:00:00Z' } : null
        }
        if (sql.includes('FROM admin_users WHERE lower(email)')) return [...users.values()].find(u => u.email === v[0]) ?? null
        if (sql.includes('FROM admin_users WHERE id')) return users.get(v[0]) ?? null
        if (sql.includes('FROM admin_login_attempts')) return { n: 0 }
        if (sql.includes('FROM platform_admins')) return v[0] === 'owner' ? { ok: 1 } : null
        if (sql.includes('FROM business_seasons')) return v[0] === season.id ? { ...season } : null
        throw Error('Unexpected SELECT: ' + sql)
      },
      async all() {
        if (sql.includes('FROM season_members')) return { results: v[0] === 'owner' ? [{ season_id: season.id, role: 'owner', disabled_at: null, ...season }] : [] }
        throw Error('Unexpected list: ' + sql)
      },
      async run() {
        db.writes.push(sql)
        if (sql.startsWith('INSERT INTO admin_sessions')) sessions.set(v[0], v[1])
        else if (sql.startsWith('DELETE FROM admin_sessions WHERE id')) sessions.delete(v[0])
        else if (sql.startsWith('DELETE FROM admin_sessions WHERE admin_user_id')) { for (const [id, user] of sessions) if (user === v[0]) sessions.delete(id) }
        else if (sql.startsWith('UPDATE admin_users SET password_hash')) users.get(v[1]).password_hash = v[0]
        else if (sql.startsWith('UPDATE business_seasons')) season.status = v[0]
        else if (!sql.startsWith('INSERT INTO admin_login_attempts') && !sql.startsWith('UPDATE admin_sessions SET last_seen_at')) throw Error('Unexpected write: ' + sql)
        return { meta: { changes: 1 } }
      },
    })
    return { bind, first: () => bind().first() }
  } }
  return db
}

describe('cookie-authenticated Worker mutations with real route dispatch and mocked D1', () => {
  it('preserves trusted login/logout and rejects hostile login even without an existing cookie', async () => {
    const db = authDb(), env = { ...cors, DB: db }
    const login = await worker.fetch(req('/api/admin/auth/login', { cookies: null, body: JSON.stringify({ email: 'owner@test.com', password }) }), env, {})
    assert.equal(login.status, 200); assert.match(login.headers.get('Set-Cookie'), /SameSite=None/)
    const sessionCookie = login.headers.get('Set-Cookie').split(';')[0]
    const logout = await worker.fetch(req('/api/admin/auth/logout', { cookies: sessionCookie, type: null }), env, {})
    assert.equal(logout.status, 200); assert.ok(!sessionsContainsCookie(db, sessionCookie))
    const before = db.writes.length
    assert.equal((await worker.fetch(req('/api/admin/auth/login', { cookies: null, origin: 'https://evil.test', body: JSON.stringify({ email: 'owner@test.com', password }) }), env, {})).status, 403)
    assert.equal(db.writes.length, before)
  })

  it('permits authorized platform POSTs with no location or season headers', async () => {
    const db = authDb()
    const response = await worker.fetch(req('/api/admin/platform/seasons/season-2030/archive', { type: null }), { DB: db, ...cors }, {})
    assert.equal(response.status, 200); assert.equal(db.season.status, 'archived')
    assert.ok(db.writes.some(sql => sql.startsWith('UPDATE business_seasons')))
  })

  it('preserves owner global password reset and revokes every target session without location headers', async () => {
    const db = authDb()
    const response = await worker.fetch(req('/api/admin/users/target/reset-password', { body: JSON.stringify({ password: 'new-security-password' }) }), { DB: db, ...cors }, {})
    assert.equal(response.status, 200)
    assert.equal(await verifyPassword('new-security-password', db.users.get('target').password_hash), true)
    assert.deepEqual([...db.sessions.keys()], ['session-valid'])
  })

  it('rejects hostile or missing origins before even session last-seen updates', async () => {
    const db = authDb()
    for (const origin of [null, 'https://evil.test', 'null']) {
      const response = await worker.fetch(req('/api/admin/platform/seasons/season-2030/archive', { origin, type: null }), { DB: db, ...cors }, {})
      assert.equal(response.status, 403)
    }
    assert.deepEqual(db.writes, []); assert.equal(db.season.status, 'active')
  })

  it('does not grant authentication or platform permissions merely because Origin is trusted', async () => {
    const db = authDb(), env = { DB: db, ...cors }
    const nonPlatform = await worker.fetch(req('/api/admin/platform/seasons/season-2030/archive', { cookies: 'diwali_admin_session=target-one', type: null }), env, {})
    assert.equal(nonPlatform.status, 403)
    const unknown = await worker.fetch(req('/api/admin/platform/seasons/season-2030/archive', { cookies: 'diwali_admin_session=not-a-session', type: null }), env, {})
    assert.equal(unknown.status, 401)
    assert.equal(db.season.status, 'active')
    assert.ok(db.writes.every(sql => sql.startsWith('UPDATE admin_sessions SET last_seen_at')))
  })
})

function sessionsContainsCookie(db, cookie) {
  return db.sessions.has(cookie.slice(cookie.indexOf('=') + 1))
}
