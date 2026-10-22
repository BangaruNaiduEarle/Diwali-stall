import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  sessionPollAttemptAfterLogout,
  sessionPollAttemptAfterRetry,
} from './adminSessionLogoutFlow.js'

describe('adminSessionLogoutFlow', () => {
  it('does not bump session poll after logout', () => {
    assert.equal(sessionPollAttemptAfterLogout(2), 2)
  })

  it('bumps session poll on retry', () => {
    assert.equal(sessionPollAttemptAfterRetry(2), 3)
  })
})
