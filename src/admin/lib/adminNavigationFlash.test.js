import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { adminNavigationFlashState, readAdminNavigationFlash } from './adminNavigationFlash.js'

describe('adminNavigationFlash', () => {
  it('reads success flash from location state', () => {
    const flash = readAdminNavigationFlash(adminNavigationFlashState('Family pack created successfully.'))
    assert.ok(flash)
    assert.equal(flash.type, 'success')
    assert.equal(flash.message, 'Family pack created successfully.')
  })

  it('returns null when flash is missing', () => {
    assert.equal(readAdminNavigationFlash(null), null)
    assert.equal(readAdminNavigationFlash({}), null)
  })
})
