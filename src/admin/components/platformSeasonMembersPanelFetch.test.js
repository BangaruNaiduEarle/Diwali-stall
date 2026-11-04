import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  loadPlatformSeasonMembersPanel,
  platformSeasonMembersInitialFetchDeps,
} from './platformSeasonMembersPanelFetch.js'

const SEASON = {
  id: 'season-2099',
  code: '2099',
  label: 'Diwali 2099',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const MEMBER = {
  userId: 'u-1',
  email: 'owner@example.com',
  displayName: 'Owner',
  role: 'owner',
  membershipDisabled: false,
  userDisabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('platformSeasonMembersPanelFetch', () => {
  it('initial fetch effect deps include only seasonId', () => {
    assert.deepEqual(platformSeasonMembersInitialFetchDeps('season-2099'), ['season-2099'])
  })

  it('does not treat unstable onSeasonUpdated as a refetch signal when seasonId is unchanged', () => {
    const depsA = platformSeasonMembersInitialFetchDeps('season-2099')
    const depsB = platformSeasonMembersInitialFetchDeps('season-2099')
    assert.deepEqual(depsA, depsB)

    let fetchCount = 0
    const runInitialFetch = () => {
      fetchCount += 1
    }
    runInitialFetch()
    assert.equal(fetchCount, 1)

    const onSeasonUpdatedV1 = () => {}
    const onSeasonUpdatedV2 = () => {}
    assert.notEqual(onSeasonUpdatedV1, onSeasonUpdatedV2)
    assert.deepEqual(depsB, platformSeasonMembersInitialFetchDeps('season-2099'))
    assert.equal(fetchCount, 1)
  })

  it('refetches when seasonId changes', () => {
    assert.notDeepEqual(
      platformSeasonMembersInitialFetchDeps('season-2099'),
      platformSeasonMembersInitialFetchDeps('season-2100'),
    )
  })

  it('loadPlatformSeasonMembersPanel calls fetchMembers once per invocation', async () => {
    let fetchCount = 0
    let draftSynced = false
    let seasonNotified = false

    const result = await loadPlatformSeasonMembersPanel('season-2099', {
      fetchMembers: async (id) => {
        fetchCount += 1
        assert.equal(id, 'season-2099')
        return { ok: true, season: SEASON, members: [MEMBER] }
      },
      syncRoleDraft: (rows) => {
        draftSynced = true
        assert.equal(rows.length, 1)
      },
      onSeasonUpdated: () => {
        seasonNotified = true
      },
    })

    assert.equal(result.ok, true)
    assert.equal(fetchCount, 1)
    assert.equal(draftSynced, true)
    assert.equal(seasonNotified, true)
  })

  it('manual refresh can call loadPlatformSeasonMembersPanel again', async () => {
    let fetchCount = 0
    const deps = {
      fetchMembers: async () => {
        fetchCount += 1
        return { ok: true, season: SEASON, members: [] }
      },
      syncRoleDraft: () => {},
    }

    await loadPlatformSeasonMembersPanel('season-2099', deps)
    await loadPlatformSeasonMembersPanel('season-2099', deps)
    assert.equal(fetchCount, 2)
  })
})
