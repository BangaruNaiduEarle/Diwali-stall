import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAdminSessionPayload } from './adminSeasonSession.js'

describe('parseAdminSessionPayload', () => {
  it('reads season fields and memberships from session JSON', () => {
    const parsed = parseAdminSessionPayload({
      ok: true,
      email: 'owner@example.com',
      role: 'owner',
      userId: 'u-owner',
      platformAdmin: false,
      activeSeasonId: 'season-2026',
      seasonRole: 'owner',
      seasonStatus: 'active',
      memberships: [
        {
          seasonId: 'season-2026',
          code: '2026',
          label: 'Diwali 2026',
          status: 'active',
          role: 'owner',
          membershipDisabled: false,
        },
        {
          seasonId: 'season-2099',
          code: '2099',
          label: 'Diwali 2099',
          status: 'active',
          role: 'admin',
          membershipDisabled: false,
        },
      ],
    })
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.email, 'owner@example.com')
    assert.equal(parsed.platformAdmin, false)
    assert.equal(parsed.activeSeasonId, 'season-2026')
    assert.equal(parsed.seasonRole, 'owner')
    assert.equal(parsed.seasonStatus, 'active')
    assert.equal(parsed.memberships.length, 2)
    assert.equal(parsed.memberships[1].seasonId, 'season-2099')
  })

  it('keeps activeSeasonId null when server reports no active season', () => {
    const parsed = parseAdminSessionPayload({
      ok: true,
      email: 'owner@example.com',
      role: 'owner',
      activeSeasonId: null,
      seasonRole: null,
      seasonStatus: null,
      memberships: [
        {
          seasonId: 'season-2026',
          code: '2026',
          label: 'Diwali 2026',
          status: 'active',
          role: 'owner',
          membershipDisabled: false,
        },
      ],
    })
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.activeSeasonId, null)
    assert.equal(parsed.seasonRole, null)
    assert.equal(parsed.memberships.length, 1)
  })

  it('rejects invalid session payloads', () => {
    assert.equal(parseAdminSessionPayload(null).ok, false)
    assert.equal(parseAdminSessionPayload({ ok: true }).ok, false)
  })
})
