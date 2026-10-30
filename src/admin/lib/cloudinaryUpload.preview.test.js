import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogueCloudinaryByPath } from '../../data/catalogueCloudinaryByPath.js'
import { imagePreviewSrc } from './cloudinaryUpload.js'

describe('imagePreviewSrc (admin product edit)', () => {
  it('resolves mapped catalogue paths to Cloudinary for preview', () => {
    const local = '/images/products/images-mobile-webp/GC_BIG_10p_LEO.webp'
    const expected = catalogueCloudinaryByPath[local]
    assert.ok(expected?.startsWith('https://'))
    assert.equal(imagePreviewSrc(local), expected)
  })

  // it('keeps unmapped catalogue paths as local /images/...', () => {
  //   const local = '/images/products/images-mobile-webp/GANGA_JAMUNA_AJN.webp'
  //   assert.equal(catalogueCloudinaryByPath[local], undefined)
  //   assert.equal(imagePreviewSrc(local), local)
  // })
  it('keeps unmapped catalogue paths as local /images/...', () => {
    const local = '/images/products/images-mobile-webp/UNMAPPED_TEST_IMAGE.webp'
    assert.equal(catalogueCloudinaryByPath[local], undefined)
    assert.equal(imagePreviewSrc(local), local)
  })

  it('passes through Cloudinary URLs from uploads', () => {
    const url = 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P005/1.webp'
    assert.equal(imagePreviewSrc(url), url)
  })

  it('returns empty for non-previewable strings', () => {
    assert.equal(imagePreviewSrc(''), '')
    assert.equal(imagePreviewSrc('diwali/products/P001/1'), '')
  })
})
