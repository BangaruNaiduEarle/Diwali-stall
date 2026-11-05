import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workflowDb } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { parseAdminCustomerRequestVisibilityCutoff } from '../src/lib/adminCustomerRequestValidation.js'
import { listAdminCustomerRequests } from '../src/services/adminCustomerRequests.js'

const cutoff = '2026-11-05T15:45:16.000Z'
const protectedIds = ['cr-737b1d5a26c757f6588763e787854700', '77ece069-78e3-4fab-8a4d-ad118845dd47']

async function fixture(t) {
  const db = await workflowDb(t)
  await db.script(`
    INSERT INTO businesses VALUES('other-shop','other','Other','permanent','active');
    UPDATE business_locations SET business_id='other-shop' WHERE id='loc-b';
    INSERT INTO business_seasons(id,code,label,status) VALUES('season-2025','2025','Previous','active');
    INSERT INTO location_seasons VALUES('loc-a','season-2025',2025,'active');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2025','owner','owner');
    INSERT INTO location_members VALUES('loc-a','season-2025','owner','owner',NULL);
  `)
  const rows = [
    ...protectedIds.map(id => [id, '2000-01-01 00:00:00', 'loc-a', 'season-2026']),
    ['old', '2026-11-05 15:45:15.999', 'loc-a', 'season-2026'],
    ['boundary-sqlite', '2026-11-05 15:45:16', 'loc-a', 'season-2026'],
    ['boundary-iso', cutoff, 'loc-a', 'season-2026'],
    ['future', '2099-01-01T00:00:00.000Z', 'loc-a', 'season-2026'],
    ['other-business', '2099-01-01T00:00:00.000Z', 'loc-b', 'season-2026'],
    ['other-season', '2099-01-01T00:00:00.000Z', 'loc-a', 'season-2025'],
  ]
  for (const [id, created, location, season] of rows) {
    await db.prepare(`INSERT INTO customer_requests(id,status,source,customer_name,created_at,location_id,season_id)
      VALUES(?,'received','web',?,?,?,?)`).bind(id, 'Visible fixture '+id, created, location, season).run()
  }
  return db
}

async function api(db, query = '', { value = cutoff, omitCutoff = false, location = 'loc-a', season = 'season-2026', actor = 'owner' } = {}) {
  const url = new URL('https://fixture.invalid/api/admin/customer-requests'+query)
  const request = new Request(url, { headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': location } })
  const identity = { userId: actor, email: actor+'@test.com' }
  const attached = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: true })
  if (!attached.ok) return Response.json(attached, { status: attached.status })
  return handleAdminCustomerRequestRoutes(request, { DB: db, ...(!omitCutoff ? { ADMIN_CUSTOMER_REQUEST_VISIBLE_FROM: value } : {}) }, url, identity)
}

test('visibility cutoff rejects missing, invalid, ambiguous and impossible timestamps', async () => {
  for (const value of [undefined, '', 'garbage', '2026-11-05', '2026-11-05T15:45:16', '2026-02-30T00:00:00Z']) {
    assert.equal(parseAdminCustomerRequestVisibilityCutoff(value), null)
  }
  assert.equal(parseAdminCustomerRequestVisibilityCutoff('2026-11-05T15:45:16Z'), cutoff)
  await assert.rejects(listAdminCustomerRequests({}, {limit:10,offset:0}), /cutoff is required/)
})

test('list SQL keeps both protected IDs, cutoff boundary and future requests before search, count and pagination', async t => {
  const db = await fixture(t)
  const snapshot = async () => ({
    requests: (await db.prepare('SELECT * FROM customer_requests ORDER BY id').bind().all()).results,
    history: (await db.prepare('SELECT * FROM request_workflow_events ORDER BY event_id').bind().all()).results,
  })
  const before = await snapshot()
  const response = await api(db)
  assert.equal(response.status, 200)
  const all = await response.json()
  assert.deepEqual(all.requests.map(r=>r.id).sort(), [...protectedIds,'boundary-sqlite','boundary-iso','future'].sort())
  assert.deepEqual(all.pagination, {page:1,limit:10,total:5,totalPages:1})
  const seen = []
  for (let page=1;page<=3;page++) {
    const res = await api(db, `?page=${page}&limit=2&q=Visible&status=received`)
    assert.equal(res.status,200)
    const data = await res.json()
    assert.deepEqual(data.pagination,{page,limit:2,total:5,totalPages:3})
    seen.push(...data.requests.map(r=>r.id))
  }
  assert.equal(new Set(seen).size,5)
  assert.deepEqual(seen,all.requests.map(r=>r.id))
  const hidden = await (await api(db,'?q=old')).json()
  assert.equal(hidden.pagination.total,0)
  const status = await (await api(db,'?status=closed')).json()
  assert.equal(status.pagination.total,0)
  assert.equal((await api(db,'?limit=101')).status,400)
  assert.equal((await (await api(db,'?limit=100')).json()).pagination.limit,100)
  assert.deepEqual(await snapshot(),before)
})

test('visibility exceptions cannot bypass business/location, season or membership authorization', async t => {
  const db = await fixture(t)
  const previous = await api(db,'',{season:'season-2025'})
  assert.equal(previous.status,200)
  assert.deepEqual((await previous.json()).requests.map(r=>r.id),['other-season'])
  assert.equal((await api(db,'',{location:'loc-b'})).status,403)
  assert.equal((await api(db,'',{actor:'unknown'})).status,403)
  await db.prepare('UPDATE customer_requests SET location_id=? WHERE id=?').bind('loc-b',protectedIds[0]).run()
  const data = await (await api(db)).json()
  assert.equal(data.requests.some(r=>r.id===protectedIds[0]),false)
  assert.equal(data.requests.some(r=>r.id===protectedIds[1]),true)
  assert.equal(data.pagination.total,4)
})

test('list API fails closed for absent or invalid Worker cutoff even with protected requests', async t => {
  const db = await fixture(t)
  assert.equal((await api(db, '', { omitCutoff: true })).status, 503)
  for (const value of [null,'','bad','2026-02-30T00:00:00Z']) {
    const res = await api(db,'?q=Visible',{value})
    assert.equal(res.status,503)
    const data = await res.json()
    assert.equal(data.error,'request_visibility_unavailable')
    assert.equal(data.requests,undefined)
  }
})
