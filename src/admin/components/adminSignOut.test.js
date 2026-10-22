import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { closeMobileNavForSignOut } from './adminSignOut.js'

describe('closeMobileNavForSignOut', () => {
  it('closes the mobile navigation panel before sign-out', () => {
    let open = true
    closeMobileNavForSignOut({
      setNavOpen: (value) => {
        open = value
      },
    })
    assert.equal(open, false)
  })
})
