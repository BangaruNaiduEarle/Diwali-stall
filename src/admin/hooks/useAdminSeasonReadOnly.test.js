import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ARCHIVED_SEASON_BANNER_TEXT, isArchivedSeasonReadOnly } from '../lib/adminSeasonReadOnly.js'

describe('useAdminSeasonReadOnly helpers', () => {
  it('maps archived seasonStatus to read-only banner text', () => {
    assert.equal(isArchivedSeasonReadOnly('archived'), true)
    assert.equal(isArchivedSeasonReadOnly('active'), false)
    const bannerText = isArchivedSeasonReadOnly('archived') ? ARCHIVED_SEASON_BANNER_TEXT : null
    assert.equal(bannerText, ARCHIVED_SEASON_BANNER_TEXT)
  })

  it('keeps active seasons mutable in UI logic', () => {
    assert.equal(isArchivedSeasonReadOnly('active'), false)
    assert.equal(isArchivedSeasonReadOnly(null), false)
  })
})
