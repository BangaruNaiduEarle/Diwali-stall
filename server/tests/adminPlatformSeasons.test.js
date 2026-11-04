import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const PLATFORM_EMAIL = 'platform@example.com'

describe('Platform Admin business seasons API', () => {
  it('lists seasons for platform admin', async () => {
    const db = createSeasonApiDb()
    const res = await platformFetch(db, 'GET', '/api/admin/platform/seasons')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.seasons.some((s) => s.id === DEFAULT_ADMIN_SEASON_ID))
    assert.equal(db.platformSettingsTouched, 0)
  })

  it('creates a new active season without changing platform_settings', async () => {
    const db = createSeasonApiDb()
    const res = await platformFetch(db, 'POST', '/api/admin/platform/seasons', {
      id: 'season-2030',
      code: '2030',
      label: 'Diwali 2030',
    })
    assert.equal(res.status, 201)
    const body = await res.json()
    assert.equal(body.season.id, 'season-2030')
    assert.equal(body.season.status, 'active')
    assert.equal(db.seasons.get('season-2030')?.label, 'Diwali 2030')
    assert.equal(db.platformSettingsTouched, 0)
    assert.equal(db.seasonMembersInserted, 0)
  })

  it('returns 409 for duplicate season id', async () => {
    const db = createSeasonApiDb()
    const res = await platformFetch(db, 'POST', '/api/admin/platform/seasons', {
      id: DEFAULT_ADMIN_SEASON_ID,
      code: 'other',
      label: 'Duplicate',
    })
    assert.equal(res.status, 409)
  })

  it('returns 409 for duplicate season code', async () => {
    const db = createSeasonApiDb()
    const res = await platformFetch(db, 'POST', '/api/admin/platform/seasons', {
      id: 'season-new',
      code: '2026',
      label: 'Duplicate code',
    })
    assert.equal(res.status, 409)
  })

  it('gets season details and returns 404 when missing', async () => {
    const db = createSeasonApiDb()
    const okRes = await platformFetch(db, 'GET', `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}`)
    assert.equal(okRes.status, 200)
    const okBody = await okRes.json()
    assert.equal(okBody.season.code, '2026')

    const missing = await platformFetch(db, 'GET', '/api/admin/platform/seasons/season-missing')
    assert.equal(missing.status, 404)
  })

  it('patches metadata and archives then reactivates', async () => {
    const db = createSeasonApiDb()
    const patchRes = await platformFetch(db, 'PATCH', `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}`, {
      label: 'Diwali 2026 Updated',
    })
    assert.equal(patchRes.status, 200)
    assert.equal(db.seasons.get(DEFAULT_ADMIN_SEASON_ID)?.label, 'Diwali 2026 Updated')
    assert.equal(db.seasons.get(DEFAULT_ADMIN_SEASON_ID)?.status, 'active')

    const archiveRes = await platformFetch(
      db,
      'POST',
      `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/archive`,
    )
    assert.equal(archiveRes.status, 200)
    assert.equal(db.seasons.get(DEFAULT_ADMIN_SEASON_ID)?.status, 'archived')

    const reactivateRes = await platformFetch(
      db,
      'POST',
      `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/reactivate`,
    )
    assert.equal(reactivateRes.status, 200)
    assert.equal(db.seasons.get(DEFAULT_ADMIN_SEASON_ID)?.status, 'active')
  })

  it('forbids non-platform admin from season APIs', async () => {
    const db = createSeasonApiDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'owner@example.com' },
      { email: 'owner@example.com' },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/platform/seasons', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db, 'owner@example.com'),
      {},
    )
    assert.equal(res.status, 403)
  })
})

/**
 * @param {ReturnType<typeof createSeasonApiDb>} db
 * @param {string} method
 * @param {string} path
 * @param {Record<string, unknown>} [jsonBody
 */
async function platformFetch(db, method, path, jsonBody) {
  const token = await signLocalDevAdminJwt(
    { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: PLATFORM_EMAIL },
    { email: PLATFORM_EMAIL },
  )
  const init = /** @type {RequestInit} */ ({
    method,
    headers: {
      'Cf-Access-Jwt-Assertion': token,
      ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (jsonBody) init.body = JSON.stringify(jsonBody)
  return worker.fetch(new Request(`http://127.0.0.1${path}`, init), localEnv(db, PLATFORM_EMAIL), {})
}

function localEnv(db, email) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: email,
  }
}

function createSeasonApiDb() {
  /** @type {Map<string, { id: string, code: string, label: string, status: string, created_at: string, updated_at: string }>} */
  const seasons = new Map([
    [
      DEFAULT_ADMIN_SEASON_ID,
      {
        id: DEFAULT_ADMIN_SEASON_ID,
        code: '2026',
        label: 'Diwali 2026',
        status: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  ])

  const users = new Map([
    [
      PLATFORM_EMAIL,
      {
        id: 'u-platform',
        email: PLATFORM_EMAIL,
        display_name: 'Platform',
        role: 'admin',
        password_hash: 'x',
        disabled_at: null,
      },
    ],
    [
      'owner@example.com',
      {
        id: 'u-owner',
        email: 'owner@example.com',
        display_name: 'Owner',
        role: 'owner',
        password_hash: 'x',
        disabled_at: null,
      },
    ],
  ])

  const db = {
    seasons,
    platformSettingsTouched: 0,
    seasonMembersInserted: 0,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()

      /** @param {unknown[]} params */
      function stmt(params) {
        return {
          async first() {
              if (normalized.includes('FROM platform_admins')) {
                return String(params[0]) === 'u-platform' ? { ok: 1 } : null
              }
              if (normalized.includes('FROM business_seasons WHERE id = ?')) {
                return seasons.get(String(params[0])) ?? null
              }
              if (normalized.includes('FROM business_seasons WHERE code = ? AND id !=')) {
                for (const s of seasons.values()) {
                  if (s.code === String(params[0]) && s.id !== String(params[1])) return { id: s.id }
                }
                return null
              }
              if (normalized.includes('FROM business_seasons WHERE code = ?')) {
                for (const s of seasons.values()) {
                  if (s.code === String(params[0])) return { id: s.id }
                }
                return null
              }
              if (normalized.includes('FROM admin_users WHERE lower(email)')) {
                const u = users.get(String(params[0]).toLowerCase())
                return u ? { ...u } : null
              }
              if (normalized.includes('FROM platform_settings')) {
                db.platformSettingsTouched += 1
                return { public_catalogue_season_id: DEFAULT_ADMIN_SEASON_ID }
              }
              if (normalized.includes('FROM season_members')) {
                return { results: [] }
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM business_seasons')) {
                return {
                  results: [...seasons.values()].sort((a, b) =>
                    a.created_at.localeCompare(b.created_at),
                  ),
                }
              }
              return { results: [] }
            },
            async run() {
              if (normalized.startsWith('INSERT INTO business_seasons')) {
                const id = String(params[0])
                if (seasons.has(id)) {
                  throw new Error('UNIQUE constraint failed: business_seasons.id')
                }
                for (const s of seasons.values()) {
                  if (s.code === String(params[1])) {
                    throw new Error('UNIQUE constraint failed: business_seasons.code')
                  }
                }
                const now = new Date().toISOString()
                seasons.set(id, {
                  id,
                  code: String(params[1]),
                  label: String(params[2]),
                  status: 'active',
                  created_at: now,
                  updated_at: now,
                })
              }
              if (normalized.startsWith('UPDATE business_seasons') && normalized.includes('SET code =')) {
                const row = seasons.get(String(params[2]))
                if (row) {
                  row.code = String(params[0])
                  row.label = String(params[1])
                  row.updated_at = new Date().toISOString()
                }
              }
              if (normalized.startsWith('UPDATE business_seasons') && normalized.includes('SET status =')) {
                const row = seasons.get(String(params[1]))
                if (row) {
                  row.status = String(params[0])
                  row.updated_at = new Date().toISOString()
                }
              }
              if (normalized.startsWith('INSERT INTO season_members')) {
                db.seasonMembersInserted += 1
              }
              if (normalized.includes('UPDATE platform_settings')) {
                db.platformSettingsTouched += 1
              }
              return { meta: { changes: 1 } }
            },
        }
      }

      const base = stmt([])
      return {
        bind(...params) {
          return stmt(params)
        },
        first: () => base.first(),
        all: () => base.all(),
        run: () => base.run(),
      }
    },
  }
  return db
}
