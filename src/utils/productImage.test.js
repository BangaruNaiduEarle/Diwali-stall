import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogueCloudinaryByPath } from '../data/catalogueCloudinaryByPath.js'
import { normalizeProductImageUrl } from './productImage.js'

describe('productImage Cloudinary resolution', () => {
  it('maps a known catalogue path to its Cloudinary secure_url', () => {
    const local = '/images/products/images-mobile-webp/100_DLX.webp'
    const expected = catalogueCloudinaryByPath[local]
    assert.ok(expected?.startsWith('https://res.cloudinary.com/'))
    assert.equal(normalizeProductImageUrl(local), expected)
  })

  it('leaves unmapped catalogue paths on local /images/...', () => {
    const local = '/images/products/images-mobile-webp/GANGA_JAMUNA_AJN.webp'
    assert.equal(catalogueCloudinaryByPath[local], undefined)
    assert.equal(normalizeProductImageUrl(local), local)
  })

  it('passes through existing https URLs unchanged', () => {
    const url = 'https://res.cloudinary.com/example/image/upload/v1/x.webp'
    assert.equal(normalizeProductImageUrl(url), url)
  })
})
