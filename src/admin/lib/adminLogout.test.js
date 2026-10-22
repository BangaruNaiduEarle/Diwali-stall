import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { adminLogoutAttempt } from './adminLogout.js'

describe('adminLogoutAttempt', () => {
  it('reports server confirmed when logout API succeeds', async () => {
    const outcome = await adminLogoutAttempt(async () => ({ ok: true, status: 200 }))
    assert.equal(outcome.serverConfirmed, true)
    assert.equal(outcome.notice, null)
  })

  it('returns a notice on network failure but still represents local sign-out', async () => {
    const outcome = await adminLogoutAttempt(async () => ({
      ok: false,
      status: 0,
      message: 'Could not reach the admin API.',
    }))
    assert.equal(outcome.serverConfirmed, false)
    assert.match(outcome.notice, /could not be confirmed/i)
  })

  it('returns a notice when the server rejects logout', async () => {
    const outcome = await adminLogoutAttempt(async () => ({
      ok: false,
      status: 500,
      message: 'Internal error.',
    }))
    assert.equal(outcome.serverConfirmed, false)
    assert.match(outcome.notice, /Internal error/)
  })
})
