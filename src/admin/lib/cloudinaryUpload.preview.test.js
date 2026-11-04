import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogueCloudinaryByPath } from '../../data/catalogueCloudinaryByPath.js'
import { imagePreviewSrc } from './cloudinaryUpload.js'

describe('imagePreviewSrc (admin product edit)', () => {
  it('resolves mapped catalogue paths to local /images/... for preview', () => {
    const local = '/images/products/images-mobile-webp/GC_BIG_10p_LEO.webp'
    assert.ok(catalogueCloudinaryByPath[local]?.startsWith('https://'))
    assert.equal(imagePreviewSrc(local), local)
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

  it('maps known Cloudinary catalogue URLs to local paths for preview', () => {
    const local = '/images/products/images-mobile-webp/GC_BIG_10p_LEO.webp'
    const url = catalogueCloudinaryByPath[local]
    assert.equal(imagePreviewSrc(url), local)
  })

  it('maps supplemental Cloudinary product URLs to local paths for preview', () => {
    const url = 'https://res.cloudinary.com/dn0puzofw/image/upload/v1792769924/diwali/products/P114/1.webp'
    assert.equal(imagePreviewSrc(url), '/images/products/images-mobile-webp/dora-dora.webp')
  })

  it('returns empty for non-previewable strings', () => {
    assert.equal(imagePreviewSrc(''), '')
    assert.equal(imagePreviewSrc('diwali/products/P001/1'), '')
  })
})
