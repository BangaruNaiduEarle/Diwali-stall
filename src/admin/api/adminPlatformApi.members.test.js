import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

/** @type {typeof fetch | undefined} */
let originalFetch

const SEASON = {
  id: 'season-2026',
  code: '2026',
  label: 'Diwali 2026',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const MEMBER = {
  userId: 'u-owner',
  email: 'owner@example.com',
  displayName: 'Owner',
  role: 'owner',
  membershipDisabled: false,
  userDisabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('adminPlatformApi season members', () => {
  before(() => {
    originalFetch = globalThis.fetch
  })

  after(() => {
    if (originalFetch) globalThis.fetch = originalFetch
  })

  it('lists season members', async () => {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/api\/admin\/platform\/seasons\/season-2026\/members$/)
      assert.equal(init?.method ?? 'GET', 'GET')
      return new Response(JSON.stringify({ season: SEASON, members: [MEMBER] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const stamp = Date.now()
    const { fetchPlatformSeasonMembers } = await import(`./adminPlatformApi.js?members-list=${stamp}`)
    const result = await fetchPlatformSeasonMembers('season-2026')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.members.length, 1)
    assert.equal(result.members[0].email, 'owner@example.com')
  })

  it('assigns member with owner role by default payload', async () => {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/members$/)
      assert.equal(init?.method, 'POST')
      const body = JSON.parse(String(init?.body))
      assert.equal(body.email, 'staff@example.com')
      assert.equal(body.role, 'owner')
      return new Response(
        JSON.stringify({
          member: { ...MEMBER, userId: 'u-staff', email: 'staff@example.com', role: 'owner' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const stamp = Date.now()
    const { assignPlatformSeasonMember } = await import(`./adminPlatformApi.js?members-assign=${stamp}`)
    const result = await assignPlatformSeasonMember('season-2026', {
      email: 'staff@example.com',
      role: 'owner',
    })
    assert.equal(result.ok, true)
  })

  it('patches member role and toggles membership without global disable routes', async () => {
    /** @type {string[]} */
    const paths = []

    globalThis.fetch = async (url, init) => {
      const path = String(url)
      paths.push(path)
      if (path.includes('/disable')) {
        assert.equal(init?.method, 'POST')
        return new Response(
          JSON.stringify({ member: { ...MEMBER, membershipDisabled: true } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      assert.equal(init?.method, 'PATCH')
      return new Response(
        JSON.stringify({ member: { ...MEMBER, role: 'super_admin' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const stamp = Date.now()
    const { updatePlatformSeasonMemberRole, disablePlatformSeasonMember } = await import(
      `./adminPlatformApi.js?members-mut=${stamp}`
    )

    const role = await updatePlatformSeasonMemberRole('season-2026', 'u-owner', 'super_admin')
    assert.equal(role.ok, true)

    const disabled = await disablePlatformSeasonMember('season-2026', 'u-owner')
    assert.equal(disabled.ok, true)
    if (disabled.ok) assert.equal(disabled.member.membershipDisabled, true)

    assert.ok(paths.some((p) => p.includes('/members/u-owner/disable')))
    assert.ok(!paths.some((p) => p.includes('/users/') && p.includes('/disable')))
  })

  it('returns API messages for duplicate membership and last owner errors', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: 'conflict', message: 'This user is already a member of the season.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      )

    const stamp = Date.now()
    const { assignPlatformSeasonMember } = await import(`./adminPlatformApi.js?members-dup=${stamp}`)
    const dup = await assignPlatformSeasonMember('season-2026', { email: 'owner@example.com', role: 'admin' })
    assert.equal(dup.ok, false)
    if (dup.ok) return
    assert.match(dup.message, /already a member/i)

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: 'validation_error', message: 'At least one active season owner must remain.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )

    const stamp2 = Date.now()
    const { updatePlatformSeasonMemberRole } = await import(`./adminPlatformApi.js?members-owner=${stamp2}`)
    const last = await updatePlatformSeasonMemberRole('season-2026', 'u-owner', 'admin')
    assert.equal(last.ok, false)
    if (last.ok) return
    assert.match(last.message, /active season owner/i)
  })
})
