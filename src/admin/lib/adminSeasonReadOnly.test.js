import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ARCHIVED_SEASON_BANNER_TEXT,
  isArchivedSeasonReadOnly,
  preventArchivedSeasonFormSubmit,
  shouldBlockArchivedSeasonMutation,
} from './adminSeasonReadOnly.js'

describe('adminSeasonReadOnly', () => {
  it('treats only archived seasonStatus as read-only', () => {
    assert.equal(isArchivedSeasonReadOnly('archived'), true)
    assert.equal(isArchivedSeasonReadOnly('active'), false)
    assert.equal(isArchivedSeasonReadOnly(null), false)
    assert.equal(shouldBlockArchivedSeasonMutation('archived'), true)
    assert.equal(shouldBlockArchivedSeasonMutation('active'), false)
  })

  it('blocks form submit handlers in archived mode', () => {
    let prevented = false
    const blocked = preventArchivedSeasonFormSubmit(
      { preventDefault: () => {
        prevented = true
      } },
      'archived',
    )
    assert.equal(blocked, true)
    assert.equal(prevented, true)

    assert.equal(preventArchivedSeasonFormSubmit({ preventDefault: () => {} }, 'active'), false)
  })

  it('uses the expected banner copy', () => {
    assert.match(ARCHIVED_SEASON_BANNER_TEXT, /archived/i)
    assert.match(ARCHIVED_SEASON_BANNER_TEXT, /read only/i)
  })
})
