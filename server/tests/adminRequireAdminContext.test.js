import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  attachAdminSeasonContext,
  getAdminContext,
} from '../src/middleware/requireAdmin.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

describe('requireAdmin season context attachment', () => {
  it('attachAdminSeasonContext stores context retrievable via getAdminContext', async () => {
    const request = new Request('https://example.com/api/admin/session', {
      headers: { 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
    })
    const db = createMembershipDb({
      'u-1': [
        {
          season_id: DEFAULT_ADMIN_SEASON_ID,
          role: 'admin',
          disabled_at: null,
          created_at: '2026-01-01',
          code: '2026',
          label: 'Diwali 2026',
          status: 'active',
        },
      ],
    })

    const ctx = await attachAdminSeasonContext(request, db, {
      userId: 'u-1',
      email: 'staff@test.com',
      role: 'admin',
    })

    assert.equal(ctx.activeSeasonId, DEFAULT_ADMIN_SEASON_ID)
    assert.equal(ctx.seasonRole, 'admin')
    assert.equal(getAdminContext(request), ctx)
  })

  it('rejects foreign season header without falling back to default membership', async () => {
    const request = new Request('https://example.com/api/admin/session', {
      headers: { 'X-Admin-Season-Id': 'season-2099' },
    })
    const db = createMembershipDb({
      'u-1': [
        {
          season_id: DEFAULT_ADMIN_SEASON_ID,
          role: 'owner',
          disabled_at: null,
          created_at: '2026-01-01',
          code: '2026',
          label: 'Diwali 2026',
          status: 'active',
        },
      ],
    })

    const ctx = await attachAdminSeasonContext(request, db, {
      userId: 'u-1',
      email: 'owner@test.com',
      role: 'owner',
    })

    assert.equal(ctx.activeSeasonId, null)
    assert.equal(ctx.seasonRole, null)
    assert.equal(ctx.memberships.length, 1)
  })

  it('missing membership yields empty active season without throwing', async () => {
    const request = new Request('https://example.com/api/admin/session')
    const db = createMembershipDb({ 'u-none': [] })

    const ctx = await attachAdminSeasonContext(request, db, {
      userId: 'u-none',
      email: 'none@test.com',
      role: 'admin',
    })

    assert.equal(ctx.activeSeasonId, null)
    assert.equal(ctx.seasonRole, null)
    assert.deepEqual(ctx.memberships, [])
    assert.equal(getAdminContext(request)?.userId, 'u-none')
    assert.equal(getAdminContext(request)?.platformAdmin, false)
  })

  it('attachAdminSeasonContext sets platformAdmin from platform_admins registry only', async () => {
    const request = new Request('https://example.com/api/admin/session', {
      headers: { 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
    })
    const db = createMembershipDb(
      {
        'u-owner': [
          {
            season_id: DEFAULT_ADMIN_SEASON_ID,
            role: 'owner',
            disabled_at: null,
            created_at: '2026-01-01',
            code: '2026',
            label: 'Diwali 2026',
            status: 'active',
          },
        ],
        'u-platform': [
          {
            season_id: DEFAULT_ADMIN_SEASON_ID,
            role: 'admin',
            disabled_at: null,
            created_at: '2026-01-01',
            code: '2026',
            label: 'Diwali 2026',
            status: 'active',
          },
        ],
      },
      new Set(['u-platform']),
    )

    const ownerCtx = await attachAdminSeasonContext(request, db, {
      userId: 'u-owner',
      email: 'owner@test.com',
      role: 'owner',
    })
    assert.equal(ownerCtx.platformAdmin, false)

    const platformCtx = await attachAdminSeasonContext(request, db, {
      userId: 'u-platform',
      email: 'platform@test.com',
      role: 'admin',
    })
    assert.equal(platformCtx.platformAdmin, true)
    assert.equal(platformCtx.activeSeasonId, DEFAULT_ADMIN_SEASON_ID)
  })
})

/** @param {Record<string, Record<string, unknown>[]>} rowsByUserId @param {Set<string>} [platformAdminUserIds] */
function createMembershipDb(rowsByUserId, platformAdminUserIds = new Set()) {
  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM platform_admins')) {
                const uid = String(params[0])
                return platformAdminUserIds.has(uid) ? { ok: 1 } : null
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM season_members')) {
                const userId = String(params[0])
                return { results: rowsByUserId[userId] ?? [] }
              }
              return { results: [] }
            },
          }
        },
      }
    },
  }
}
