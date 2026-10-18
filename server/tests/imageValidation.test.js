import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateImagePaths, validateImageRef } from '../src/lib/validation.js'

describe('image path validation', () => {
  it('accepts existing local /images/ paths', () => {
    const result = validateImagePaths([
      '/images/products/images-mobile-webp/EMERALD_GIFT_BOX_1.webp',
      '/images/products/test.webp',
    ])
    assert.equal(result.ok, true)
  })

  it('accepts HTTPS Cloudinary delivery URLs', () => {
    const url =
      'https://res.cloudinary.com/test-cloud-name/image/upload/v1700000000/diwali/products/P001/1.webp'
    assert.equal(validateImageRef(url).ok, true)
    assert.equal(validateImagePaths([url]).ok, true)
  })

  it('rejects unsafe schemes, hosts, and malformed URLs', () => {
    const bad = [
      'http://res.cloudinary.com/test/image/upload/v1/x.webp',
      'https://evil.example/image/upload/v1/x.webp',
      'javascript:alert(1)',
      'data:image/png;base64,aaaa',
      '//res.cloudinary.com/test/image/upload/v1/x.webp',
      '/etc/passwd',
      '/images/../secret.webp',
      'https://user:pass@res.cloudinary.com/test/image/upload/v1/x.webp',
      'not a url',
    ]
    for (const value of bad) {
      assert.equal(validateImageRef(value).ok, false, value)
    }
  })

  it('still allows empty images arrays', () => {
    assert.equal(validateImagePaths([]).ok, true)
  })
})
