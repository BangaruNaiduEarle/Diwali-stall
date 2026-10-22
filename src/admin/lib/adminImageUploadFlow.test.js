import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isLikelyImageFile,
  isLocalPreviewUrl,
  isPersistableFamilyPackImageUrl,
  isPersistableImageUrl,
  snapshotFilesFromInputEvent,
} from './adminImageUploadFlow.js'
import { validateImageUploadFile } from './validateImageUploadFile.js'

describe('snapshotFilesFromInputEvent', () => {
  it('copies files before clearing the input (live FileList safe)', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' })
    /** @type {File[]} */
    const liveList = [file]
    const input = {
      type: 'file',
      get files() {
        return liveList
      },
      set value(_v) {
        liveList.length = 0
      },
    }
    const event = { target: input }
    const staleRef = input.files
    input.value = ''
    assert.equal(staleRef.length, 0, 'live FileList clears when input value resets')

    liveList.push(file)
    const snapshot = snapshotFilesFromInputEvent(/** @type {Event} */ (event))
    assert.equal(snapshot.length, 1)
    assert.equal(snapshot[0].name, 'photo.jpg')
    assert.equal(liveList.length, 0)
  })
})

describe('validateImageUploadFile', () => {
  it('accepts PNG/JPEG by extension when file.type is empty', () => {
    const png = new File([new Uint8Array([1])], 'shot.PNG', { type: '' })
    assert.equal(validateImageUploadFile(png).ok, true)
    assert.equal(isLikelyImageFile(png), true)
  })

  it('rejects non-image files', () => {
    const doc = new File(['x'], 'notes.txt', { type: 'text/plain' })
    assert.equal(validateImageUploadFile(doc).ok, false)
  })
})

describe('preview URL helpers', () => {
  it('detects blob preview vs persistable URLs', () => {
    const cloudinary = 'https://res.cloudinary.com/demo/image/upload/v1/a/b.jpg'
    assert.equal(isLocalPreviewUrl('blob:http://localhost/x'), true)
    assert.equal(isPersistableImageUrl('blob:http://localhost/x'), false)
    assert.equal(isPersistableImageUrl('/images/catalogue/x.jpg'), true)
    assert.equal(isPersistableImageUrl(cloudinary), true)
    assert.equal(isPersistableFamilyPackImageUrl(cloudinary), true)
    assert.equal(isPersistableFamilyPackImageUrl('/images/catalogue/x.jpg'), false)
  })
})
