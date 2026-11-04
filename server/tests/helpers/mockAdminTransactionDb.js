import assert from 'node:assert/strict'
import { attachAdminRequestContext, getAdminContext } from '../../src/middleware/requireAdmin.js'
import { ADMIN_LOCATION_CONTEXT_SQL } from '../../src/services/adminLocationContext.js'

const season = 'season-2027', previous = 'season-2026'
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const OLD = '33333333-3333-4333-8333-333333333333', WEB = '55555555-5555-4555-8555-555555555555'

function fixture() {
  const request = (id, location_id, season_id, source = 'manual') => ({ id, location_id, season_id, status: 'quoted', source, finalization_status: source === 'web' ? null : 'pending', customer_name: 'Guest', customer_phone: '9876543210', created_at: '2026-01-01', updated_at: '', public_reference: id.slice(0, 8) })
  const item = (request_id, product_id = 'P001') => ({ request_id, line_number: 1, product_id, family_pack_id: null, product_name: product_id, quantity: 1, unit_price_paise: 10000 })
  const quote = (id, customer_request_id, location_id, season_id) => ({ id, customer_request_id, location_id, season_id, status: 'draft', currency: 'INR', subtotal_paise: 10000, total_paise: 10000, adjustment_paise: 0, pricing_mode: 'selling', selling_subtotal_paise: 10000, final_subtotal_paise: 8000, accepted_amount_paise: 10000, created_at: '2026-01-01' })
  const state = {
    categories: [{ slug: 'cat-a', location_id: 'loc-a' }, { slug: 'cat-b', location_id: 'loc-b' }],
    customer_requests: [request(A, 'loc-a', season), request(B, 'loc-b', season), request(OLD, 'loc-a', previous), request(WEB, 'loc-a', season, 'web')],
    customer_request_items: [item(A), item(B, 'P002'), item(OLD), item(WEB)],
    products: [{ id: 'P001', category_slug: 'cat-a', location_id: 'loc-a', season_id: previous, name: 'A product', active: 1, stock_status: 'available', selling_price_paise: 10000, final_price_paise: 8000, pieces_per_pack: 10, allow_loose_sale: 1 }, { id: 'P002', category_slug: 'cat-b', location_id: 'loc-b', season_id: season, name: 'B product', active: 1, selling_price_paise: 90000 }],
    family_packs: [{ id: 'FP001', location_id: 'loc-a', season_id: previous, name: 'A pack', active: 1, selling_price_paise: 5000 }, { id: 'FP002', location_id: 'loc-b', season_id: season, name: 'B pack', active: 1, selling_price_paise: 90000 }],
    quotations: [quote('q-a', A, 'loc-a', season), quote('q-b', B, 'loc-b', season), quote('q-old', OLD, 'loc-a', previous), quote('q-web', WEB, 'loc-a', season)],
    quotation_items: [{ quotation_id: 'q-a', line_number: 1, product_id: 'P001', product_name: 'A product', quantity: 1, unit_rate_paise: 10000, line_total_paise: 10000 }],
    users: [{ id: 'assignee', email: 'staff@test.com', role: 'admin', disabled_at: null }],
    assigneeSeason: { role: 'admin', disabled_at: null, status: 'active' },
    assigneeLocation: { role: 'admin', disabled_at: null, location_id: 'loc-a', season_id: season, status: 'active' },
  }
  const db = {
    state, calls: [], beforeBatch: null, beforeRun: null,
    prepare(raw) {
      const sql = raw.replace(/\s+/g, ' ').trim()
      return { bind(...v) {
        assert.equal((sql.match(/\?/g) ?? []).length, v.length, sql)
        const call = mode => {
          db.calls.push({ sql, v: [...v], mode })
          const result = mode === 'run' ? mutate(sql, v) : select(raw, sql, v)
          return mode === 'first' ? result[0] ?? null : mode === 'all' ? { results: result } : result
        }
        return { async first() { return call('first') }, async all() { return call('all') }, async run() { return call('run') } }
      } }
    },
    async batch(statements) {
      db.beforeBatch?.(state)
      const before = structuredClone(state)
      try { const results = []; for (const statement of statements) results.push(await statement.run()); return results }
      catch (error) { for (const key of Object.keys(state)) state[key] = before[key]; throw error }
    },
  }
  function bindings(sql, v, alias = '', start = 0) {
    const results = []
    for (const m of sql.matchAll(/\b(?:(\w+)\.)?(\w+)\s*=\s*\?/g)) {
      if (m.index < start || (m[1] ?? '') !== alias) continue
      results.push([m[2], v[(sql.slice(0, m.index).match(/\?/g) ?? []).length]])
    }
    return results
  }
  const matches = (row, sql, v, alias = '', start = 0) => bindings(sql, v, alias, start).every(([key, value]) => row[key] === value)
  const isOpen = r => r && !['closed', 'void'].includes(r.status) && r.finalization_status !== 'finalized'
  const ownedRequest = (id, sql, v) => state.customer_requests.find(r => r.id === id && matches(r, sql, v, 'scoped_request') && (!sql.includes('scoped_request.status NOT IN') || isOpen(r)))
  const boundIs = (row, sql, v, alias = '') => [...sql.matchAll(new RegExp(`\\b${alias ? alias + '\\.' : ''}(\\w+) IS \\?`, 'g'))].every(m =>
    (row[m[1]] ?? null) === (v[(sql.slice(0, m.index).match(/\?/g) ?? []).length] ?? null))
  const snapshotMatches = (r, sql, v) => {
    if (!sql.includes('guard_quote')) return true
    const active = state.quotations.filter(q => q.customer_request_id === r.id && q.location_id === r.location_id && q.season_id === r.season_id && q.status !== 'void')
    if (sql.includes('NOT EXISTS (SELECT 1 FROM quotations guard_quote')) return active.length === 0
    return active.some(q => matches(q, sql, v, 'guard_quote') && boundIs(q, sql, v, 'guard_quote'))
  }
  const ownedQuote = (id, sql, v) => state.quotations.find(q => q.id === id && matches(q, sql, v, 'scoped_quote') && (!sql.includes('scoped_request') || ownedRequest(q.customer_request_id, sql, v)))
  const ownedCategory = product => state.categories.some(c => c.slug === product.category_slug && c.location_id === product.location_id)
  const validChildren = request => request && state.customer_request_items.filter(i => i.request_id === request.id).every(i =>
    !(i.product_id && i.family_pack_id) &&
    (!i.product_id || state.products.some(p => p.id === i.product_id && p.location_id === request.location_id && ownedCategory(p))) &&
    (!i.family_pack_id || state.family_packs.some(p => p.id === i.family_pack_id && p.location_id === request.location_id)))
  function select(raw, sql, v) {
    if (sql.includes('FROM request_payment_summaries')) return state.customer_requests.filter(r => v[0] === 'shop' && r.location_id === v[1] && r.season_id === v[2] && v.slice(3).includes(r.id)).map(r => {
      const quote = state.quotations.find(q => q.customer_request_id === r.id && q.status !== 'void')
      const due = r.finalization_status === 'finalized' ? quote?.accepted_amount_paise ?? null : null
      return { request_id: r.id, revision: r.revision ?? 0, amount_due_paise: due, received_paise: 0, outstanding_paise: due,
        payment_status: 'UNPAID', payment_count: 0, last_payment_at: null, request_status: r.status, finalization_status: r.finalization_status }
    })
    if (raw === ADMIN_LOCATION_CONTEXT_SQL) return [{
      season_user_id: 'u-1', member_season_id: v[1], season_role: state.seasonRole ?? 'owner', season_disabled_at: null,
      season_id: v[1], season_code: v[1], season_label: v[1], season_status: 'active',
      location_user_id: 'u-1', member_location_id: 'loc-a', location_member_season_id: v[1], location_role: state.locationRole ?? 'owner', location_disabled_at: null,
      location_id: 'loc-a', location_business_id: 'shop', location_slug: 'a', location_name: 'A', location_status: 'active',
      business_id: 'shop', business_slug: 'shop', business_name: 'Shop', business_type: 'permanent', business_status: 'active',
      association_location_id: 'loc-a', association_season_id: v[1], operating_year: Number(v[1].slice(-4)), association_status: 'active',
    }]
    if (sql.includes('FROM platform_admins')) return []
    if (sql.includes('FROM season_members sm') && sql.includes('sm.season_id = ?')) {
      const lm = state.assigneeLocation
      const valid = !sql.includes('location_members') || (lm && lm.location_id === v.at(-1) && lm.season_id === v[0] && !lm.disabled_at && (sql.includes("lm.role IN ('owner', 'super_admin')") ? ['owner', 'super_admin'] : ['owner', 'super_admin', 'admin']).includes(lm.role) && lm.status === 'active')
      return valid && state.assigneeSeason ? [{ ...state.assigneeSeason }] : []
    }
    if (sql.includes('FROM season_members')) return [previous, season].map(season_id => ({ season_id, role: state.seasonRole ?? 'owner', disabled_at: null, status: 'active', code: season_id, label: season_id, created_at: '' }))
    if (sql.includes('FROM admin_users')) return state.users.filter(u => u.id === v[0] || u.email === v[0])
    if (sql.includes('AS mismatch')) return state.quotations.some(q => q.customer_request_id === v[0] && q.status !== 'void' && (q.location_id !== v[1] || q.season_id !== v[2])) ? [{ mismatch: 1 }] : []
    if (/FROM (products|family_packs) WHERE/.test(sql)) {
      const table = sql.match(/FROM (products|family_packs) WHERE/)[1]
      return state[table].filter(r => matches(r, sql, v) && (!sql.includes('scope_category') || ownedCategory(r)) && (!sql.includes('id IN') || v.includes(r.id))).map(r => ({ ...r }))
    }
    // Quotation reads now include a correlated request-revision projection.
    if (sql.includes('FROM quotations WHERE')) return state.quotations.filter(q => matches(q, sql, v) && matches(q, sql, v, 'quotations') && (!sql.includes('scoped_request') || ownedRequest(q.customer_request_id, sql, v)) && (!sql.includes("status != 'void'") || q.status !== 'void')).map(q => ({ ...q }))
    if (sql.includes('FROM customer_requests r') || /^SELECT .* FROM customer_requests WHERE/.test(sql)) {
      const alias = sql.includes('FROM customer_requests r') ? 'r' : ''
      let rows = state.customer_requests.filter(r => matches(r, sql, v, alias) && (alias || matches(r, sql, v, 'customer_requests')))
      if (sql.startsWith('SELECT COUNT(*)')) return [{ total: rows.length }]
      rows = rows.toSorted((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      if (sql.includes('LIMIT ? OFFSET ?')) rows = rows.slice(v.at(-1), v.at(-1) + v.at(-2))
      return rows.map(r => ({ ...r, item_count: state.customer_request_items.filter(i => i.request_id === r.id).length }))
    }
    if (sql.startsWith('SELECT COUNT(*) AS n FROM customer_request_items')) return [{ n: state.customer_request_items.filter(i => i.request_id === v[0] && (!sql.includes('scoped_request') || ownedRequest(i.request_id, sql, v))).length }]
    if (sql.includes('FROM customer_request_items')) {
      const alias = sql.includes('FROM customer_request_items i') ? 'i' : ''
      return state.customer_request_items.filter(i => matches(i, sql, v, alias) && (!sql.includes('scoped_request') || ownedRequest(i.request_id, sql, v))).map(i => ({ ...i }))
    }
    if (sql.includes('FROM quotation_items WHERE')) return state.quotation_items.filter(i => matches(i, sql, v) && (!sql.includes('scoped_quote') || ownedQuote(i.quotation_id, sql, v))).map(i => ({ ...i }))
    if (sql.includes('FROM quotations WHERE')) return state.quotations.filter(q => matches(q, sql, v) && matches(q, sql, v, 'quotations') && (!sql.includes('scoped_request') || ownedRequest(q.customer_request_id, sql, v)) && (!sql.includes("status != 'void'") || q.status !== 'void')).map(q => ({ ...q }))
    throw Error('Unexpected SELECT: ' + sql)
  }
  function mutate(sql, v) {
    // Actor context is updated in the same batch; this mock leaves trigger and
    // persistence behavior to the dedicated real SQLite workflow tests.
    if (sql.startsWith('UPDATE customer_requests SET audit_actor_user_id')) return { meta: { changes: 1 } }
    db.beforeRun?.(sql, state)
    if (sql.startsWith('INSERT INTO customer_requests')) {
      const [id, public_reference, customer_name, customer_phone, customer_area, pickup_preference, customer_note, delivery_address, delivery_landmark, delivery_maps_url, source, season_id, location_id] = v
      if (state.customer_requests.some(r => r.id === id)) throw Error('UNIQUE constraint failed: customer_requests.id')
      if (state.customer_requests.some(r => r.public_reference === public_reference)) throw Error('UNIQUE constraint failed: customer_requests.public_reference')
      state.customer_requests.push({ id, public_reference, customer_name, customer_phone, customer_area, pickup_preference, customer_note, delivery_address, delivery_landmark, delivery_maps_url, source, season_id, location_id, status: 'received', created_at: '2027-01-01' })
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('UPDATE customer_requests')) {
      const rows = state.customer_requests.filter(r => matches(r, sql, v, '', sql.indexOf('WHERE')) && matches(r, sql, v, 'customer_requests') && (!sql.includes('customer_requests.status NOT IN') || isOpen(r)) && (!sql.includes('scoped_item') || validChildren(r)))
      let changes = 0
      for (const r of rows) {
        if (sql.includes('SET status = CASE')) {
          if (sql.includes('checkout_product')) {
            const scoped = sql.includes('checkout_product.location_id')
            const count = (v.length - (scoped ? 4 : 2)) / 5
            let valid = state.checkoutContextActive !== false
            for (let i = 0; i < count; i++) {
              const [id, selling, final, pieces, loose] = v.slice(i * 5, i * 5 + 5)
              const p = state.products.find(p => p.id === id && (scoped ? p.location_id === r.location_id : p.season_id === r.season_id))
              valid &&= p && p.active === 1 && !['soldout', 'sold-out'].includes(p.stock_status) &&
                (p.selling_price_paise ?? null) === selling && (p.final_price_paise ?? null) === final &&
                (p.pieces_per_pack ?? null) === pieces && (p.allow_loose_sale ?? null) === loose
            }
            if (!valid) throw Error('NOT NULL constraint failed: customer_requests.status')
            changes++
            continue
          }
          if (!isOpen(r) || !boundIs(r, sql.split('AND EXISTS')[0], v) || !snapshotMatches(r, sql, v)) throw Error('NOT NULL constraint failed: customer_requests.status')
          changes++
          continue
        }
        if (sql.includes('guard_quote') && (!boundIs(r, sql.split('AND EXISTS')[0], v) || !snapshotMatches(r, sql, v))) continue
        if (sql.includes('SET assigned_to_email')) { r.assigned_to_email = v[0]; r.assigned_by_email = v[1] }
        else if (sql.includes("finalization_status = 'finalized'")) { r.finalization_status = 'finalized'; r.status = 'closed'; r.closed_by_email = v[0] }
        else if (sql.includes("SET finalization_status = 'pending'")) { r.finalization_status = 'pending'; if (sql.includes('raw_message = ?')) r.raw_message = v[0] }
        else { r.status = v[0]; if (sql.includes('closed_by_email = ?')) r.closed_by_email = v[1] }
        changes++
      }
      return { meta: { changes } }
    }
    if (sql.startsWith('DELETE FROM customer_request_items')) {
      const allowed = !sql.includes('scoped_request') || ownedRequest(v[0], sql, v)
      const before = state.customer_request_items.length
      if (allowed) state.customer_request_items = state.customer_request_items.filter(i => i.request_id !== v[0])
      return { meta: { changes: before - state.customer_request_items.length } }
    }
    if (sql.startsWith('INSERT INTO customer_request_items')) {
      const guarded = sql.includes('(SELECT id FROM customer_requests')
      if (guarded && (!state.customer_requests.some(r => r.id === v[0] && r.location_id === v[1] && r.season_id === v[2]) ||
          (v[3] != null && !state.products.some(p => p.id === v[4] && p.location_id === v[5] && (!sql.includes('scope_category') || ownedCategory(p)))) ||
          (v[6] != null && !state.family_packs.some(p => p.id === v[7] && p.location_id === v[8])))) throw Error('NOT NULL constraint failed: customer_request_items.request_id')
      const fields = guarded ? [v[0], ...v.slice(9)] : v
      const [request_id, line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise] = fields
      state.customer_request_items.push({ request_id, line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise })
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('UPDATE quotations')) {
      const rows = state.quotations.filter(q => matches(q, sql, v, '', sql.indexOf('WHERE')) && matches(q, sql, v, 'quotations') && boundIs(q, sql, v) && (!sql.includes('scoped_request') || ownedRequest(q.customer_request_id, sql, v)))
      rows.forEach(q => { if (sql.includes('SET accepted_amount_paise')) q.accepted_amount_paise = v[0]; else q.status = 'void' })
      return { meta: { changes: rows.length } }
    }
    if (sql.startsWith('INSERT INTO quotations')) {
      const guarded = sql.includes('(SELECT id FROM customer_requests')
      const parent = guarded ? state.customer_requests.find(r => r.id === v[1] && r.location_id === v[2] && r.season_id === v[3] && (!sql.includes('scoped_item') || validChildren(r))) : state.customer_requests.find(r => r.id === v[1])
      const a = guarded ? [v[0], parent?.id ?? null, ...v.slice(4, -1)] : v
      const [id, customer_request_id, customer_name, customer_phone, customer_note, subtotal_paise, total_paise, wa_message_text, created_by_email, pricing_mode, selling_subtotal_paise, final_subtotal_paise, bargain_floor_paise, accepted_amount_paise, season_id] = a
      state.quotations.push({ id, customer_request_id, customer_name, customer_phone, customer_note, subtotal_paise, total_paise, wa_message_text, created_by_email, pricing_mode, selling_subtotal_paise, final_subtotal_paise, bargain_floor_paise, accepted_amount_paise, season_id, location_id: guarded ? v.at(-1) : null, status: 'draft' })
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('INSERT INTO quotation_items')) {
      const guarded = sql.includes('(SELECT id FROM quotations')
      if (guarded) {
        const q = state.quotations.find(q => q.id === v[0] && q.location_id === v[1] && q.season_id === v[2])
        if (!q || !state.customer_requests.some(r => r.id === q.customer_request_id && r.location_id === v[3] && r.season_id === v[4] && (!sql.includes('scoped_item') || validChildren(r))) ||
            (v[5] != null && !state.products.some(p => p.id === v[6] && p.location_id === v[7] && (!sql.includes('scope_category') || ownedCategory(p))))) throw Error('NOT NULL constraint failed: quotation_items.quotation_id')
      }
      const a = guarded ? [v[0], ...v.slice(8)] : v
      const [quotation_id, line_number, product_id, product_name, quantity, unit_rate_paise, line_total_paise] = a
      state.quotation_items.push({ quotation_id, line_number, product_id, product_name, quantity, unit_rate_paise, line_total_paise })
      return { meta: { changes: 1 } }
    }
    throw Error('Unexpected mutation: ' + sql)
  }
  return db
}

async function attach(db, { operatingSeason = season, mode = true, path = '', method = 'GET', payload } = {}) {
  const req = new Request('https://example.test/api/admin/customer-requests' + path, {
    method, headers: { 'X-Admin-Season-Id': operatingSeason, 'X-Admin-Location-Id': 'loc-a', 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })
  assert.equal((await attachAdminRequestContext(req, db, { userId: 'u-1', email: 'owner@test.com' }, { ADMIN_LOCATION_MODE: mode })).ok, true)
  return { req, context: getAdminContext(req) }
}
const actor = { actorEmail: 'owner@test.com', seasonId: season }


export { fixture, attach, season, previous, A, B, OLD, WEB, actor }
