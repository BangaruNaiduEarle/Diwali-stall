import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  firstAdminProductImagePath,
  formatAdminProductCompany,
  formatAdminProductPack,
} from './adminProductTableDisplay.js'

describe('adminProductTableDisplay', () => {
  it('formats company and pack with em dash when empty', () => {
    assert.equal(formatAdminProductCompany(null), '—')
    assert.equal(formatAdminProductCompany('MAY'), 'MAY')
    assert.equal(formatAdminProductPack(''), '—')
    assert.equal(formatAdminProductPack('Box'), 'Box')
  })

  it('returns first image path from images array', () => {
    assert.equal(firstAdminProductImagePath([]), null)
    assert.equal(firstAdminProductImagePath(['/a.webp', '/b.webp']), '/a.webp')
    assert.equal(firstAdminProductImagePath(['']), null)
  })
})
