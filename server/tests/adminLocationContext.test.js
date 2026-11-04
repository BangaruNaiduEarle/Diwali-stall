import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_LOCATION_CONTEXT_SQL,
  resolveAdminLocationContext,
} from '../src/services/adminLocationContext.js'

const seasonId = 'season-2026'
const locationId = 'location-diwali-2026'

function fixture() {
  return {
    business_seasons: [{ id: seasonId, code: '2026', label: 'Diwali 2026', status: 'active' }],
    season_members: [{ admin_user_id: 'user-1', season_id: seasonId, role: 'owner', disabled_at: null }],
    businesses: [{ id: 'business-diwali', slug: 'diwali', name: 'Diwali', business_type: 'seasonal', status: 'active' }],
    business_locations: [{ id: locationId, business_id: 'business-diwali', slug: 'diwali-2026', name: 'First stall', status: 'active' }],
    location_members: [{ admin_user_id: 'user-1', season_id: seasonId, location_id: locationId, role: 'owner', disabled_at: null }],
    location_seasons: [{ location_id: locationId, season_id: seasonId, operating_year: 2026, status: 'active' }],
  }
}

// Relational D1 mock: derives rows from independent table fixtures, including
// the LEFT JOIN null cases. It exposes SELECT/all only; no database is opened.
function database(tables) {
  const calls = []
  return {
    calls,
    prepare(sql) {
      assert.equal(sql, ADMIN_LOCATION_CONTEXT_SQL)
      assert.match(sql, /WHERE sm\.admin_user_id = \? AND sm\.season_id = \?/)
      assert.match(sql, /lm\.admin_user_id = sm\.admin_user_id AND lm\.season_id = sm\.season_id/)
      assert.match(sql, /ls\.location_id = lm\.location_id AND ls\.season_id = lm\.season_id/)
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE)\b/)
      return {
        bind(userId, selectedSeason) {
          calls.push({ sql, userId, seasonId: selectedSeason })
          return {
            async all() {
              const results = []
              for (const sm of tables.season_members.filter(m => m.admin_user_id === userId && m.season_id === selectedSeason)) {
                const s = tables.business_seasons.find(s => s.id === sm.season_id)
                if (!s) continue
                const members = tables.location_members.filter(m => m.admin_user_id === sm.admin_user_id && m.season_id === sm.season_id)
                for (const lm of members.length ? members : [null]) {
                  const l = tables.business_locations.find(l => l.id === lm?.location_id)
                  const b = tables.businesses.find(b => b.id === l?.business_id)
                  const ls = tables.location_seasons.find(ls => ls.location_id === lm?.location_id && ls.season_id === lm?.season_id)
                  results.push({
                    season_user_id: sm.admin_user_id, member_season_id: sm.season_id,
                    season_role: sm.role, season_disabled_at: sm.disabled_at,
                    season_id: s.id, season_code: s.code, season_label: s.label, season_status: s.status,
                    location_user_id: lm?.admin_user_id ?? null, member_location_id: lm?.location_id ?? null,
                    location_member_season_id: lm?.season_id ?? null, location_role: lm?.role ?? null,
                    location_disabled_at: lm?.disabled_at ?? null,
                    location_id: l?.id ?? null, location_business_id: l?.business_id ?? null,
                    location_slug: l?.slug ?? null, location_name: l?.name ?? null, location_status: l?.status ?? null,
                    business_id: b?.id ?? null, business_slug: b?.slug ?? null, business_name: b?.name ?? null,
                    business_type: b?.business_type ?? null, business_status: b?.status ?? null,
                    association_location_id: ls?.location_id ?? null, association_season_id: ls?.season_id ?? null,
                    operating_year: ls?.operating_year ?? null, association_status: ls?.status ?? null,
                  })
                }
              }
              return { results }
            },
          }
        },
      }
    },
  }
}

function input(extra = {}, selectedLocation = locationId) {
  const headers = new Headers()
  if (selectedLocation !== null) headers.set('X-Admin-Location-Id', selectedLocation)
  return {
    userId: 'user-1', activeSeasonId: seasonId,
    request: new Request('https://example.test/api/admin/session', { headers }), ...extra,
  }
}

async function denied(tables, selection = input()) {
  const result = await resolveAdminLocationContext(database(tables), selection)
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.equal(result.code, 'forbidden')
  assert.equal('capabilities' in result, false)
  return result
}

describe('unwired admin location context', () => {
  it('resolves the seasonal business, both memberships and association from a bound read', async () => {
    const tables = fixture(), db = database(tables), before = structuredClone(tables)
    const result = await resolveAdminLocationContext(db, input({ access: 'write' }))
    assert.equal(result.ok, true)
    assert.equal(result.business.id, 'business-diwali')
    assert.equal(result.location.businessId, result.business.id)
    assert.equal(result.activeLocationId, locationId)
    assert.equal(result.activeSeasonId, seasonId)
    assert.equal(result.operatingSeason.status, 'active')
    assert.equal(result.association.operatingYear, 2026)
    assert.equal(result.seasonMembership.role, 'owner')
    assert.equal(result.locationMembership.role, 'owner')
    assert.equal(result.capabilities.write, true)
    assert.equal(result.selection, 'explicit')
    assert.deepEqual(db.calls.map(({ userId, seasonId }) => [userId, seasonId]), [['user-1', seasonId]])
    assert.deepEqual(tables, before)
  })

  it('derives business identity despite a conflicting client business header', async () => {
    const selection = input()
    selection.request.headers.set('X-Admin-Business-Id', 'business-attacker')
    const result = await resolveAdminLocationContext(database(fixture()), selection)
    assert.equal(result.ok, true)
    assert.equal(result.businessId, 'business-diwali')
  })

  it('reuses a permanent physical location with independently authorized operating seasons', async () => {
    const t = fixture()
    t.businesses[0].business_type = 'permanent'
    t.business_seasons.push({ id: 'season-2027', code: '2027', label: '2027', status: 'active' })
    t.season_members.push({ ...t.season_members[0], season_id: 'season-2027', role: 'admin' })
    t.location_members.push({ ...t.location_members[0], season_id: 'season-2027', role: 'admin' })
    t.location_seasons.push({ ...t.location_seasons[0], season_id: 'season-2027', operating_year: 2027 })
    const db = database(t)
    const first = await resolveAdminLocationContext(db, input())
    const second = await resolveAdminLocationContext(db, input({ activeSeasonId: 'season-2027' }))
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(first.activeLocationId, second.activeLocationId)
    assert.equal(first.businessId, second.businessId)
    assert.equal(second.association.operatingYear, 2027)
    assert.equal(second.seasonMembership.role, 'admin')
    assert.equal(second.capabilities.viewSensitiveProductPricing, false)
    t.location_members.pop()
    await denied(t, input({ activeSeasonId: 'season-2027' }))
  })

  for (const table of ['season_members', 'location_members']) {
    it(`rejects disabled ${table} without global owner/platform-admin bypass`, async () => {
      const t = fixture()
      t[table][0].disabled_at = '2026-11-01'
      await denied(t, input({ platformAdmin: true, role: 'owner' }))
    })
    it(`rejects missing ${table}`, async () => {
      const t = fixture()
      t[table] = []
      await denied(t)
    })
    it(`rejects unknown ${table} roles instead of normalizing to admin`, async () => {
      const t = fixture()
      t[table][0].role = 'platform_owner'
      await denied(t)
    })
  }

  for (const [label, change] of [
    ['different business', t => { t.business_locations[0].business_id = 'missing-business' }],
    ['different physical location', t => { t.business_locations[0].id = 'another-location' }],
    ['different member season', t => { t.location_members[0].season_id = 'season-2027' }],
    ['different member user', t => { t.location_members[0].admin_user_id = 'another-user' }],
    ['different association season', t => { t.location_seasons[0].season_id = 'season-2027' }],
    ['different association location', t => { t.location_seasons[0].location_id = 'another-location' }],
    ['missing association', t => { t.location_seasons = [] }],
    ['invalid operating year', t => { t.location_seasons[0].operating_year = 0 }],
  ]) {
    it(`rejects ${label}`, async () => {
      const t = fixture()
      change(t)
      await denied(t)
    })
  }

  for (const table of ['businesses', 'business_locations', 'business_seasons', 'location_seasons']) {
    it(`allows archived ${table} reads but disables all writes`, async () => {
      const t = fixture()
      t[table][0].status = 'archived'
      const result = await resolveAdminLocationContext(database(t), input())
      assert.equal(result.ok, true)
      assert.equal(result.capabilities.read, true)
      assert.equal(result.capabilities.write, false)
      assert.equal(result.capabilities.viewSensitiveProductPricing, true)
      for (const key of ['assignQuickBillCustomerRequests', 'finalizeQuickBillCustomerRequests', 'deleteAdminProducts', 'manageSeasonUsers', 'changeSeasonMemberRoles']) {
        assert.equal(result.capabilities[key], false, key)
      }
      assert.deepEqual(result.capabilities.createSeasonMemberWithRole, { owner: false, super_admin: false, admin: false })
      await denied(t, input({ access: 'write' }))
    })
    it(`fails closed for unknown ${table} status`, async () => {
      const t = fixture()
      t[table][0].status = 'unknown'
      await denied(t)
    })
  }

  it('auto-selects only the unambiguous authorized historical 2026 mapping', async () => {
    const result = await resolveAdminLocationContext(database(fixture()), input({}, null))
    assert.equal(result.ok, true)
    assert.equal(result.selection, 'legacy-2026')
    assert.equal(result.activeLocationId, locationId)
    const withoutRequest = await resolveAdminLocationContext(database(fixture()), { userId: 'user-1', activeSeasonId: seasonId })
    assert.equal(withoutRequest.ok, true)
  })

  it('requires explicit selection with multiple locations; never silently substitutes', async () => {
    const t = fixture()
    t.business_locations.push({ ...t.business_locations[0], id: 'second-location' })
    t.location_members.push({ ...t.location_members[0], location_id: 'second-location' })
    t.location_seasons.push({ ...t.location_seasons[0], location_id: 'second-location' })
    await denied(t, input({}, null))
    await denied(t, input({}, 'not-a-member'))
    const explicit = await resolveAdminLocationContext(database(t), input({}, 'second-location'))
    assert.equal(explicit.ok, true)
    assert.equal(explicit.activeLocationId, 'second-location')
    t.location_members[0].disabled_at = '2026-11-01'
    await denied(t, input())
    await denied(t, input({}, null))
  })

  it('rejects duplicate selected memberships as ambiguous', async () => {
    const t = fixture()
    t.location_members.push({ ...t.location_members[0] })
    await denied(t)
  })

  it('does not use an unrelated single location/business/year as a 2026 fallback', async () => {
    for (const change of [
      t => { t.businesses[0].id = t.business_locations[0].business_id = 'another-business' },
      t => { t.location_seasons[0].operating_year = 2027 },
      t => { t.business_locations[0].id = t.location_members[0].location_id = t.location_seasons[0].location_id = 'another-location' },
    ]) {
      const t = fixture()
      change(t)
      await denied(t, input({}, null))
    }
  })

  it('never auto-maps 2099, even with a fabricated single authorized association', async () => {
    const t = fixture()
    t.business_seasons.push({ id: 'season-2099', code: '2099', label: 'Protected test', status: 'active' })
    t.season_members.push({ ...t.season_members[0], season_id: 'season-2099' })
    await denied(t, input({ activeSeasonId: 'season-2099' }, null))
    await denied(t, input({ activeSeasonId: 'season-2099' }))
    t.location_members.push({ ...t.location_members[0], season_id: 'season-2099' })
    t.location_seasons.push({ ...t.location_seasons[0], season_id: 'season-2099', operating_year: 2099 })
    await denied(t, input({ activeSeasonId: 'season-2099' }, null))
  })

  it('never implicitly selects another season', async () => {
    const db = database(fixture())
    const result = await resolveAdminLocationContext(db, input({ activeSeasonId: '' }, null))
    assert.equal(result.ok, false)
    assert.equal(db.calls.length, 0)
    await denied(fixture(), input({ activeSeasonId: 'season-2027' }))
  })

  for (const seasonRole of ['owner', 'super_admin', 'admin']) {
    for (const locationRole of ['owner', 'super_admin', 'admin']) {
      it(`intersects ${seasonRole} season and ${locationRole} location capabilities`, async () => {
        const t = fixture()
        t.season_members[0].role = seasonRole
        t.location_members[0].role = locationRole
        const result = await resolveAdminLocationContext(database(t), input({ access: 'write', role: 'owner', platformAdmin: true }))
        assert.equal(result.ok, true)
        const c = result.capabilities
        const sensitive = seasonRole !== 'admin' && locationRole !== 'admin'
        const owner = seasonRole === 'owner' && locationRole === 'owner'
        assert.equal(c.viewSensitiveProductPricing, sensitive)
        assert.equal(c.finalizeQuickBillCustomerRequests, sensitive)
        assert.equal(c.manageSeasonUsers, sensitive)
        assert.equal(c.assignQuickBillCustomerRequests, true)
        assert.equal(c.deleteAdminProducts, owner)
        assert.equal(c.changeSeasonMemberRoles, owner)
        assert.deepEqual(c.createSeasonMemberWithRole, { owner, super_admin: owner, admin: sensitive })
      })
    }
  }

  it('rejects missing user, invalid access and an empty explicit header without a query', async () => {
    for (const selection of [input({ userId: '' }), input({ access: 'invalid' }), input({}, '')]) {
      const db = database(fixture())
      const result = await resolveAdminLocationContext(db, selection)
      assert.equal(result.ok, false)
      assert.equal(db.calls.length, 0)
    }
  })

  it('propagates database/schema errors without guessing a legacy mapping', async () => {
    const db = { prepare() { throw new Error('location schema unavailable') } }
    await assert.rejects(resolveAdminLocationContext(db, input()), /location schema unavailable/)
  })
})
