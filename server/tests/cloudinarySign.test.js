import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CLOUDINARY_PRODUCT_FOLDER,
  buildCloudinarySignatureString,
  buildProductUploadTarget,
  normalizeUploadSlot,
  readCloudinaryConfig,
  signCloudinaryParams,
} from '../src/lib/cloudinarySign.js'
import { attachAdminSeasonContext } from '../src/middleware/requireAdmin.js'
import { handleAdminUploadSign } from '../src/routes/adminUploads.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const TEST_SECRET = 'test-cloudinary-secret-not-real'
const TEST_KEY = 'test-api-key-not-real'
const TEST_CLOUD = 'test-cloud-name'
const FIXTURE_SIGNATURE = '87e26c64704995a322982ee03863df589d9f1a25'

describe('Cloudinary signature helpers', () => {
  it('builds a deterministic string-to-sign and excludes unsigned fields', () => {
    const str = buildCloudinarySignatureString({
      timestamp: 1700000000,
      folder: 'diwali/products',
      public_id: 'P001/1',
      overwrite: true,
      api_key: TEST_KEY,
      cloud_name: TEST_CLOUD,
      file: 'ignored',
      resource_type: 'image',
    })
    assert.equal(
      str,
      'folder=diwali/products&overwrite=true&public_id=P001/1&timestamp=1700000000',
    )
    assert.equal(str.includes(TEST_SECRET), false)
  })

  it('matches a known SHA-1 fixture and is stable', async () => {
    const params = {
      folder: 'diwali/products',
      overwrite: true,
      public_id: 'P001/1',
      timestamp: 1700000000,
    }
    const signature = await signCloudinaryParams(params, TEST_SECRET)
    assert.equal(signature, FIXTURE_SIGNATURE)
    assert.equal(await signCloudinaryParams(params, TEST_SECRET), FIXTURE_SIGNATURE)
    assert.equal(signature.includes(TEST_SECRET), false)
  })

  it('builds folder and publicId server-side', () => {
    const target = buildProductUploadTarget('P042', 3)
    assert.equal(target.folder, CLOUDINARY_PRODUCT_FOLDER)
    assert.equal(target.publicId, 'P042/3')
  })

  it('normalizes slot to 1–20', () => {
    assert.deepEqual(normalizeUploadSlot(undefined), { ok: true, value: 1 })
    assert.deepEqual(normalizeUploadSlot(20), { ok: true, value: 20 })
    assert.equal(normalizeUploadSlot(0).ok, false)
    assert.equal(normalizeUploadSlot(21).ok, false)
    assert.equal(normalizeUploadSlot(1.5).ok, false)
  })

  it('readCloudinaryConfig fails closed when any binding is missing', () => {
    assert.equal(readCloudinaryConfig({}), null)
    assert.equal(
      readCloudinaryConfig({
        CLOUDINARY_CLOUD_NAME: TEST_CLOUD,
        CLOUDINARY_API_KEY: TEST_KEY,
      }),
      null,
    )
    assert.equal(
      readCloudinaryConfig({
        CLOUDINARY_CLOUD_NAME: TEST_CLOUD,
        CLOUDINARY_API_KEY: TEST_KEY,
        CLOUDINARY_API_SECRET: '   ',
      }),
      null,
    )
    const ok = readCloudinaryConfig({
      CLOUDINARY_CLOUD_NAME: TEST_CLOUD,
      CLOUDINARY_API_KEY: TEST_KEY,
      CLOUDINARY_API_SECRET: TEST_SECRET,
    })
    assert.equal(ok?.cloudName, TEST_CLOUD)
  })
})

describe('POST /api/admin/uploads/sign handler', () => {
  const env = {
    CLOUDINARY_CLOUD_NAME: TEST_CLOUD,
    CLOUDINARY_API_KEY: TEST_KEY,
    CLOUDINARY_API_SECRET: TEST_SECRET,
  }

  for (const mode of [true, 'true', 'TRUE', '1', 1, ' true ', 'invalid']) {
    it(`rejects all signing before body/config/DB access for location mode ${JSON.stringify(mode)}`, async () => {
      for (const payload of [{ productId: 'P001' }, { familyPackId: 'FP001' },
        { product_id: 'P001' }, { family_pack_id: 'FP001' }]) {
        const request = new Request('https://example.com/api/admin/uploads/sign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        request.text = () => assert.fail('Guard must run before reading the body')
        const blockedEnv = {
          ADMIN_LOCATION_MODE: mode,
          get DB() { assert.fail('Guard must run before any database access') },
          get CLOUDINARY_CLOUD_NAME() { assert.fail('Guard must run before Cloudinary configuration/signing') },
          get CLOUDINARY_API_KEY() { assert.fail('Cloudinary configuration must not be read') },
          get CLOUDINARY_API_SECRET() { assert.fail('Signing secret must not be read') },
        }
        const response = await handleAdminUploadSign(request, blockedEnv)
        assert.equal(response.status, 403)
        assert.equal(response.headers.get('Cache-Control'), 'no-store')
        assert.deepEqual(await response.json(), {
          error: 'upload_signing_disabled', message: 'Image upload signing is disabled in location mode.',
        })
      }
    })
  }

  for (const mode of [undefined, '', false, 'false', 0, '0']) {
    it(`preserves legacy product and pack signing with location mode ${JSON.stringify(mode)}`, async () => {
      for (const [payload, table, folder, publicId] of [
        [{ productId: 'P001', slot: 2 }, 'products', 'diwali/products', 'P001/2'],
        [{ familyPackId: 'FP001', slot: 3 }, 'family_packs', 'diwali/family-packs', 'FP001/3'],
      ]) {
        const db = createUploadSignDb()
        const request = new Request('https://example.com/api/admin/uploads/sign', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
          body: JSON.stringify(payload),
        })
        await attachAdminSeasonContext(request, db, { userId: 'admin-u-1', email: 'owner@test.com', role: 'owner' })
        const prepare = db.prepare.bind(db), lookups = []
        db.prepare = sql => {
          const statement = prepare(sql)
          return { bind(...values) { lookups.push({ sql: sql.replace(/\s+/g, ' ').trim(), values }); return statement.bind(...values) } }
        }
        const response = await handleAdminUploadSign(request, { ...env, DB: db, ADMIN_LOCATION_MODE: mode })
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('Cache-Control'), 'no-store')
        const body = await response.json()
        assert.deepEqual(lookups, [{ sql: `SELECT id FROM ${table} WHERE id = ? AND season_id = ?`, values: [payload.productId ?? payload.familyPackId, DEFAULT_ADMIN_SEASON_ID] }])
        assert.deepEqual(Object.keys(body).sort(), ['apiKey', 'cloudName', 'folder', 'publicId', 'signature', 'timestamp'])
        assert.equal(body.cloudName, TEST_CLOUD)
        assert.equal(body.apiKey, TEST_KEY)
        assert.equal(body.folder, folder)
        assert.equal(body.publicId, publicId)
        assert.equal(body.signature, await signCloudinaryParams({ folder, overwrite: true, public_id: publicId, timestamp: body.timestamp }, TEST_SECRET))
        assert.equal(JSON.stringify(body).includes(TEST_SECRET), false)
      }
    })
  }

  it('returns 503 when Cloudinary env is missing', async () => {
    const res = await handleAdminUploadSign(
      new Request('https://example.com/api/admin/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'P001' }),
      }),
      {},
    )
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.error, 'cloudinary_not_configured')
    assert.equal('apiSecret' in body, false)
  })

  it('returns sign fields, ignores client folder/publicId, never returns the secret', async () => {
    const db = createUploadSignDb()
    const request = new Request('https://example.com/api/admin/uploads/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID,
      },
      body: JSON.stringify({ productId: 'P001', slot: 2, folder: 'evil', publicId: 'hacked' }),
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminUploadSign(request, { ...env, DB: db })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.cloudName, TEST_CLOUD)
    assert.equal(body.apiKey, TEST_KEY)
    assert.equal(body.folder, 'diwali/products')
    assert.equal(body.publicId, 'P001/2')
    assert.equal(typeof body.timestamp, 'number')
    assert.match(body.signature, /^[a-f0-9]{40}$/)
    assert.equal(body.apiSecret, undefined)
    assert.equal(JSON.stringify(body).includes(TEST_SECRET), false)

    const expected = await signCloudinaryParams(
      {
        folder: body.folder,
        overwrite: true,
        public_id: body.publicId,
        timestamp: body.timestamp,
      },
      TEST_SECRET,
    )
    assert.equal(body.signature, expected)
  })

  it('returns family pack folder and publicId when familyPackId is provided', async () => {
    const db = createUploadSignDb()
    const request = new Request('https://example.com/api/admin/uploads/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID,
      },
      body: JSON.stringify({ familyPackId: 'FP001', slot: 2 }),
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminUploadSign(request, { ...env, DB: db })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.folder, 'diwali/family-packs')
    assert.equal(body.publicId, 'FP001/2')
  })

  it('returns 403 for family pack upload sign when active season is missing', async () => {
    const db = createUploadSignDb()
    const res = await handleAdminUploadSign(
      new Request('https://example.com/api/admin/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyPackId: 'FP001', slot: 1 }),
      }),
      { ...env, DB: db },
    )
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.equal(body.error, 'forbidden')
  })

  it('returns 403 for family pack upload sign when season membership is missing', async () => {
    const db = createUploadSignDb({ memberships: [] })
    const request = new Request('https://example.com/api/admin/uploads/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID,
      },
      body: JSON.stringify({ familyPackId: 'FP001', slot: 1 }),
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'u-none',
      email: 'none@test.com',
      role: 'owner',
    })
    const res = await handleAdminUploadSign(request, { ...env, DB: db })
    assert.equal(res.status, 403)
  })

  it('returns 403 for family pack upload sign on archived season', async () => {
    const db = createUploadSignDb({
      packSeasonId: 'season-archived',
      memberships: [
        {
          season_id: 'season-archived',
          role: 'owner',
          disabled_at: null,
          created_at: '',
          code: 'arch',
          label: 'Archived',
          status: 'archived',
        },
      ],
    })
    const request = new Request('https://example.com/api/admin/uploads/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Season-Id': 'season-archived',
      },
      body: JSON.stringify({ familyPackId: 'FP001', slot: 1 }),
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminUploadSign(request, { ...env, DB: db })
    assert.equal(res.status, 403)
    assert.match((await res.json()).message, /archived/i)
  })

  it('returns 404 for family pack upload sign when pack is in another season', async () => {
    const db = createUploadSignDb({ packSeasonId: 'season-2099' })
    const request = new Request('https://example.com/api/admin/uploads/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID,
      },
      body: JSON.stringify({ familyPackId: 'FP001', slot: 1 }),
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminUploadSign(request, { ...env, DB: db })
    assert.equal(res.status, 404)
    const body = await res.json()
    assert.equal(body.error, 'not_found')
  })

  it('returns 403 for product upload sign when season membership is missing', async () => {
    const db = createUploadSignDb({ memberships: [] })
    const request = new Request('https://example.com/api/admin/uploads/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID,
      },
      body: JSON.stringify({ productId: 'P001', slot: 1 }),
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'u-none',
      email: 'none@test.com',
      role: 'owner',
    })
    const res = await handleAdminUploadSign(request, { ...env, DB: db })
    assert.equal(res.status, 403)
  })

  it('returns 404 for product upload sign when product is in another season', async () => {
    const db = createUploadSignDb({ productSeasonId: 'season-2099' })
    const request = new Request('https://example.com/api/admin/uploads/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID,
      },
      body: JSON.stringify({ productId: 'P001', slot: 1 }),
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminUploadSign(request, { ...env, DB: db })
    assert.equal(res.status, 404)
    const body = await res.json()
    assert.equal(body.error, 'not_found')
  })

  it('returns 403 for product upload sign on archived season', async () => {
    const db = createUploadSignDb({
      memberships: [
        {
          season_id: 'season-archived',
          role: 'owner',
          disabled_at: null,
          created_at: '',
          code: 'arch',
          label: 'Archived',
          status: 'archived',
        },
      ],
    })
    const request = new Request('https://example.com/api/admin/uploads/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Season-Id': 'season-archived',
      },
      body: JSON.stringify({ productId: 'P001', slot: 1 }),
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminUploadSign(request, { ...env, DB: db })
    assert.equal(res.status, 403)
    assert.match((await res.json()).message, /archived/i)
  })

  it('rejects invalid productId', async () => {
    const res = await handleAdminUploadSign(
      new Request('https://example.com/api/admin/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'bad' }),
      }),
      env,
    )
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.equal(body.error, 'validation_error')
    assert.ok(body.fields.productId)
  })
})

/** @param {{ packSeasonId?: string, productSeasonId?: string, memberships?: Record<string, unknown>[] }} [opts] */
function createUploadSignDb(opts = {}) {
  const packSeasonId = opts.packSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const productSeasonId = opts.productSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const membershipRows =
    opts.memberships ??
    [
      {
        season_id: DEFAULT_ADMIN_SEASON_ID,
        role: 'owner',
        disabled_at: null,
        created_at: '',
        code: '2026',
        label: 'Diwali 2026',
        status: 'active',
      },
      {
        season_id: 'season-2099',
        role: 'owner',
        disabled_at: null,
        created_at: '',
        code: '2099',
        label: 'Other',
        status: 'active',
      },
      {
        season_id: 'season-archived',
        role: 'owner',
        disabled_at: null,
        created_at: '',
        code: 'arch',
        label: 'Archived',
        status: 'archived',
      },
    ]
  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM platform_admins')) {
                return null
              }
              if (normalized.includes('FROM season_members sm')) {
                return null
              }
              if (normalized.includes('FROM family_packs') && normalized.includes('season_id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id === 'FP001' && seasonId === packSeasonId) {
                  return { id: 'FP001' }
                }
                return null
              }
              if (normalized.includes('FROM products') && normalized.includes('season_id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id === 'P001' && seasonId === productSeasonId) {
                  return { id: 'P001' }
                }
                return null
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM season_members sm')) {
                return { results: membershipRows }
              }
              return { results: [] }
            },
          }
        },
      }
    },
  }
}
