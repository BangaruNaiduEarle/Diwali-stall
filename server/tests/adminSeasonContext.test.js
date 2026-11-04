import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_ADMIN_SEASON_ID,
  isPlatformAdminUser,
  loadSeasonMemberships,
  pickActiveSeasonId,
  resolveAdminSeasonContext,
} from '../src/services/adminSeasonContext.js'

describe('adminSeasonContext', () => {
  it('pickActiveSeasonId returns single active 2026 membership without header', () => {
    const memberships = [
      {
        seasonId: DEFAULT_ADMIN_SEASON_ID,
        code: '2026',
        label: '2026',
        status: 'active',
        role: 'owner',
        disabled: false,
        createdAt: '2026-01-01',
      },
    ]
    assert.equal(pickActiveSeasonId(memberships, null), DEFAULT_ADMIN_SEASON_ID)
    assert.equal(pickActiveSeasonId(memberships, undefined), DEFAULT_ADMIN_SEASON_ID)
  })

  it('pickActiveSeasonId returns single active non-2026 membership without header', () => {
    const memberships = [
      {
        seasonId: 'season-2027',
        code: '2027',
        label: '2027',
        status: 'active',
        role: 'admin',
        disabled: false,
        createdAt: '2026-01-01',
      },
    ]
    assert.equal(pickActiveSeasonId(memberships, null), 'season-2027')
  })

  it('pickActiveSeasonId returns null for multiple active memberships without header', () => {
    const memberships = [
      {
        seasonId: 'season-2027',
        code: '2027',
        label: '2027',
        status: 'active',
        role: 'admin',
        disabled: false,
        createdAt: '2026-01-01',
      },
      {
        seasonId: DEFAULT_ADMIN_SEASON_ID,
        code: '2026',
        label: '2026',
        status: 'active',
        role: 'owner',
        disabled: false,
        createdAt: '2026-01-02',
      },
    ]
    assert.equal(pickActiveSeasonId(memberships, null), null)
  })

  it('pickActiveSeasonId returns null when explicit season is not an active membership', () => {
    const memberships = [
      {
        seasonId: DEFAULT_ADMIN_SEASON_ID,
        code: '2026',
        label: '2026',
        status: 'active',
        role: 'owner',
        disabled: false,
        createdAt: '2026-01-01',
      },
    ]
    assert.equal(pickActiveSeasonId(memberships, 'season-2099'), null)
  })

  it('pickActiveSeasonId returns null when all memberships are disabled', () => {
    const memberships = [
      {
        seasonId: DEFAULT_ADMIN_SEASON_ID,
        code: '2026',
        label: '2026',
        status: 'active',
        role: 'owner',
        disabled: true,
        createdAt: '2026-01-01',
      },
      {
        seasonId: 'season-2027',
        code: '2027',
        label: '2027',
        status: 'active',
        role: 'admin',
        disabled: true,
        createdAt: '2026-01-02',
      },
    ]
    assert.equal(pickActiveSeasonId(memberships, null), null)
    assert.equal(pickActiveSeasonId(memberships, DEFAULT_ADMIN_SEASON_ID), null)
  })

  it('pickActiveSeasonId returns null when explicit season membership is disabled', () => {
    const memberships = [
      {
        seasonId: DEFAULT_ADMIN_SEASON_ID,
        code: '2026',
        label: '2026',
        status: 'active',
        role: 'owner',
        disabled: true,
        createdAt: '2026-01-01',
      },
    ]
    assert.equal(pickActiveSeasonId(memberships, DEFAULT_ADMIN_SEASON_ID), null)
    assert.equal(pickActiveSeasonId(memberships, null), null)
  })

  it('pickActiveSeasonId honors explicit activeSeasonId when membership is active', () => {
    const memberships = [
      {
        seasonId: DEFAULT_ADMIN_SEASON_ID,
        code: '2026',
        label: '2026',
        status: 'active',
        role: 'owner',
        disabled: false,
        createdAt: '2026-01-01',
      },
      {
        seasonId: 'season-2027',
        code: '2027',
        label: '2027',
        status: 'active',
        role: 'admin',
        disabled: false,
        createdAt: '2026-01-02',
      },
    ]
    assert.equal(pickActiveSeasonId(memberships, 'season-2027'), 'season-2027')
  })

  it('isPlatformAdminUser is false for owner and super_admin without platform_admins row', async () => {
    const db = createMembershipDb({
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
      'u-super': [
        {
          season_id: DEFAULT_ADMIN_SEASON_ID,
          role: 'super_admin',
          disabled_at: null,
          created_at: '2026-01-01',
          code: '2026',
          label: 'Diwali 2026',
          status: 'active',
        },
      ],
    })
    assert.equal(await isPlatformAdminUser(db, 'u-owner'), false)
    assert.equal(await isPlatformAdminUser(db, 'u-super'), false)
    const ownerCtx = await resolveAdminSeasonContext(db, { userId: 'u-owner' })
    assert.equal(ownerCtx.platformAdmin, false)
    const superCtx = await resolveAdminSeasonContext(db, { userId: 'u-super' })
    assert.equal(superCtx.platformAdmin, false)
  })

  it('isPlatformAdminUser is true only for explicit platform_admins registry rows', async () => {
    const db = createMembershipDb({ 'u-platform': [] }, new Set(['u-platform']))
    assert.equal(await isPlatformAdminUser(db, 'u-platform'), true)
    const ctx = await resolveAdminSeasonContext(db, { userId: 'u-platform' })
    assert.equal(ctx.platformAdmin, true)
    assert.equal(ctx.activeSeasonId, null)
    assert.equal(ctx.seasonRole, null)
  })

  it('platform admin with season membership keeps season selection behaviour', async () => {
    const db = createMembershipDb(
      {
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
          {
            season_id: 'season-2027',
            role: 'admin',
            disabled_at: null,
            created_at: '2026-01-02',
            code: '2027',
            label: '2027',
            status: 'active',
          },
        ],
      },
      new Set(['u-platform']),
    )
    const ctx = await resolveAdminSeasonContext(db, {
      userId: 'u-platform',
      activeSeasonId: 'season-2027',
    })
    assert.equal(ctx.platformAdmin, true)
    assert.equal(ctx.activeSeasonId, 'season-2027')
    assert.equal(ctx.seasonRole, 'admin')
  })

  it('resolveAdminSeasonContext returns null role when user has no memberships', async () => {
    const db = createMembershipDb({ 'u-none': [] })
    const ctx = await resolveAdminSeasonContext(db, { userId: 'u-none' })
    assert.equal(ctx.userId, 'u-none')
    assert.equal(ctx.platformAdmin, false)
    assert.equal(ctx.activeSeasonId, null)
    assert.equal(ctx.seasonRole, null)
    assert.deepEqual(ctx.memberships, [])
  })

  it('resolveAdminSeasonContext loads role from season_members for default season', async () => {
    const db = createMembershipDb({
      'u-super': [
        {
          season_id: DEFAULT_ADMIN_SEASON_ID,
          role: 'super_admin',
          disabled_at: null,
          created_at: '2026-01-01',
          code: '2026',
          label: 'Diwali 2026',
          status: 'active',
        },
      ],
    })
    const ctx = await resolveAdminSeasonContext(db, { userId: 'u-super' })
    assert.equal(ctx.activeSeasonId, DEFAULT_ADMIN_SEASON_ID)
    assert.equal(ctx.seasonRole, 'super_admin')
    assert.equal(ctx.memberships.length, 1)
    assert.equal(ctx.memberships[0].role, 'super_admin')
  })

  it('loadSeasonMemberships marks disabled_at rows as disabled', async () => {
    const db = createMembershipDb({
      'u-off': [
        {
          season_id: DEFAULT_ADMIN_SEASON_ID,
          role: 'admin',
          disabled_at: '2026-02-01T00:00:00Z',
          created_at: '2026-01-01',
          code: '2026',
          label: 'Diwali 2026',
          status: 'active',
        },
      ],
    })
    const rows = await loadSeasonMemberships(db, 'u-off')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].disabled, true)
    const ctx = await resolveAdminSeasonContext(db, { userId: 'u-off' })
    assert.equal(ctx.activeSeasonId, null)
    assert.equal(ctx.seasonRole, null)
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
