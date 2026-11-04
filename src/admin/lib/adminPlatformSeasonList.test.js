import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mergePlatformSeasonIntoList,
  parsePlatformBusinessSeason,
  platformSeasonRowActions,
  sortPlatformBusinessSeasons,
} from './adminPlatformSeasonList.js'

const base = {
  id: 'season-2026',
  code: '2026',
  label: 'Diwali 2026',
  status: /** @type {const} */ ('active'),
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

describe('adminPlatformSeasonList UI helpers', () => {
  it('parses API season objects and sorts by createdAt', () => {
    const parsed = parsePlatformBusinessSeason({
      id: 'season-2025',
      code: '2025',
      label: 'Older',
      status: 'archived',
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-06-01T00:00:00.000Z',
    })
    assert.ok(parsed)
    assert.equal(parsed.status, 'archived')

    const sorted = sortPlatformBusinessSeasons([
      { ...base, id: 'season-b', createdAt: '2026-02-01T00:00:00.000Z' },
      { ...base, id: 'season-a', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    assert.equal(sorted[0].id, 'season-a')
  })

  it('merges create and edit results into the list without delete', () => {
    const initial = [{ ...base }]
    const created = {
      ...base,
      id: 'season-2030',
      code: '2030',
      label: 'New',
      createdAt: '2030-01-01T00:00:00.000Z',
    }
    const afterCreate = mergePlatformSeasonIntoList(initial, created)
    assert.equal(afterCreate.length, 2)

    const edited = { ...base, label: 'Renamed' }
    const afterEdit = mergePlatformSeasonIntoList(afterCreate, edited)
    assert.equal(afterEdit.find((s) => s.id === 'season-2026')?.label, 'Renamed')
  })

  it('exposes archive/reactivate actions but never delete', () => {
    const activeActions = platformSeasonRowActions('active')
    assert.equal(activeActions.canArchive, true)
    assert.equal(activeActions.canReactivate, false)
    assert.equal(activeActions.canDelete, false)

    const archivedActions = platformSeasonRowActions('archived')
    assert.equal(archivedActions.canArchive, false)
    assert.equal(archivedActions.canReactivate, true)
    assert.equal(archivedActions.canDelete, false)
  })
})
