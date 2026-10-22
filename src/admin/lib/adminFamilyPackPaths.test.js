import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { adminFamilyPackEditPath } from './adminFamilyPackPaths.js'

describe('adminFamilyPackEditPath', () => {
  it('builds edit route from pack id', () => {
    assert.equal(adminFamilyPackEditPath('FP001'), '/admin/family-packs/FP001/edit')
  })

  it('encodes special characters in id', () => {
    assert.equal(adminFamilyPackEditPath('FP 100'), '/admin/family-packs/FP%20100/edit')
  })

  it('falls back to list when id is empty', () => {
    assert.equal(adminFamilyPackEditPath(''), '/admin/family-packs')
    assert.equal(adminFamilyPackEditPath(null), '/admin/family-packs')
  })
})
