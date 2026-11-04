import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { provisionPlatformSeasonalLocation } from '../src/services/adminPlatformLocations.js'
import { handleAdminPlatformRoutes } from '../src/routes/adminPlatformRoutes.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'

const input = () => ({ businessId: 'business-diwali', seasonId: 'season-2026', operatingYear: 2026,
  ownerUserId: 'target', slug: 'stall-a-2026', name: 'Stall A', address: 'Market Road', stallLabel: 'A' })

// In-memory D1 contract double only: no SQLite, Wrangler, files, or network.
function mockDb() {
  const db = {
    state: {
      users: { actor: { disabled_at: null, role: 'admin', password_hash: 'actor-hash' },
        target: { disabled_at: null, role: 'admin', password_hash: 'unchanged-hash' } },
      platform: ['actor'], business: { id: 'business-diwali', business_type: 'seasonal', status: 'active' },
      season: { id: 'season-2026', code: '2026', status: 'active' },
      memberships: { unrelated: { role: 'admin', disabled_at: null } },
      locations: [], associations: [], members: [], sessions: ['unchanged-session'],
    },
    batches: 0, calls: [], failAt: -1,
    prepare(sql) {
      const statement = {
        sql: sql.replace(/\s+/g, ' ').trim(), params: [],
        bind(...params) { return { ...statement, params } },
        async first() {
          db.calls.push(this)
          if (this.sql.startsWith('SELECT b.id')) return eligible(this.params) ? { id: db.state.business.id } : null
          if (this.sql.includes('FROM platform_admins')) return authorized(this.params[0]) ? { admin_user_id: this.params[0], ok: 1 } : null
          throw new Error(`Unexpected read: ${this.sql}`)
        },
        async all() {
          assert.match(this.sql, /FROM season_members/)
          return { results: [] }
        },
      }
      return statement
    },
    async batch(statements) {
      db.batches++
      db.beforeBatch?.()
      const before = structuredClone(db.state)
      const constraint = () => { throw new Error('D1_ERROR: NOT NULL constraint failed') }
      try {
        return statements.map((statement, index) => {
          db.beforeStatement?.(index)
          db.calls.push(statement)
          const { sql, params: p } = statement
          if (index === db.failAt) constraint()
          // Guard predicates and parameter order are part of this mock contract.
          assert.match(sql, /pa.admin_user_id = \? AND \(actor.disabled_at IS NULL OR actor.disabled_at = ''\)/)
          assert.match(sql, /b.business_type = 'seasonal' AND b.status = 'active'/)
          assert.match(sql, /s.id = 'season-2026' AND s.status = 'active' AND s.code = '2026'/)
          assert.match(sql, /target.disabled_at IS NULL OR target.disabled_at = ''/)
          assert.match(sql, /sm.role != 'owner'/)
          if (sql.startsWith('INSERT INTO business_locations')) {
            if (!eligible(p.slice(1, 4)) || db.state.locations.some(l => l.businessId === p[2] && l.slug === p[4])) constraint()
            db.state.locations.push({ id: p[0], businessId: p[2], slug: p[4], name: p[5], status: 'active' })
          } else if (sql.startsWith('INSERT INTO location_seasons')) {
            if (!locationEligible(p)) constraint()
            db.state.associations.push({ locationId: p[0], seasonId: 'season-2026', operatingYear: 2026, status: 'active' })
          } else if (sql.startsWith('INSERT INTO season_members')) {
            assert.equal(p[0], p[2])
            assert.equal(p[0], p[5])
            if (locationEligible(p.slice(1, 5)) && !db.state.memberships[p[0]]) db.state.memberships[p[0]] = { role: 'owner', disabled_at: null }
          } else if (sql.startsWith('INSERT INTO location_members')) {
            assert.equal(p[1], p[4])
            assert.equal(p[1], p[5])
            assert.match(sql, /ls.season_id = 'season-2026' AND ls.operating_year = 2026 AND ls.status = 'active'/)
            assert.match(sql, /sm.role = 'owner' AND \(sm.disabled_at IS NULL OR sm.disabled_at = ''\)/)
            if (!locationEligible(p.slice(0, 4)) || !db.state.associations.some(a => a.locationId === p[0] && a.seasonId === 'season-2026' && a.operatingYear === 2026 && a.status === 'active') || db.state.memberships[p[1]]?.role !== 'owner') constraint()
            db.state.members.push({ locationId: p[0], userId: p[1], role: 'owner', seasonId: 'season-2026' })
          } else throw new Error(`Unexpected write: ${sql}`)
          return { success: true, meta: { changes: 1 } }
        })
      } catch (error) { db.state = before; throw error }
    },
  }
  const enabled = row => row && (row.disabled_at == null || row.disabled_at === '')
  const authorized = actor => db.state.platform.includes(actor) && enabled(db.state.users[actor])
  function eligible([owner, business, actor]) {
    const s = db.state, membership = s.memberships[owner]
    return authorized(actor) && enabled(s.users[owner]) && s.business?.id === business &&
      s.business.status === 'active' && s.business.business_type === 'seasonal' &&
      s.season?.id === 'season-2026' && s.season.code === '2026' && s.season.status === 'active' &&
      (!membership || membership.role === 'owner' && enabled(membership))
  }
  function locationEligible([locationId, ...guard]) {
    return eligible(guard) && db.state.locations.some(l => l.id === locationId && l.businessId === guard[1] && l.status === 'active')
  }
  return db
}

async function route(db, body, actor = 'actor', attach = true) {
  const request = new Request('https://example.test/api/admin/platform/locations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const identity = { userId: actor, email: `${actor}@example.test`, role: 'owner' }
  if (attach) await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: 'false' })
  return handleAdminPlatformRoutes(request, new URL(request.url), { identity }, { DB: db, ADMIN_LOCATION_MODE: 'false' })
}

describe('release-only platform seasonal location provisioning (mock D1)', () => {
  it('routes a platform admin without season membership and atomically provisions an owner', async () => {
    const db = mockDb(), before = structuredClone(db.state)
    const response = await route(db, input())
    assert.equal(response.status, 201)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    const result = await response.json()
    assert.match(result.location.id, /^location-[a-f0-9]{32}$/)
    assert.equal(result.location.businessId, input().businessId)
    assert.equal(result.association.locationId, result.location.id)
    assert.equal(result.owner.userId, 'target')
    assert.deepEqual(db.state.memberships.target, { role: 'owner', disabled_at: null })
    assert.equal(db.state.members[0].locationId, result.location.id)
    assert.equal(db.batches, 1)
    assert.deepEqual(db.state.users, before.users)
    assert.deepEqual(db.state.sessions, before.sessions)
    assert.deepEqual(db.state.business, before.business)
    assert.deepEqual(db.state.memberships.unrelated, before.memberships.unrelated)
  })

  it('preserves an existing owner membership and allocates distinct identities to different stalls', async () => {
    const db = mockDb()
    db.state.memberships.target = { role: 'owner', disabled_at: '', created_at: 'original' }
    const member = structuredClone(db.state.memberships.target)
    const first = await provisionPlatformSeasonalLocation(db, 'actor', input())
    const second = await provisionPlatformSeasonalLocation(db, 'actor', { ...input(), slug: 'stall-b-2026' })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.notEqual(first.location.id, second.location.id)
    assert.deepEqual(db.state.memberships.target, member)
  })

  it('rejects a repeated request without adding any records', async () => {
    const db = mockDb()
    assert.equal((await route(db, input())).status, 201)
    const before = structuredClone(db.state)
    assert.equal((await route(db, input())).status, 409)
    assert.deepEqual(db.state, before)
  })

  for (const failAt of [1, 2, 3]) it(`rolls back all records on batch statement ${failAt + 1} failure`, async () => {
    const db = mockDb(), before = structuredClone(db.state)
    db.failAt = failAt
    assert.equal((await route(db, input())).status, 409)
    assert.deepEqual(db.state, before)
  })

  for (const [label, mutate] of [
    ['disabled identity', s => { s.users.target.disabled_at = 'disabled' }],
    ['missing identity', s => { delete s.users.target }],
    ['disabled owner membership', s => { s.memberships.target = { role: 'owner', disabled_at: 'disabled' } }],
    ['lower season role', s => { s.memberships.target = { role: 'super_admin', disabled_at: null } }],
    ['invalid season role', s => { s.memberships.target = { role: 'invalid', disabled_at: null } }],
    ['archived business', s => { s.business.status = 'archived' }],
    ['permanent business', s => { s.business.business_type = 'permanent' }],
    ['archived season', s => { s.season.status = 'archived' }],
    ['mismatched business', s => { s.business.id = 'other' }],
    ['mismatched season code', s => { s.season.code = '2099' }],
  ]) {
    it(`rejects ${label} before writes`, async () => {
      const db = mockDb()
      mutate(db.state)
      const before = structuredClone(db.state)
      assert.equal((await route(db, input())).status, 409)
      assert.equal(db.batches, 0)
      assert.deepEqual(db.state, before)
    })
    it(`rechecks ${label} at write time`, async () => {
      const db = mockDb()
      db.beforeBatch = () => mutate(db.state)
      assert.equal((await route(db, input())).status, 409)
      assert.equal(db.state.locations.length, 0)
      assert.equal(db.state.associations.length, 0)
      assert.equal(db.state.members.length, 0)
    })
  }

  it('denies global owners and unattached requests at the route boundary', async () => {
    for (const attach of [true, false]) {
      const db = mockDb()
      const before = structuredClone(db.state)
      assert.equal((await route(db, input(), 'target', attach)).status, 403)
      assert.equal(db.batches, 0)
      assert.deepEqual(db.state, before)
    }
  })

  it('checks platform authorization in the service and again during writes', async () => {
    for (const revoke of [s => { s.platform = [] }, s => { s.users.actor.disabled_at = 'disabled' }]) {
      const db = mockDb()
      revoke(db.state)
      assert.equal((await provisionPlatformSeasonalLocation(db, 'actor', input())).status, 403)
      assert.equal(db.batches, 0)
      const race = mockDb()
      race.beforeBatch = () => revoke(race.state)
      assert.equal((await route(race, input())).status, 409)
      assert.equal(race.state.locations.length, 0)
      assert.equal(race.state.memberships.target, undefined)
    }
  })

  it('rolls back the newly inserted season owner if final authorization or ownership checks fail', async () => {
    for (const change of [
      s => { s.platform = [] },
      s => { s.locations[0].businessId = 'another-business' },
      s => { s.associations[0].operatingYear = 2099 },
      s => { s.memberships.target.role = 'admin' },
    ]) {
      const db = mockDb(), before = structuredClone(db.state)
      db.beforeStatement = index => { if (index === 3) change(db.state) }
      assert.equal((await route(db, input())).status, 409)
      assert.deepEqual(db.state, before)
    }
  })

  it('rejects unsupported seasons, years, IDs, malformed bodies and invalid fields without writes', async () => {
    for (const body of [null, [], 'text', { ...input(), seasonId: 'season-2099' }, { ...input(), operatingYear: '2026' },
      { ...input(), operatingYear: 2027 }, { ...input(), locationId: 'location-diwali-2026' },
      { ...input(), businessId: 'other' }, { ...input(), ownerUserId: 'missing' },
      { ...input(), name: ' ' }, { ...input(), name: 'x'.repeat(201) }, { ...input(), slug: 'bad/slug' },
      { ...input(), address: {} }, { ...input(), password: 'unwanted' }]) {
      const db = mockDb(), before = structuredClone(db.state)
      assert.ok([400, 409].includes((await route(db, body)).status))
      assert.equal(db.batches, 0)
      assert.deepEqual(db.state, before)
    }
  })

  it('normalizes slug and optional text and returns no credentials', async () => {
    const db = mockDb()
    const result = await provisionPlatformSeasonalLocation(db, 'actor', { ...input(), slug: ' STALL-A-2026 ', address: ' ', stallLabel: null })
    assert.equal(result.ok, true)
    assert.equal(result.location.slug, 'stall-a-2026')
    assert.equal(result.location.address, null)
    assert.doesNotMatch(JSON.stringify(result), /password|hash/)
  })
})
