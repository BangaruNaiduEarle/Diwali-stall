import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatSeasonMembershipOptionLabel,
  listSelectableSeasonMemberships,
  performAdminSeasonSwitch,
  validateSeasonSelection,
} from './adminSeasonSelector.js'

const memberships = [
  {
    seasonId: 'season-2026',
    code: '2026',
    label: 'Diwali 2026',
    status: 'active',
    role: 'owner',
    membershipDisabled: false,
  },
  {
    seasonId: 'season-archived',
    code: '2025',
    label: 'Diwali 2025',
    status: 'archived',
    role: 'admin',
    membershipDisabled: false,
  },
  {
    seasonId: 'season-disabled',
    code: 'old',
    label: 'Disabled season',
    status: 'active',
    role: 'admin',
    membershipDisabled: true,
  },
]

describe('admin season selector helpers', () => {
  it('lists only non-disabled memberships for switching', () => {
    const selectable = listSelectableSeasonMemberships(memberships)
    assert.equal(selectable.length, 2)
    assert.ok(selectable.some((m) => m.seasonId === 'season-archived'))
    assert.equal(selectable.some((m) => m.seasonId === 'season-disabled'), false)
  })

  it('allows archived season selection', () => {
    const result = validateSeasonSelection(memberships, 'season-archived')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.seasonId, 'season-archived')
    assert.match(formatSeasonMembershipOptionLabel(memberships[1]), /archived/i)
  })

  it('rejects disabled membership selection', () => {
    const result = validateSeasonSelection(memberships, 'season-disabled')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'disabled_membership')
  })

  it('allows platform admin with no memberships to stay seasonless', () => {
    const result = validateSeasonSelection([], null, { platformAdmin: true })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.seasonId, null)
  })
})

describe('performAdminSeasonSwitch', () => {
  it('sets header, refreshes session and keeps context on success', async () => {
    /** @type {(string | null)[]} */
    const headers = []
    const outcome = await performAdminSeasonSwitch({
      seasonId: 'season-archived',
      memberships,
      platformAdmin: false,
      previousSeasonId: 'season-2026',
      setSeasonHeader: (id) => headers.push(id),
      fetchSession: async () => ({
        ok: true,
        email: 'owner@example.com',
        role: 'owner',
        activeSeasonId: 'season-archived',
        seasonRole: 'admin',
        seasonStatus: 'archived',
        memberships,
      }),
    })
    assert.equal(outcome.ok, true)
    assert.deepEqual(headers, ['season-archived'])
  })

  it('reverts header and restores session when switch is denied', async () => {
    /** @type {(string | null)[]} */
    const headers = []
    const outcome = await performAdminSeasonSwitch({
      seasonId: 'season-archived',
      memberships,
      platformAdmin: false,
      previousSeasonId: 'season-2026',
      setSeasonHeader: (id) => headers.push(id),
      fetchSession: async () => {
        if (headers.at(-1) === 'season-archived') {
          return { ok: true, activeSeasonId: null }
        }
        return { ok: true, activeSeasonId: 'season-2026', seasonRole: 'owner' }
      },
    })
    assert.equal(outcome.ok, false)
    assert.deepEqual(headers, ['season-archived', 'season-2026'])
    assert.equal(outcome.restoredSession?.activeSeasonId, 'season-2026')
  })
})
