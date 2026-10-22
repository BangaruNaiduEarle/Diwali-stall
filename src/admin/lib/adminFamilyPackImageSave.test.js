import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertFamilyPackSaveNotBlockedByImages,
  countPersistableFamilyPackImages,
  hasPendingFamilyPackImagePreviews,
} from './adminFamilyPackImageSave.js'

const cloudA = 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg'
const cloudB = 'https://res.cloudinary.com/demo/image/upload/v1/b.jpg'

describe('adminFamilyPackImageSave', () => {
  it('detects blob previews pending upload', () => {
    assert.equal(hasPendingFamilyPackImagePreviews([{ url: 'blob:http://x' }]), true)
    assert.equal(hasPendingFamilyPackImagePreviews([{ url: cloudA }]), false)
  })

  it('counts persistable cloudinary images', () => {
    assert.equal(
      countPersistableFamilyPackImages([{ url: cloudA }, { url: cloudB }, { url: 'blob:x' }]),
      2,
    )
  })

  it('blocks save while uploading or previews remain', () => {
    assert.equal(
      assertFamilyPackSaveNotBlockedByImages({ uploading: true, images: [] }).ok,
      false,
    )
    assert.equal(
      assertFamilyPackSaveNotBlockedByImages({ uploading: false, images: [{ url: 'blob:x' }] }).ok,
      false,
    )
    assert.equal(
      assertFamilyPackSaveNotBlockedByImages({ uploading: false, images: [{ url: cloudA }] }).ok,
      true,
    )
  })
})
