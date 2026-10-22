import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertProductSaveNotBlockedByImages } from './adminProductImageSave.js'

describe('assertProductSaveNotBlockedByImages', () => {
  it('blocks save while uploading or blob previews remain', () => {
    const uploading = assertProductSaveNotBlockedByImages({ uploading: true, images: [] })
    assert.equal(uploading.ok, false)

    const pending = assertProductSaveNotBlockedByImages({
      uploading: false,
      images: ['blob:http://localhost/abc'],
    })
    assert.equal(pending.ok, false)

    const ok = assertProductSaveNotBlockedByImages({
      uploading: false,
      images: ['https://res.cloudinary.com/demo/image/upload/v1/a.jpg'],
    })
    assert.equal(ok.ok, true)
  })
})
