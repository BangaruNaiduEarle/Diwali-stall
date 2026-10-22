import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { hashPassword, verifyPassword, validatePasswordPolicy } from '../src/lib/passwordHash.js'
import { ADMIN_SESSION_COOKIE } from '../src/lib/adminSessionCookie.js'
import { resolveSessionIdentity } from '../src/services/adminPasswordAuth.js'

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    assert.match(hash, /^pbkdf2_sha256\$100000\$/)
    assert.equal(await verifyPassword('correct horse battery staple', hash), true)
    assert.equal(await verifyPassword('wrong', hash), false)
  })

  it('enforces minimum password length', () => {
    assert.ok(validatePasswordPolicy('short'))
    assert.equal(validatePasswordPolicy('twelvechars1'), null)
  })
})

describe('admin password auth HTTP', () => {
  const BOOTSTRAP = 'bootstrap-secret-minimum-32-characters-long!!'
  const env = {
    DB: createAuthDb(),
    ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP,
  }

  it('bootstrap owner then login sets session cookie', async () => {
    const bootstrap = await worker.fetch(
      new Request('https://api.example.com/api/admin/auth/bootstrap-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@stall.test',
          password: 'stall-password-12',
          bootstrapSecret: BOOTSTRAP,
        }),
      }),
      env,
      {},
    )
    assert.equal(bootstrap.status, 201)

    const loginRes = await worker.fetch(
      new Request('https://api.example.com/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@stall.test', password: 'stall-password-12' }),
      }),
      env,
      {},
    )
    assert.equal(loginRes.status, 200)
    const setCookie = loginRes.headers.get('Set-Cookie') ?? ''
    assert.ok(setCookie.includes(`${ADMIN_SESSION_COOKIE}=`))

    const sessionRes = await worker.fetch(
      new Request('https://api.example.com/api/admin/session', {
        headers: { Cookie: setCookie.split(';')[0] },
      }),
      env,
      {},
    )
    assert.equal(sessionRes.status, 200)
    const body = await sessionRes.json()
    assert.equal(body.email, 'owner@stall.test')
    assert.equal(body.role, 'owner')
  })

  it('logout clears session cookie and invalidates server session', async () => {
    const loginRes = await worker.fetch(
      new Request('https://api.example.com/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@stall.test', password: 'stall-password-12' }),
      }),
      env,
      {},
    )
    assert.equal(loginRes.status, 200)
    const setCookie = loginRes.headers.get('Set-Cookie') ?? ''
    const sessionCookie = setCookie.split(';')[0]

    const logoutRes = await worker.fetch(
      new Request('https://api.example.com/api/admin/auth/logout', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
      }),
      env,
      {},
    )
    assert.equal(logoutRes.status, 200)
    const clearCookie = logoutRes.headers.get('Set-Cookie') ?? ''
    assert.ok(clearCookie.includes(`${ADMIN_SESSION_COOKIE}=`))
    assert.match(clearCookie, /Max-Age=0/)
    assert.match(clearCookie, /Path=\//)

    const sessionRes = await worker.fetch(
      new Request('https://api.example.com/api/admin/session', {
        headers: { Cookie: sessionCookie },
      }),
      env,
      {},
    )
    assert.equal(sessionRes.status, 401)
  })

  it('logout without active session still returns success and clear-cookie header', async () => {
    const logoutRes = await worker.fetch(
      new Request('https://api.example.com/api/admin/auth/logout', { method: 'POST' }),
      env,
      {},
    )
    assert.equal(logoutRes.status, 200)
    const body = await logoutRes.json()
    assert.equal(body.ok, true)
    const clearCookie = logoutRes.headers.get('Set-Cookie') ?? ''
    assert.ok(clearCookie.includes(`${ADMIN_SESSION_COOKIE}=`))
    assert.match(clearCookie, /Max-Age=0/)
  })

  it('logout via frontend proxy clears cookie with SameSite=Lax', async () => {
    const proxyEnv = {
      ...env,
      CORS_ALLOWED_ORIGINS: 'https://diwali-stall.vercel.app',
    }
    const loginRes = await worker.fetch(
      new Request('https://diwali-api.example.workers.dev/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'diwali-stall.vercel.app',
        },
        body: JSON.stringify({ email: 'owner@stall.test', password: 'stall-password-12' }),
      }),
      proxyEnv,
      {},
    )
    const sessionCookie = (loginRes.headers.get('Set-Cookie') ?? '').split(';')[0]

    const logoutRes = await worker.fetch(
      new Request('https://diwali-api.example.workers.dev/api/admin/auth/logout', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'X-Forwarded-Host': 'diwali-stall.vercel.app',
        },
      }),
      proxyEnv,
      {},
    )
    assert.equal(logoutRes.status, 200)
    const clearCookie = logoutRes.headers.get('Set-Cookie') ?? ''
    assert.match(clearCookie, /SameSite=Lax/)
    assert.doesNotMatch(clearCookie, /SameSite=None/)
  })

  it('login via frontend proxy uses SameSite=Lax session cookie', async () => {
    const proxyEnv = {
      ...env,
      CORS_ALLOWED_ORIGINS: 'https://diwali-stall.vercel.app',
    }
    const loginRes = await worker.fetch(
      new Request('https://diwali-api.example.workers.dev/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'diwali-stall.vercel.app',
        },
        body: JSON.stringify({ email: 'owner@stall.test', password: 'stall-password-12' }),
      }),
      proxyEnv,
      {},
    )
    assert.equal(loginRes.status, 200)
    const setCookie = loginRes.headers.get('Set-Cookie') ?? ''
    assert.match(setCookie, /SameSite=Lax/)
    assert.doesNotMatch(setCookie, /SameSite=None/)
  })

  it('resolveSessionIdentity rejects disabled accounts', async () => {
    const db = createAuthDb()
    const userId = 'admin-disabled-test'
    await db
      .prepare(
        `INSERT INTO admin_users (id, email, display_name, role, password_hash)
         VALUES (?, ?, ?, 'admin', ?)`,
      )
      .bind(userId, 'disabled@stall.test', 'Disabled', 'pbkdf2_sha256$210000$abc$abc')
      .run()
    const sessionId = 'sess-disabled-1'
    await db
      .prepare('INSERT INTO admin_sessions (id, admin_user_id, expires_at) VALUES (?, ?, ?)')
      .bind(sessionId, userId, new Date(Date.now() + 3600000).toISOString())
      .run()
    const users = /** @type {Map<string, Record<string, unknown>>} */ (db.__users)
    users.get(userId).disabled_at = new Date().toISOString()
    const identity = await resolveSessionIdentity(db, sessionId)
    assert.equal(identity, null)
  })

  it('rejects bootstrap when owner password already exists', async () => {
    const res = await worker.fetch(
      new Request('https://api.example.com/api/admin/auth/bootstrap-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'other@stall.test',
          password: 'stall-password-12',
          bootstrapSecret: BOOTSTRAP,
        }),
      }),
      env,
      {},
    )
    assert.equal(res.status, 409)
  })
})

function createAuthDb() {
  /** @type {Map<string, Record<string, unknown>>} */
  const users = new Map()
  /** @type {Map<string, { userId: string, expiresAt: string }>} */
  const sessions = new Map()
  let bootstrapComplete = false

  /** @param {string} sql @param {unknown[]} args */
  function handlers(sql, args) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    return {
      async first() {
        if (normalized.includes('FROM admin_users WHERE lower(email)')) {
          const email = String(args[0]).toLowerCase()
          for (const row of users.values()) {
            if (String(row.email).toLowerCase() === email) return row
          }
          return null
        }
        if (normalized.includes('FROM admin_users WHERE id =')) {
          return users.get(String(args[0])) ?? null
        }
        if (normalized.includes('FROM admin_sessions s')) {
          const session = sessions.get(String(args[0]))
          if (!session) return null
          const user = users.get(session.userId)
          if (!user) return null
          return {
            session_id: String(args[0]),
            expires_at: session.expiresAt,
            id: user.id,
            email: user.email,
            role: user.role,
            disabled_at: user.disabled_at,
            password_hash: user.password_hash,
          }
        }
        if (normalized.includes('FROM admin_owner_bootstrap')) {
          return bootstrapComplete ? { singleton_id: 1 } : null
        }
        if (normalized.includes('COUNT(*)') && normalized.includes('admin_login_attempts')) {
          return { n: 0 }
        }
        return null
      },
      async run() {
        if (normalized.startsWith('INSERT INTO admin_owner_bootstrap')) {
          if (bootstrapComplete) {
            throw new Error('UNIQUE constraint failed: admin_owner_bootstrap.singleton_id')
          }
          bootstrapComplete = true
        }
        if (normalized.startsWith('INSERT INTO admin_users')) {
          const id = String(args[0])
          if (args.length >= 5) {
            users.set(id, {
              id,
              email: args[1],
              display_name: args[2],
              role: args[3],
              password_hash: args[4],
              disabled_at: null,
            })
          } else {
            const role = normalized.includes("'owner'") ? 'owner' : 'admin'
            users.set(id, {
              id,
              email: args[1],
              display_name: args[2],
              role,
              password_hash: args[3],
              disabled_at: null,
            })
          }
        }
        if (normalized.startsWith('UPDATE admin_users')) {
          const id = String(args[2])
          const existing = users.get(id) ?? { id, email: '', display_name: '', role: 'owner', disabled_at: null }
          users.set(id, {
            ...existing,
            role: 'owner',
            password_hash: args[0],
            display_name: args[1],
            disabled_at: null,
          })
        }
        if (normalized.startsWith('INSERT INTO admin_sessions')) {
          sessions.set(String(args[0]), {
            userId: String(args[1]),
            expiresAt: String(args[2] || new Date(Date.now() + 86400000).toISOString()),
          })
        }
        if (normalized.startsWith('DELETE FROM admin_sessions WHERE id =')) {
          sessions.delete(String(args[0]))
        }
        return { success: true }
      },
      async all() {
        return { results: [] }
      },
    }
  }

  const db = {
    __users: users,
    prepare(sql) {
      const stmt = handlers(sql, [])
      return {
        bind(...args) {
          return handlers(sql, args)
        },
        first: () => stmt.first(),
        run: () => stmt.run(),
        all: () => stmt.all(),
      }
    },
    async batch(statements) {
      const usersBefore = new Map(users)
      const lockBefore = bootstrapComplete
      try {
        for (const statement of statements) {
          await statement.run()
        }
      } catch (err) {
        users.clear()
        for (const [key, value] of usersBefore) users.set(key, value)
        bootstrapComplete = lockBefore
        throw err
      }
    },
  }
  return db
}
