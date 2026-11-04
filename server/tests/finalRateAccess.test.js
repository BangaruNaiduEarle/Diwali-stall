import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { locationMembersDb, season, smKey, lmKey } from './helpers/mockLocationMembersDb.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { handleAdminUsersRoutes } from '../src/routes/adminUsersRoutes.js'
import { handleAdminCatalogueRoutes } from '../src/routes/adminCatalogue.js'
import { handleAdminSession } from '../src/routes/admin.js'
import { setLocationFinalRateAccess, listLocationAdminUsers } from '../src/services/adminLocationMembers.js'
import { filterAdminProductForRole } from '../src/lib/adminProductResponse.js'
import { showAdminProductFinalRate, showAdminProductSensitiveColumns } from '../../src/admin/lib/adminProductTableColumns.js'
import { parseAdminSessionPayload, adminOperationalContextKey } from '../../src/admin/lib/adminSeasonSession.js'

// Reuse membership fixtures and the established SQLite :memory: harness pattern.
// No Wrangler process, on-disk database or network is used by these tests.
const foundation = readFileSync(new URL('../database/migrations/0020_business_location_foundation.sql', import.meta.url), 'utf8')
const seasonFoundation = readFileSync(new URL('../database/migrations/0018_business_seasons_foundation.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../database/migrations/0027_location_final_rate_access.sql', import.meta.url), 'utf8')
const schema = `CREATE TABLE admin_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT,
 role TEXT, password_hash TEXT, disabled_at TEXT, created_at TEXT, updated_at TEXT);
 CREATE TABLE business_seasons (id TEXT PRIMARY KEY, code TEXT, label TEXT, status TEXT);
 ${seasonFoundation.match(/CREATE TABLE season_members \([\s\S]*?\n\);/)[0]}
 ${foundation.slice(foundation.indexOf('CREATE TABLE businesses ('), foundation.indexOf('-- Membership existence'))}
 ${migration}`
const sqlite = `import json,sqlite3,sys
p=json.load(sys.stdin)
d=sqlite3.connect(':memory:'); d.row_factory=sqlite3.Row
d.execute('PRAGMA foreign_keys=ON'); d.executescript(p['schema'])
for table,rows in p['tables'].items():
 for row in rows:
  keys=list(row)
  d.execute('INSERT INTO '+table+' ('+','.join(keys)+') VALUES ('+','.join('?' for _ in keys)+')',list(row.values()))
d.commit()
if p.get('migration_after_seed'):
 before=[dict(r) for r in d.execute('SELECT * FROM location_members')]
 d.executescript(p['migration_after_seed'])
 after=[dict(r) for r in d.execute('SELECT * FROM location_members')]
 assert all(r.pop('can_view_final_rate')==0 for r in after)
 assert before==after
 try:
  d.execute('UPDATE location_members SET can_view_final_rate=2')
  raise AssertionError('Invalid permission accepted')
 except sqlite3.IntegrityError:
  d.rollback()
d.execute(p['sql'],p['values'])
changes=d.execute('SELECT changes()').fetchone()[0]
assert not list(d.execute('PRAGMA foreign_key_check'))
print(json.dumps({'changes':changes,'members':[dict(r) for r in d.execute('SELECT * FROM location_members')]}))`

function fixture() {
  const db = locationMembersDb(), prepare = db.prepare.bind(db)
  db.state.locationMembers.get(lmKey('staff', 'loc-b')).role = 'admin'
  db.prepare = sql => {
    if (/^UPDATE location_members SET can_view_final_rate/.test(sql)) return { bind: (...values) => ({
      async run() {
        db.beforeFinalRateWrite?.()
        const names = { users: 'admin_users', seasons: 'business_seasons', businesses: 'businesses', locations: 'business_locations', associations: 'location_seasons', seasonMembers: 'season_members', locationMembers: 'location_members' }
        const tables = Object.fromEntries(Object.entries(names).map(([key, table]) => [table, [...db.state[key].values()]]))
        const win = process.platform === 'win32'
        const output = JSON.parse(execFileSync(win ? 'py' : 'python3', win ? ['-3','-c',sqlite] : ['-c',sqlite], {
          input: JSON.stringify({ schema, tables, sql, values }), encoding: 'utf8', windowsHide: true,
        }))
        db.state.locationMembers = new Map(output.members.map(row => [lmKey(row.admin_user_id,row.location_id,row.season_id),row]))
        return { meta: { changes: output.changes } }
      },
    }) }
    if (sql.includes('FROM products p')) return { bind: (...values) => {
      const product = values.includes('loc-a') && !values.includes('P999') ? {
        id:'P001', category_slug:'cat-a', category_label:'Category', name:'Product', active:1, stock_status:'available', images_json:'[]',
        selling_price_paise:1000, final_price_paise:800, x4_selling_paise:1200, purchase_rate_paise:400,
      } : null
      return { first: async()=>sql.includes('COUNT(*)')?{total:product?1:0}:product, all: async()=>({results:product?[product]:[]}) }
    } }
    return prepare(sql)
  }
  return db
}
async function request(db, path, actor='owner', location='loc-a', body, extraHeaders={}) {
  const req = new Request('https://fixture.test'+path, { method:body===undefined?'GET':'POST', headers:{
    'X-Admin-Season-Id':season, 'X-Admin-Location-Id':location, 'Content-Type':'application/json', ...extraHeaders,
  }, ...(body===undefined?{}:{body:JSON.stringify(body)}) })
  const identity={userId:actor,email:actor+'@test.com',role:'owner'}
  const attached=await attachAdminRequestContext(req,db,identity,{ADMIN_LOCATION_MODE:true})
  return {req,identity,attached,context:getAdminContext(req)}
}
async function users(db, actor, target='staff', body={enabled:true}, location='loc-a') {
  const r=await request(db,`/api/admin/users/${target}/final-rate-access`,actor,location,body)
  if(!r.attached.ok)return Response.json(r.attached,{status:r.attached.status})
  return handleAdminUsersRoutes(r.req,{DB:db},{identity:r.identity})
}
async function product(db, actor='staff', path='/api/admin/products/P001', headers={}) {
  const r=await request(db,path,actor,'loc-a',undefined,headers)
  assert.equal(r.attached.ok,true)
  return handleAdminCatalogueRoutes(r.req,{DB:db},new URL(r.req.url),r.identity)
}
async function session(db, location='loc-a') {
  const r=await request(db,'/api/admin/session','staff',location)
  const response=await handleAdminSession(r.req,{identity:r.identity},{DB:db,ADMIN_LOCATION_MODE:true})
  assert.equal(response.status,200)
  return parseAdminSessionPayload(await response.json())
}

test('migration preserves populated memberships and defaults every existing grant to denied',()=>{
  const db=fixture(), names={users:'admin_users',seasons:'business_seasons',businesses:'businesses',locations:'business_locations',associations:'location_seasons',seasonMembers:'season_members',locationMembers:'location_members'}
  const tables=Object.fromEntries(Object.entries(names).map(([key,table])=>[table,[...db.state[key].values()]]))
  const win=process.platform==='win32'
  const output=JSON.parse(execFileSync(win?'py':'python3',win?['-3','-c',sqlite]:['-c',sqlite],{encoding:'utf8',windowsHide:true,
    input:JSON.stringify({schema:schema.replace(migration,''),tables,migration_after_seed:migration,sql:'SELECT 1',values:[]})}))
  assert.equal(output.members.length,db.state.locationMembers.size)
  assert.ok(output.members.every(row=>row.can_view_final_rate===0))
})

test('permission changes fail clearly without migration; no fallback or implicit grant',async()=>{
  const db=fixture(), prepare=db.prepare.bind(db)
  db.prepare=sql=>sql.startsWith('UPDATE location_members SET can_view_final_rate')?{bind:()=>({run:async()=>{throw Error('no such column: can_view_final_rate')}})}:prepare(sql)
  const response=await users(db,'owner')
  assert.equal(response.status,503)
  assert.equal((await response.json()).error,'final_rate_schema_required')
  assert.equal((await session(db)).capabilities.viewFinalRate,false)
})

test('default deny and strict read-only UI capability; Owner/Super Admin access is preserved', async()=>{
  const db=fixture(), r=await request(db,'/api/admin/products','staff')
  assert.equal(r.context.locationContext.capabilities.viewFinalRate,false)
  assert.equal(showAdminProductFinalRate('admin'),false)
  assert.equal(showAdminProductFinalRate('admin',{viewFinalRate:'true'}),false)
  assert.equal(showAdminProductFinalRate('admin',{viewFinalRate:true}),true)
  assert.equal(showAdminProductSensitiveColumns('admin'),false)
  for(const role of ['owner','super_admin']){
    assert.equal(showAdminProductFinalRate(role),true)
    assert.equal(filterAdminProductForRole({finalPricePaise:800,purchaseRatePaise:400},role).purchaseRatePaise,400)
  }
})

for(const actor of ['owner','super'])test(`${actor} can grant/revoke for one Admin in one stall; real SQLite guarded write`,async()=>{
  const db=fixture(), auth=await request(db,'/api/admin/users',actor)
  const before=structuredClone(db.state.locationMembers.get(lmKey('staff','loc-b')))
  assert.equal((await users(db,actor)).status,200)
  assert.equal(db.state.locationMembers.get(lmKey('staff')).can_view_final_rate,1)
  assert.equal(db.state.locationMembers.get(lmKey('staff','loc-b')).can_view_final_rate,0)
  assert.equal(db.state.locationMembers.get(lmKey('staff','loc-b')).role,before.role)
  assert.equal((await listLocationAdminUsers(db,season,auth.context)).find(u=>u.id==='staff').canViewFinalRate,true)
  assert.equal((await users(db,actor,'staff',{enabled:false})).status,200)
  assert.equal(db.state.locationMembers.get(lmKey('staff')).can_view_final_rate,0)
})

test('Admin cannot self-grant or change others; fake global role is ignored',async()=>{
  const db=fixture()
  for(const target of ['staff','super'])assert.equal((await users(db,'staff',target)).status,403)
  const r=await request(db,'/api/admin/users','staff')
  await assert.rejects(setLocationFinalRateAccess(db,season,r.context,'staff',true),e=>e.status===403)
})

test('cross-stall actor/target and scope injection are rejected',async()=>{
  const db=fixture()
  db.state.locationMembers.delete(lmKey('owner','loc-b'))
  assert.equal((await users(db,'owner','staff',{enabled:true},'loc-b')).status,403)
  db.state.locationMembers.delete(lmKey('staff'))
  assert.equal((await users(db,'owner')).status,404)
  assert.equal((await users(db,'owner','super',{enabled:true,locationId:'loc-b'})).status,400)
  assert.equal((await users(db,'owner','super',{enabled:'true'})).status,400)
})

test('privileged targets, archived stalls and disabled memberships cannot be granted',async()=>{
  const db=fixture()
  assert.equal((await users(db,'owner','super')).status,400)
  db.state.locationMembers.get(lmKey('staff')).disabled_at='disabled'
  assert.equal((await users(db,'owner')).status,409)
  db.state.locationMembers.get(lmKey('owner')).disabled_at='disabled'
  assert.equal((await users(db,'owner')).status,403)
  const archived=fixture();archived.state.locations.get('loc-a').status='archived'
  assert.equal((await users(archived,'owner')).status,403)
})

test('atomic write denies actor demotion and target promotion after the authorization snapshot',async()=>{
  for(const race of ['actor','target']){
    const db=fixture()
    db.beforeFinalRateWrite=()=>{
      if(race==='actor')db.state.locationMembers.get(lmKey('owner')).role='admin'
      else {db.state.locationMembers.get(lmKey('staff')).role='owner';db.state.seasonMembers.get(smKey('staff')).role='owner'}
    }
    assert.equal((await users(db,'owner')).status,409)
    assert.equal(db.state.locationMembers.get(lmKey('staff')).can_view_final_rate,0)
  }
})

test('direct catalogue APIs redact Final Rate by default and after revocation; grant exposes no other private pricing',async()=>{
  const db=fixture()
  assert.equal((await (await product(db)).json()).product.finalPricePaise,undefined)
  assert.equal((await (await product(db,'staff','/api/admin/products/P001',{'X-Can-View-Final-Rate':'true'})).json()).product.finalPricePaise,undefined)
  await users(db,'owner')
  for(const path of ['/api/admin/products/P001','/api/admin/products','/api/admin/products?page=1']){
    const response=await product(db,'staff',path), body=await response.json(), row=body.product??body.products[0]
    assert.equal(row.finalPricePaise,800);assert.equal(row.sellingPricePaise,1000)
    for(const key of ['purchaseRatePaise','purchaseRateInr','x4SellingPricePaise','privateX4Paise','pricingMapping'])assert.equal(row[key],undefined)
    assert.equal(response.headers.get('cache-control'),'no-store')
  }
  assert.equal((await product(db,'staff','/api/admin/products/P999')).status,404)
  await users(db,'super','staff',{enabled:false})
  assert.equal((await (await product(db)).json()).product.finalPricePaise,undefined)
})

test('Final Rate read access cannot bypass price-write or purchase-rate API gates',async()=>{
  const db=fixture();await users(db,'owner')
  assert.equal((await product(db,'staff','/api/admin/products/P001/purchase-rate')).status,403)
  for(const field of ['finalPriceInr','final_price_inr']){
    const r=await request(db,'/api/admin/products','staff','loc-a',{id:'P002',[field]:99})
    assert.equal((await handleAdminCatalogueRoutes(r.req,{DB:db},new URL(r.req.url),r.identity)).status,403)
    const edit=await request(db,'/api/admin/products/P001','staff','loc-a',{[field]:99})
    const patch=new Request(edit.req,{method:'PATCH'})
    await attachAdminRequestContext(patch,db,edit.identity,{ADMIN_LOCATION_MODE:true})
    assert.equal((await handleAdminCatalogueRoutes(patch,{DB:db},new URL(patch.url),edit.identity)).status,403)
  }
})

test('session refresh/re-login reads current grant; switching stalls and revocation clear capability/context key',async()=>{
  const db=fixture(), before=await session(db)
  assert.equal(before.capabilities.viewFinalRate,false)
  await users(db,'owner')
  const granted=await session(db)
  assert.equal(granted.capabilities.viewFinalRate,true)
  assert.notEqual(adminOperationalContextKey(before),adminOperationalContextKey(granted))
  assert.equal((await session(db,'loc-b')).capabilities.viewFinalRate,false)
  await users(db,'owner','staff',{enabled:false})
  const revoked=await session(db)
  assert.equal(revoked.capabilities.viewFinalRate,false)
  assert.notEqual(adminOperationalContextKey(granted),adminOperationalContextKey(revoked))
})
