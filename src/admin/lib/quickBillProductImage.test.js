import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isQuickBillRenderableImageSrc,
  quickBillThumbViewModel,
  resolveQuickBillApiImageUrl,
} from './quickBillProductImage.js'

/** Typical D1 / admin API shape after catalogue import (verified local + remote). */
const D1_LOCAL_PATH_SAMPLE = {
  images: ['/images/products/images-mobile-webp/GC_BIG_10p_LEO.webp'],
}

describe('resolveQuickBillApiImageUrl', () => {
  it('returns stored HTTPS Cloudinary URLs from the API unchanged', () => {
    const url = 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P005/1.webp'
    assert.equal(resolveQuickBillApiImageUrl({ images: [url] }), url)
    assert.equal(resolveQuickBillApiImageUrl({ images: [url, '/images/products/x.webp'] }), url)
  })

  it('does not remap local catalogue paths from the database', () => {
    assert.equal(resolveQuickBillApiImageUrl(D1_LOCAL_PATH_SAMPLE), '')
    assert.equal(
      resolveQuickBillApiImageUrl({
        images: ['/images/products/images-mobile-webp/EMERALD_GIFT_BOX_1.webp'],
      }),
      '',
    )
  })

  it('returns empty when images are missing', () => {
    assert.equal(resolveQuickBillApiImageUrl({ images: [] }), '')
    assert.equal(resolveQuickBillApiImageUrl(null), '')
  })
})

describe('isQuickBillRenderableImageSrc', () => {
  it('allows HTTPS only', () => {
    assert.equal(isQuickBillRenderableImageSrc('https://res.cloudinary.com/x/y.webp'), true)
    assert.equal(isQuickBillRenderableImageSrc('/images/products/P001.webp'), false)
    assert.equal(isQuickBillRenderableImageSrc(''), false)
  })
})

describe('quickBillThumbViewModel', () => {
  it('shows API HTTPS image src only', () => {
    const url = 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P005/1.webp'
    const vm = quickBillThumbViewModel(url)
    assert.equal(vm.showImage, true)
    assert.equal(vm.imageSrc, url)
    assert.equal(vm.showPlaceholder, false)
  })

  it('uses placeholder for local DB paths and after load failure', () => {
    const local = quickBillThumbViewModel('/images/products/P001.webp')
    assert.equal(local.showImage, false)
    assert.equal(local.imageSrc, '')
    assert.equal(local.showPlaceholder, true)

    const url = 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/x.webp'
    const failed = quickBillThumbViewModel(url, true)
    assert.equal(failed.showImage, false)
    assert.equal(failed.showPlaceholder, true)
  })
})
