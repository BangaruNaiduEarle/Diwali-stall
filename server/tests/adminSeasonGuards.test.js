import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  requireActiveSeason,
  requirePlatformAdmin,
  requireSeasonMembership,
  requireSeasonRole,
  requireWritableSeason,
} from '../src/middleware/adminSeasonGuards.js'
import { attachAdminSeasonContext } from '../src/middleware/requireAdmin.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const ARCHIVED_SEASON_ID = 'season-archived'

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

/**
 * @param {ReturnType<typeof createMembershipDb>} db
 * @param {string} userId
 * @param {string} [seasonHeader]
 * @param {string} [identityRole] Global identity.role (must not affect season guards)
 */
async function attachContext(db, userId, seasonHeader, identityRole = 'owner') {
  const req =
    seasonHeader != null
      ? new Request('https://example.com/api/admin/products', {
          headers: { 'X-Admin-Season-Id': seasonHeader },
        })
      : new Request('https://example.com/api/admin/products')
  await attachAdminSeasonContext(req, db, {
    userId,
    email: `${userId}@test.com`,
    role: identityRole,
  })
  return req
}

function membershipRow(
  /** @type {string} */ seasonId,
  /** @type {string} */ role,
  /** @type {string} */ status,
) {
  return {
    season_id: seasonId,
    role,
    disabled_at: null,
    created_at: '2026-01-01',
    code: seasonId.replace('season-', ''),
    label: seasonId,
    status,
  }
}

describe('adminSeasonGuards', () => {
  it('requireSeasonMembership fails closed with missing membership', async () => {
    const db = createMembershipDb({ 'u-none': [] })
    const request = await attachContext(db, 'u-none')
    const result = requireSeasonMembership(request)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
    assert.equal(result.platformAdmin, false)
  })

  it('requireActiveSeason fails on invalid season header', async () => {
    const db = createMembershipDb({
      'u-1': [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active')],
    })
    const request = await attachContext(db, 'u-1', 'season-does-not-exist')
    const active = requireActiveSeason(request)
    assert.equal(active.ok, false)
    const membership = requireSeasonMembership(request)
    assert.equal(membership.ok, false)
  })

  it('requireSeasonRole enforces season role not global identity role', async () => {
    const db = createMembershipDb({
      'u-admin': [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active')],
    })
    const request = await attachContext(db, 'u-admin', undefined, 'owner')
    assert.equal(requireSeasonRole(request, ['owner']).ok, false)
    assert.equal(requireSeasonRole(request, ['admin']).ok, true)
    assert.equal(requireSeasonRole(request, ['super_admin', 'admin']).ok, true)
  })

  it('owner super_admin and admin pass membership with distinct role gates', async () => {
    for (const role of ['owner', 'super_admin', 'admin']) {
      const db = createMembershipDb({
        [`u-${role}`]: [membershipRow(DEFAULT_ADMIN_SEASON_ID, role, 'active')],
      })
      const request = await attachContext(db, `u-${role}`)
      const membership = requireSeasonMembership(request)
      assert.equal(membership.ok, true)
      if (!membership.ok) return
      assert.equal(membership.auth.seasonRole, role)
      assert.equal(requireSeasonRole(request, [/** @type {'admin'} */ (role)]).ok, true)
    }
    const ownerDb = createMembershipDb({
      'u-owner': [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'owner', 'active')],
    })
    const ownerReq = await attachContext(ownerDb, 'u-owner')
    assert.equal(requireSeasonRole(ownerReq, ['owner']).ok, true)
    assert.equal(requireSeasonRole(ownerReq, ['super_admin']).ok, false)
  })

  it('requireWritableSeason rejects archived business season for owner', async () => {
    const db = createMembershipDb({
      'u-owner': [membershipRow(ARCHIVED_SEASON_ID, 'owner', 'archived')],
    })
    const request = await attachContext(db, 'u-owner', ARCHIVED_SEASON_ID)
    const active = requireActiveSeason(request)
    assert.equal(active.ok, true)
    if (!active.ok) return
    assert.equal(active.seasonStatus, 'archived')

    const membership = requireSeasonMembership(request)
    assert.equal(membership.ok, true)

    const writable = requireWritableSeason(request)
    assert.equal(writable.ok, false)
    if (writable.ok) return
    assert.match(writable.message, /archived/i)
    assert.equal(writable.platformAdmin, false)
  })

  it('requireWritableSeason allows active season for admin', async () => {
    const db = createMembershipDb({
      'u-admin': [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active')],
    })
    const request = await attachContext(db, 'u-admin')
    assert.equal(requireWritableSeason(request).ok, true)
  })

  it('platform admin without membership passes platform guard only', async () => {
    const db = createMembershipDb({ 'u-platform': [] }, new Set(['u-platform']))
    const request = await attachContext(db, 'u-platform')
    const platform = requirePlatformAdmin(request)
    assert.equal(platform.ok, true)
    if (!platform.ok) return
    assert.equal(platform.platformAdmin, true)

    assert.equal(requireSeasonMembership(request).ok, false)
    assert.equal(requireActiveSeason(request).ok, false)
    assert.equal(requireWritableSeason(request).ok, false)
  })

  it('platform admin with admin season membership does not bypass role checks', async () => {
    const db = createMembershipDb(
      {
        'u-platform': [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active')],
      },
      new Set(['u-platform']),
    )
    const request = await attachContext(db, 'u-platform')
    assert.equal(requirePlatformAdmin(request).ok, true)
    assert.equal(requireSeasonRole(request, ['owner']).ok, false)
    assert.equal(requireSeasonMembership(request).ok, true)
  })
})
