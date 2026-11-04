import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const PLATFORM_EMAIL = 'platform@example.com'
const OTHER_ACTIVE_SEASON = 'season-2030'
const ARCHIVED_SEASON = 'season-archived'
const SETTING_PATH = '/api/admin/platform/settings/public-catalogue-season'

describe('Platform Admin public catalogue season setting API', () => {
  it('returns current public_catalogue_season_id', async () => {
    const db = createPublicCatalogueSettingDb()
    const res = await platformFetch(db, 'GET', SETTING_PATH)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.publicCatalogueSeasonId, DEFAULT_ADMIN_SEASON_ID)
  })

  it('updates public_catalogue_season_id to another active season', async () => {
    const db = createPublicCatalogueSettingDb()
    const res = await platformFetch(db, 'PATCH', SETTING_PATH, {
      publicCatalogueSeasonId: OTHER_ACTIVE_SEASON,
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.publicCatalogueSeasonId, OTHER_ACTIVE_SEASON)
    assert.equal(db.publicCatalogueSeasonId, OTHER_ACTIVE_SEASON)
    assert.equal(db.lastUpdatedByEmail, PLATFORM_EMAIL)
    assert.equal(db.seasonMembersInserted ?? 0, 0)
  })

  it('returns 400 for missing or invalid season id in body', async () => {
    const db = createPublicCatalogueSettingDb()
    const empty = await platformFetch(db, 'PATCH', SETTING_PATH, { publicCatalogueSeasonId: '  ' })
    assert.equal(empty.status, 400)
    assert.equal((await empty.json()).error, 'validation_error')
  })

  it('returns 404 when season does not exist', async () => {
    const db = createPublicCatalogueSettingDb()
    const res = await platformFetch(db, 'PATCH', SETTING_PATH, {
      publicCatalogueSeasonId: 'season-missing',
    })
    assert.equal(res.status, 404)
    assert.equal(db.publicCatalogueSeasonId, DEFAULT_ADMIN_SEASON_ID)
  })

  it('returns 400 when season is archived', async () => {
    const db = createPublicCatalogueSettingDb()
    const res = await platformFetch(db, 'PATCH', SETTING_PATH, {
      publicCatalogueSeasonId: ARCHIVED_SEASON,
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.equal(body.error, 'validation_error')
    assert.match(body.message, /active/i)
    assert.equal(db.publicCatalogueSeasonId, DEFAULT_ADMIN_SEASON_ID)
  })

  it('forbids non-platform admin', async () => {
    const db = createPublicCatalogueSettingDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'owner@example.com' },
      { email: 'owner@example.com' },
    )
    const res = await worker.fetch(
      new Request(`http://127.0.0.1${SETTING_PATH}`, {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db, 'owner@example.com'),
      {},
    )
    assert.equal(res.status, 403)
  })
})

/**
 * @param {ReturnType<typeof createPublicCatalogueSettingDb>} db
 * @param {string} method
 * @param {string} path
 * @param {Record<string, unknown>} [jsonBody]
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

/** @param {ReturnType<typeof createPublicCatalogueSettingDb>} db @param {string} email */
function localEnv(db, email) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: email,
  }
}

function createPublicCatalogueSettingDb() {
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
    [
      OTHER_ACTIVE_SEASON,
      {
        id: OTHER_ACTIVE_SEASON,
        code: '2030',
        label: 'Diwali 2030',
        status: 'active',
        created_at: '2030-01-01T00:00:00.000Z',
        updated_at: '2030-01-01T00:00:00.000Z',
      },
    ],
    [
      ARCHIVED_SEASON,
      {
        id: ARCHIVED_SEASON,
        code: 'archived',
        label: 'Archived',
        status: 'archived',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
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
    publicCatalogueSeasonId: DEFAULT_ADMIN_SEASON_ID,
    lastUpdatedByEmail: /** @type {string | null} */ (null),
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
            if (normalized.includes('FROM admin_users WHERE lower(email)')) {
              const u = users.get(String(params[0]).toLowerCase())
              return u ? { ...u } : null
            }
            if (normalized.includes('FROM platform_settings') && normalized.includes('public_catalogue_season_id')) {
              return { public_catalogue_season_id: db.publicCatalogueSeasonId }
            }
            return null
          },
          async all() {
            return { results: [] }
          },
          async run() {
            if (normalized.includes('UPDATE platform_settings') && normalized.includes('public_catalogue_season_id')) {
              db.publicCatalogueSeasonId = String(params[0])
              db.lastUpdatedByEmail = params[1] != null ? String(params[1]) : null
            }
            if (normalized.startsWith('INSERT INTO season_members')) {
              db.seasonMembersInserted += 1
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
