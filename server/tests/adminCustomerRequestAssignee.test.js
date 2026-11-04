import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assignAdminCustomerRequest,
  resolveQuickBillAssignee,
} from '../src/services/adminCustomerRequests.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'

const OTHER_SEASON_ID = 'season-2099'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'

describe('resolveQuickBillAssignee season membership', () => {
  it('rejects season admin assignee despite global owner role', async () => {
    const db = createAssigneeDb({
      users: {
        'u-admin': {
          id: 'u-admin',
          email: 'admin@test.com',
          role: 'owner',
          disabled_at: null,
        },
      },
      memberships: {
        'u-admin': membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active'),
      },
    })
    const result = await resolveQuickBillAssignee(
      db,
      { assigneeUserId: 'u-admin' },
      DEFAULT_ADMIN_SEASON_ID,
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid_assignee')
  })

  it('rejects assignee with global super_admin but no season membership', async () => {
    const db = createAssigneeDb({
      users: {
        'u-super': {
          id: 'u-super',
          email: 'super@test.com',
          role: 'super_admin',
          disabled_at: null,
        },
      },
      memberships: {},
    })
    const result = await resolveQuickBillAssignee(
      db,
      { assigneeUserId: 'u-super' },
      DEFAULT_ADMIN_SEASON_ID,
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'invalid_assignee')
  })

  it('rejects disabled admin user', async () => {
    const db = createAssigneeDb({
      users: {
        'u-off': {
          id: 'u-off',
          email: 'off@test.com',
          role: 'admin',
          disabled_at: '2026-01-01',
        },
      },
      memberships: {
        'u-off': membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active'),
      },
    })
    const result = await resolveQuickBillAssignee(
      db,
      { assigneeUserId: 'u-off' },
      DEFAULT_ADMIN_SEASON_ID,
    )
    assert.equal(result.ok, false)
  })

  it('rejects season membership in another season only', async () => {
    const db = createAssigneeDb({
      users: {
        'u-other': {
          id: 'u-other',
          email: 'other@test.com',
          role: 'owner',
          disabled_at: null,
        },
      },
      memberships: {
        'u-other': membershipRow(OTHER_SEASON_ID, 'owner', 'active'),
      },
    })
    const result = await resolveQuickBillAssignee(
      db,
      { assigneeUserId: 'u-other' },
      DEFAULT_ADMIN_SEASON_ID,
    )
    assert.equal(result.ok, false)
  })
})

describe('assignAdminCustomerRequest assignee integration', () => {
  it('assigns when season role is super_admin', async () => {
    const db = createAssigneeDb({
      users: {
        'u-super': {
          id: 'u-super',
          email: 'super@test.com',
          role: 'admin',
          disabled_at: null,
        },
      },
      memberships: {
        'u-super': membershipRow(DEFAULT_ADMIN_SEASON_ID, 'super_admin', 'active'),
      },
      pendingRequest: true,
    })
    const result = await assignAdminCustomerRequest(
      db,
      REQUEST_ID,
      { assigneeUserId: 'u-super' },
      { assignedByEmail: 'owner@test.com', seasonId: DEFAULT_ADMIN_SEASON_ID },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.request.assignedToEmail, 'super@test.com')
  })
})

function membershipRow(seasonId, role, status) {
  return { season_id: seasonId, role, disabled_at: null, status }
}

/** @param {{
 *   users: Record<string, { id: string, email: string, role: string, disabled_at: string | null }>,
 *   memberships: Record<string, { season_id: string, role: string, disabled_at: string | null, status: string }>,
 *   pendingRequest?: boolean,
 * }} config
 */
function createAssigneeDb(config) {
  const requestRow = {
    id: REQUEST_ID,
    source: 'manual',
    finalization_status: 'pending',
    assigned_to_email: null,
    status: 'received',
    season_id: DEFAULT_ADMIN_SEASON_ID,
  }

  return bindAdminServiceMode({
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM admin_users WHERE id = ?')) {
                const u = config.users[String(params[0])]
                if (!u) return null
                return {
                  id: u.id,
                  email: u.email,
                  display_name: u.email,
                  role: u.role,
                  password_hash: 'x',
                  disabled_at: u.disabled_at,
                }
              }
              if (normalized.includes('FROM admin_users') && normalized.includes('lower(email)')) {
                return null
              }
              if (normalized.includes('FROM season_members sm') && normalized.includes('admin_user_id = ?')) {
                const seasonId = String(params[0])
                const userId = String(params[1])
                const m = config.memberships[userId]
                if (!m || m.season_id !== seasonId) return null
                return {
                  role: m.role,
                  disabled_at: m.disabled_at,
                  status: m.status,
                }
              }
              if (normalized.includes('FROM customer_requests') && normalized.includes('season_id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id === REQUEST_ID && seasonId === DEFAULT_ADMIN_SEASON_ID && config.pendingRequest) {
                  return requestRow
                }
                return null
              }
              return null
            },
            async all() {
              return { results: [] }
            },
            async run() {
              if (normalized.includes('UPDATE customer_requests') && normalized.includes('assigned_to_email')) {
                requestRow.assigned_to_email = String(params[0])
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())) },
  }, {})
}
