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
import { handleAdminUploadSign } from '../src/routes/adminUploads.js'

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
    const res = await handleAdminUploadSign(
      new Request('https://example.com/api/admin/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'P001', slot: 2, folder: 'evil', publicId: 'hacked' }),
      }),
      env,
    )
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
