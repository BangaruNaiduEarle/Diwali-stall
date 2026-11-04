import assert from 'node:assert/strict'
import { ADMIN_LOCATION_CONTEXT_SQL } from '../../src/services/adminLocationContext.js'

export const season = 'season-2027'
export const smKey = (user, s = season) => `${s}:${user}`
export const lmKey = (user, location = 'loc-a', s = season) => `${location}:${s}:${user}`
export function locationMembersDb() {
  const user = (id, role) => ({ id, email: `${id}@test.com`, role, display_name: id, disabled_at: null, password_hash: 'original-hash', created_at: '2026', updated_at: '2026' })
  const state = {
    users: new Map(['owner', 'super', 'staff', 'other', 'invite'].map(id => [id, user(id, id === 'owner' || id === 'other' ? 'owner' : id === 'super' ? 'super_admin' : 'admin')])),
    seasons: new Map([season, 'season-2026', 'season-2099'].map(id => [id, { id, code: id, label: id, status: 'active' }])),
    businesses: new Map([['shop', { id: 'shop', slug: 'shop', name: 'Shop', business_type: 'permanent', status: 'active' }]]),
    locations: new Map(['loc-a', 'loc-b'].map(id => [id, { id, business_id: 'shop', slug: id, name: id, status: 'active' }])),
    associations: new Map(['loc-a', 'loc-b'].map(id => [`${id}:${season}`, { location_id: id, season_id: season, operating_year: 2027, status: 'active' }])),
    seasonMembers: new Map(['owner', 'super', 'staff', 'other'].map(id => [smKey(id), { season_id: season, admin_user_id: id, role: id === 'owner' || id === 'other' ? 'owner' : 'super_admin', disabled_at: null, created_at: '2026' }])),
    locationMembers: new Map(['loc-a', 'loc-b'].flatMap(loc => ['owner', 'super', 'staff'].map(id => [lmKey(id, loc), { location_id: loc, season_id: season, admin_user_id: id, role: id === 'owner' ? 'owner' : id === 'super' || loc === 'loc-b' ? 'super_admin' : 'admin', disabled_at: null, created_at: '2026' }]))),
    sessions: new Map([['staff-a', 'staff'], ['staff-b', 'staff'], ['owner-session', 'owner']]),
  }
  const active = value => value == null || value === ''
  const ranks = ['admin', 'super_admin', 'owner']
  const db = {
    state, calls: [], beforeBatch: null,
    prepare(raw) {
      const sql = raw.replace(/\s+/g, ' ').trim()
      const bind = (...v) => {
        assert.equal((sql.match(/\?/g) ?? []).length, v.length, sql)
        return {
          sql: raw, values: v,
          async first() { db.calls.push({ sql, v, mode: 'first' }); return select(raw, sql, v)[0] ?? null },
          async all() { db.calls.push({ sql, v, mode: 'all' }); return { results: select(raw, sql, v) } },
          async run() { db.calls.push({ sql, v, mode: 'run' }); const result = mutate(sql, v); db.lastChanges = result.meta.changes; return result },
        }
      }
      return { bind, first: () => bind().first(), all: () => bind().all() }
    },
    async batch(statements) {
      db.beforeBatch?.(state)
      const before = structuredClone(state)
      try { const results = []; for (const statement of statements) results.push(await statement.run()); return results }
      catch (error) { Object.assign(state, before); throw error }
    },
  }
  function contextRows(uid, s) {
    const sm = state.seasonMembers.get(smKey(uid, s)), bs = state.seasons.get(s)
    if (!sm || !bs) return []
    const memberships = [...state.locationMembers.values()].filter(lm => lm.admin_user_id === uid && lm.season_id === s)
    return (memberships.length ? memberships : [{}]).map(lm => {
      const l = state.locations.get(lm.location_id), b = state.businesses.get(l?.business_id), ls = state.associations.get(`${lm.location_id}:${s}`)
      return {
        season_user_id: uid, member_season_id: s, season_role: sm.role, season_disabled_at: sm.disabled_at,
        season_id: s, season_code: bs.code, season_label: bs.label, season_status: bs.status,
        location_user_id: lm.admin_user_id, member_location_id: lm.location_id, location_member_season_id: lm.season_id,
        location_role: lm.role, location_disabled_at: lm.disabled_at,
        can_view_final_rate: lm.can_view_final_rate,
        location_id: l?.id, location_business_id: l?.business_id, location_slug: l?.slug, location_name: l?.name, location_status: l?.status,
        business_id: b?.id, business_slug: b?.slug, business_name: b?.name, business_type: b?.business_type, business_status: b?.status,
        association_location_id: ls?.location_id, association_season_id: ls?.season_id, operating_year: ls?.operating_year, association_status: ls?.status,
      }
    })
  }
  function memberRows(loc, s, business, uid) {
    if (state.locations.get(loc)?.business_id !== business || !state.associations.has(`${loc}:${s}`)) return []
    return [...state.locationMembers.values()].filter(lm => lm.location_id === loc && lm.season_id === s && (!uid || lm.admin_user_id === uid)).flatMap(lm => {
      const au = state.users.get(lm.admin_user_id), sm = state.seasonMembers.get(smKey(lm.admin_user_id, s))
      return au && sm ? [{ ...au, can_view_final_rate: lm.can_view_final_rate, location_role: lm.role, location_disabled_at: lm.disabled_at, season_role: sm.role, season_disabled_at: sm.disabled_at, user_disabled_at: au.disabled_at, membership_created_at: lm.created_at }] : []
    })
  }
  function select(raw, sql, v) {
    if (raw === ADMIN_LOCATION_CONTEXT_SQL) return contextRows(...v)
    if (sql.startsWith('SELECT location_id, role FROM location_members')) return [...state.locationMembers.values()]
      .filter(lm => lm.season_id === v[0] && lm.admin_user_id === v[1] && lm.location_id !== v[2])
    if (sql.includes('FROM platform_admins')) return []
    if (sql.includes('FROM location_members lm')) return memberRows(...v)
    if (sql.includes('FROM season_members sm')) return [...state.seasonMembers.values()].filter(sm => sm.admin_user_id === v[0]).map(sm => ({ ...sm, ...state.seasons.get(sm.season_id) }))
    if (sql.includes('FROM season_members WHERE')) { const sm = state.seasonMembers.get(smKey(v[1], v[0])); return sm ? [sm] : [] }
    if (sql.startsWith('SELECT COUNT(*) AS n FROM admin_users')) return [{ n: [...state.users.values()].filter(u => active(u.disabled_at)).length }]
    if (sql.includes('FROM admin_users WHERE lower(email)')) return [...state.users.values()].filter(u => u.email.toLowerCase() === v[0])
    if (sql.includes('FROM admin_users WHERE id')) { const u = state.users.get(v[0]); return u ? [u] : [] }
    throw Error('Unexpected SELECT: ' + sql)
  }
  function guard(v) {
    const [loc, s, uid, sr, lr, biz] = v
    const sm = state.seasonMembers.get(smKey(uid, s)), lm = state.locationMembers.get(lmKey(uid, loc, s)), au = state.users.get(uid)
    return sm?.role === sr && lm?.role === lr && au && active(sm.disabled_at) && active(lm.disabled_at) && active(au.disabled_at) &&
      state.locations.get(loc)?.business_id === biz && [state.locations.get(loc), state.businesses.get(biz), state.associations.get(`${loc}:${s}`), state.seasons.get(s)].every(r => r?.status === 'active')
  }
  function mutate(sql, v) {
    if (sql.includes('WHERE changes() != 1')) {
      if (db.lastChanges !== 1) throw Error('NOT NULL constraint failed: location_members.location_id')
      return { meta: { changes: 0 } }
    }
    if (sql.startsWith('UPDATE season_members SET role')) {
      const [role, s, uid, previous] = v, sm = state.seasonMembers.get(smKey(uid, s))
      if (!sm || sm.role !== previous || !active(sm.disabled_at) || !active(state.users.get(uid)?.disabled_at) || !guard(v.slice(4, 10)) ||
        [...state.locationMembers.values()].some(lm => lm.season_id === s && lm.admin_user_id === uid && lm.location_id !== v[10] && ranks.indexOf(lm.role) > v[11])) return { meta: { changes: 0 } }
      sm.role = role
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('INSERT INTO admin_users')) {
      const [id, email, display_name, role, password_hash] = v
      if (!guard(v.slice(5, 11)) || [...state.users.values()].filter(u => active(u.disabled_at)).length >= v.at(-1)) return { meta: { changes: 0 } }
      if ([...state.users.values()].some(u => u.email === email)) throw Error('UNIQUE constraint failed: admin_users.email')
      state.users.set(id, { ...user(id, role), email, display_name, password_hash }); return { meta: { changes: 1 } }
    }
    if (sql.startsWith('INSERT INTO season_members')) {
      if (!guard(v.slice(1, 7))) throw Error('NOT NULL constraint failed: season_members.season_id')
      const [s, uid, role] = [v[0], v[7], v[8]]
      if (!state.users.has(uid)) throw Error('FOREIGN KEY constraint failed')
      if (state.seasonMembers.has(smKey(uid, s))) throw Error('UNIQUE constraint failed: season_members')
      state.seasonMembers.set(smKey(uid, s), { season_id: s, admin_user_id: uid, role, disabled_at: null }); return { meta: { changes: 1 } }
    }
    if (sql.startsWith('INSERT INTO location_members')) {
      const [loc, s, uid, role] = [v[0], v[1], v[11], v[12]], sm = state.seasonMembers.get(smKey(uid, s)), au = state.users.get(uid)
      if (!guard(v.slice(2, 8)) || !sm || !au || !active(sm.disabled_at) || !active(au.disabled_at) || ranks.indexOf(sm.role) < ranks.indexOf(role)) throw Error('NOT NULL constraint failed: location_members.location_id')
      if (state.locationMembers.has(lmKey(uid, loc, s))) throw Error('UNIQUE constraint failed: location_members')
      state.locationMembers.set(lmKey(uid, loc, s), { location_id: loc, season_id: s, admin_user_id: uid, role, disabled_at: null }); return { meta: { changes: 1 } }
    }
    if (/^(UPDATE|DELETE FROM) location_members/.test(sql)) {
      const shift = sql.startsWith('UPDATE') ? 1 : 0, [loc, s, uid, role] = v.slice(shift, shift + 4)
      const lm = state.locationMembers.get(lmKey(uid, loc, s)), sm = state.seasonMembers.get(smKey(uid, s)), au = state.users.get(uid)
      if (!lm || lm.role !== role || !guard(v.slice(shift + 4))) return { meta: { changes: 0 } }
      if (sql.includes('target_sm') && (!active(sm?.disabled_at) || !active(au?.disabled_at) || ranks.indexOf(sm?.role) < ranks.indexOf(sql.includes('SET role') ? v[0] : lm.role))) return { meta: { changes: 0 } }
      if (sql.includes('other_lm') && role === 'owner' && active(lm.disabled_at) && ![...state.locationMembers.values()].some(other => other.location_id === loc && other.season_id === s && other.admin_user_id !== uid && other.role === 'owner' && active(other.disabled_at) && state.seasonMembers.get(smKey(other.admin_user_id, s))?.role === 'owner' && active(state.seasonMembers.get(smKey(other.admin_user_id, s))?.disabled_at) && active(state.users.get(other.admin_user_id)?.disabled_at))) return { meta: { changes: 0 } }
      if (!shift) state.locationMembers.delete(lmKey(uid, loc, s))
      else if (sql.includes('SET role')) lm.role = v[0]
      else lm.disabled_at = v[0]
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('UPDATE admin_users SET password_hash')) { state.users.get(v[1]).password_hash = v[0]; return { meta: { changes: 1 } } }
    if (sql.startsWith('DELETE FROM admin_sessions')) { for (const [key, uid] of state.sessions) if (uid === v[0]) state.sessions.delete(key); return { meta: { changes: 1 } } }
    throw Error('Unexpected mutation: ' + sql)
  }
  return db
}
