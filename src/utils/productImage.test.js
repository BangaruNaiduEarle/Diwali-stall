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

  it('aliases legacy DB paths to existing catalogue assets', () => {
    const legacy = '/images/products/images-mobile-webp/GANGA_JAMUNA_AJN.webp'
    const canonical = '/images/products/images-mobile-webp/GANGA_JAMUNA.webp'
    assert.equal(catalogueCloudinaryByPath[legacy], undefined)
    assert.equal(normalizeProductImageUrl(legacy), catalogueCloudinaryByPath[canonical])
    assert.equal(
      normalizeProductImageUrl('/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp'),
      '/images/products/images-mobile-webp/GC_SPECIAL_AJN.jpg',
    )
  })

  it('passes through existing https URLs unchanged', () => {
    const url = 'https://res.cloudinary.com/example/image/upload/v1/x.webp'
    assert.equal(normalizeProductImageUrl(url), url)
  })
})
