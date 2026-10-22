import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatPublicReference,
  generatePublicReference,
  isValidPublicReference,
  publicReferenceSuffixFromBytes,
} from '../src/lib/customerRequestPublicReference.js'

describe('customerRequestPublicReference', () => {
  it('formats and validates DWL- references', () => {
    const ref = formatPublicReference('23456789')
    assert.equal(ref, 'DWL-23456789')
    assert.equal(isValidPublicReference(ref), true)
    assert.equal(isValidPublicReference('DWL-2345678O'), false)
    assert.equal(isValidPublicReference('EST-ABC'), false)
  })

  it('builds suffix from random bytes', async () => {
    const suffix = publicReferenceSuffixFromBytes(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))
    assert.equal(suffix.length, 8)
    const ref = await generatePublicReference(() => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))
    assert.match(ref, /^DWL-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
  })
})
