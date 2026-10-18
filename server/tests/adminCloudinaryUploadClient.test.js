import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseCloudinaryUploadResponse,
  parseUploadSignResponse,
  validateCloudinaryDeliveryUrl,
} from '../../src/admin/lib/cloudinaryUpload.js'

const CLOUD = 'test-cloud-name'

describe('admin Cloudinary upload client helpers', () => {
  it('parseUploadSignResponse accepts documented sign fields only', () => {
    const parsed = parseUploadSignResponse({
      cloudName: CLOUD,
      apiKey: 'key123',
      timestamp: 1700000000,
      signature: 'a'.repeat(40),
      folder: 'diwali/products',
      publicId: 'P001/2',
      apiSecret: 'must-not-appear',
    })
    assert.equal(parsed.ok, true)
    if (parsed.ok) {
      assert.equal(parsed.sign.publicId, 'P001/2')
      assert.equal(parsed.sign.folder, 'diwali/products')
      assert.equal('apiSecret' in parsed.sign, false)
    }
  })

  it('parseUploadSignResponse rejects incomplete sign payloads', () => {
    assert.equal(parseUploadSignResponse(null).ok, false)
    assert.equal(parseUploadSignResponse({ cloudName: CLOUD }).ok, false)
    assert.equal(
      parseUploadSignResponse({
        cloudName: CLOUD,
        apiKey: 'k',
        timestamp: 1,
        signature: 'not-hex',
        folder: 'f',
        publicId: 'P1/1',
      }).ok,
      false,
    )
  })

  it('validateCloudinaryDeliveryUrl binds host and cloud name path', () => {
    const ok = validateCloudinaryDeliveryUrl(
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/diwali/products/P001/1.webp`,
      CLOUD,
    )
    assert.equal(ok.ok, true)

    assert.equal(
      validateCloudinaryDeliveryUrl(
        'https://evil.example/image/upload/x',
        CLOUD,
      ).ok,
      false,
    )
    assert.equal(
      validateCloudinaryDeliveryUrl(
        `https://res.cloudinary.com/other-cloud/image/upload/v1/x.webp`,
        CLOUD,
      ).ok,
      false,
    )
  })

  it('parseCloudinaryUploadResponse reads secure_url and rejects errors', () => {
    const ok = parseCloudinaryUploadResponse(
      {
        secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/diwali/products/P002/1.webp`,
        public_id: 'diwali/products/P002/1',
      },
      CLOUD,
    )
    assert.equal(ok.ok, true)
    if (ok.ok) assert.match(ok.secureUrl, /^https:\/\//)

    const err = parseCloudinaryUploadResponse({ error: { message: 'Invalid' } }, CLOUD)
    assert.equal(err.ok, false)
    if (!err.ok) assert.match(err.message, /Invalid|failed/i)
  })
})
