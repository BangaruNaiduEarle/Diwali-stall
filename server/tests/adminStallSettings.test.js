import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { workflowDb } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { handleAdminStallSettings } from '../src/routes/adminStallSettings.js'
import { getStallSettings } from '../src/services/adminStallSettings.js'
import { siteConfig } from '../../src/data/siteConfig.js'
import worker from '../src/index.js'

const migration = readFileSync(new URL('../database/migrations/0026_stall_settings.sql', import.meta.url),'utf8')
async function setup(t, {migrate = true} = {}) {
  const db = await workflowDb(t,{migrate:false})
  await db.script(`ALTER TABLE business_locations ADD COLUMN address TEXT;
    ALTER TABLE business_locations ADD COLUMN stall_label TEXT;
    ALTER TABLE business_locations ADD COLUMN updated_at TEXT;
    CREATE UNIQUE INDEX fixture_location_seasons_key ON location_seasons(location_id,season_id);
    INSERT INTO admin_users(id,email,display_name,role) VALUES('owner-b','owner-b@test.com','Owner B','owner');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2026','owner-b','owner');
    INSERT INTO location_members VALUES('loc-b','season-2026','owner-b','owner',NULL);`)
  if(migrate) await db.script(migration)
  return db
}
async function requestContext(db,{actor='owner',location='loc-a',season='season-2026',method='GET',body,path='settings',mode=true}={}) {
  const request = new Request('https://example.test/api/admin/'+path,{method,headers:{
    'Content-Type':'application/json','X-Admin-Location-Id':location,'X-Admin-Season-Id':season,
  },...(body===undefined?{}:{body:JSON.stringify(body)})})
  const attached = await attachAdminRequestContext(request,db,{userId:actor,email:actor+'@test.com'},{ADMIN_LOCATION_MODE:mode})
  return {request,attached}
}
async function api(db,opts={}) {
  const {request,attached} = await requestContext(db,opts)
  return attached.ok ? handleAdminStallSettings(request,{DB:db}) : Response.json(attached,{status:attached.status})
}
async function get(db,opts={}) {
  const response=await api(db,opts);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return response.json()
}
const patch = (db,body,opts={}) => api(db,{...opts,method:'PATCH',body})
const count = async (db,table) => (await db.prepare(`SELECT count(*) n FROM ${table}`).bind().first()).n

test('default GET is side-effect free and new stalls never inherit the original contact or dates',async t=>{
  const db=await setup(t),a=await get(db),b=await get(db,{actor:'owner-b',location:'loc-b'})
  assert.equal(a.profile.phone,'');assert.equal(b.profile.phone,'');assert.equal(a.profile.brandName,'Shop')
  assert.deepEqual(a.season.stallDates,[]);assert.deepEqual(a.revisions,{profile:0,season:0})
  assert.equal(a.permissions.canUpdate,true);assert.equal(a.sources.profile,'location_defaults')
  for(const table of ['location_settings','location_season_settings','location_settings_events'])assert.equal(await count(db,table),0)
})

test('Owner and Super Admin independently update profile and season settings without touching B or global settings',async t=>{
  const db=await setup(t),beforeB=await get(db,{actor:'owner-b',location:'loc-b'})
  const global=await db.prepare('SELECT * FROM platform_settings').bind().all()
  let response=await patch(db,{profile:{phone:'9876543210',stallName:'New A',locationAddress:'A address'},expectedProfileRevision:0,
    season:{stallDates:['November 6, 2026','2026-11-07'],stallTimings:'9 AM to 10 PM'},expectedSeasonRevision:0})
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()))
  let a=await response.json();assert.deepEqual(a.revisions,{profile:1,season:1});assert.equal(a.profile.phone,'9876543210')
  assert.equal((await db.prepare('SELECT name,address FROM business_locations WHERE id = ?').bind('loc-a').first()).name,'New A')
  assert.equal(a.updated.profile.byUserId,'owner')
  response=await patch(db,{profile:{whatsappNumber:'+919876543210'},expectedProfileRevision:1},{actor:'super'})
  assert.equal(response.status,200);a=await response.json();assert.equal(a.revisions.profile,2)
  assert.deepEqual(await get(db,{actor:'owner-b',location:'loc-b'}),beforeB)
  assert.deepEqual(await db.prepare('SELECT * FROM platform_settings').bind().all(),global)
  assert.equal(await count(db,'location_settings_events'),2)
})

test('Admin receives only read-only display settings and cannot mutate regardless of global role',async t=>{
  const db=await setup(t)
  await db.prepare("UPDATE admin_users SET role = 'owner' WHERE id = 'admin'").bind().run()
  const a=await get(db,{actor:'admin'});assert.equal(a.permissions.canUpdate,false);assert.equal(a.updated,undefined)
  assert.equal((await patch(db,{profile:{phone:'9876543210'},expectedProfileRevision:0},{actor:'admin'})).status,403)
  assert.equal(await count(db,'location_settings_events'),0)
})

test('foreign stall headers, removed membership, disabled account and Platform-only authority cannot grant access',async t=>{
  const db=await setup(t)
  assert.equal((await api(db,{location:'loc-b'})).status,403)
  await db.script("INSERT INTO platform_admins(admin_user_id) VALUES('owner');")
  assert.equal((await api(db,{location:'loc-b'})).status,403)
  await db.prepare("UPDATE location_members SET disabled_at = 'revoked' WHERE admin_user_id = 'owner'").bind().run()
  assert.equal((await api(db)).status,403)
  assert.equal((await get(db,{actor:'owner-b',location:'loc-b'})).permissions.canUpdate,true)
  await db.prepare("UPDATE admin_users SET disabled_at = 'disabled' WHERE id = 'owner-b'").bind().run()
  assert.equal((await api(db,{actor:'owner-b',location:'loc-b'})).status,403)
})

test('same user Owner in A and Admin in B cannot carry privileges across stalls',async t=>{
  const db=await setup(t)
  await db.script("INSERT INTO location_members VALUES('loc-b','season-2026','owner','admin',NULL);")
  assert.equal((await get(db)).permissions.canUpdate,true)
  assert.equal((await get(db,{location:'loc-b'})).permissions.canUpdate,false)
  assert.equal((await patch(db,{profile:{phone:'9876543210'},expectedProfileRevision:0},{location:'loc-b'})).status,403)
})

test('season schedules are independent while profile fields are explicitly location-wide',async t=>{
  const db=await setup(t)
  await db.script(`INSERT INTO business_seasons(id,code,label,status) VALUES('season-next','next','Next','active');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-next','owner','owner');
    INSERT INTO location_seasons VALUES('loc-a','season-next',2027,'active');
    INSERT INTO location_members VALUES('loc-a','season-next','owner','owner',NULL);`)
  assert.equal((await patch(db,{profile:{phone:'9876543210'},expectedProfileRevision:0,season:{stallDates:['2026-11-06']},expectedSeasonRevision:0})).status,200)
  const next=await get(db,{season:'season-next'});assert.equal(next.profile.phone,'9876543210');assert.deepEqual(next.season.stallDates,[])
  assert.equal((await patch(db,{season:{stallDates:['2027-10-29']},expectedSeasonRevision:0},{season:'season-next'})).status,200)
  assert.deepEqual((await get(db)).season.stallDates,['2026-11-06'])
  await db.prepare("UPDATE business_seasons SET status = 'archived' WHERE id = 'season-next'").bind().run()
  assert.equal((await get(db,{season:'season-next'})).permissions.canUpdate,false)
  assert.equal((await patch(db,{profile:{phone:'9999999999'},expectedProfileRevision:1},{season:'season-next'})).status,403)
})

test('verified original single-stall defaults preserve siteConfig without rewriting canonical metadata or seeding B',async t=>{
  const db=await setup(t)
  await db.script(`INSERT INTO businesses VALUES('business-diwali','diwali','Diwali','seasonal','active');
    INSERT INTO business_locations(id,business_id,slug,name,status) VALUES('location-diwali-2026','business-diwali','diwali-2026','Diwali 2026','active');
    INSERT INTO location_seasons VALUES('location-diwali-2026','season-2026',2026,'active');
    INSERT INTO location_members VALUES('location-diwali-2026','season-2026','owner','owner',NULL);`)
  const original=await get(db,{location:'location-diwali-2026'})
  for(const key of ['brandName','whatsappNumber','phone','locationName','locationAddress','locationDetailLines','locationMapUrl'])assert.deepEqual(original.profile[key],siteConfig[key],key)
  assert.deepEqual(original.season,{stallDates:siteConfig.stallDates,stallTimings:siteConfig.stallTimings})
  assert.equal(original.profile.stallName,'Diwali 2026');assert.equal(await count(db,'location_settings'),0)
  assert.equal((await patch(db,{profile:{phone:''},expectedProfileRevision:0},{location:'location-diwali-2026'})).status,200)
  assert.equal((await get(db,{location:'location-diwali-2026'})).profile.phone,'')
  assert.equal((await get(db,{actor:'owner-b',location:'loc-b'})).profile.phone,'')
})

test('validation rejects financial/scope/prototype fields, invalid dates/URLs, missing revisions and unsupported methods',async t=>{
  const db=await setup(t)
  const invalid=[{businessId:'foreign',profile:{phone:'9876543210'},expectedProfileRevision:0},
    {profile:{profit:100},expectedProfileRevision:0},{profile:{phone:'secret'},expectedProfileRevision:0},
    {profile:{locationMapUrl:'javascript:alert(1)'},expectedProfileRevision:0},
    {profile:{locationMapUrl:'https://user:pass@example.test/'},expectedProfileRevision:0},
    {profile:{stallName:''},expectedProfileRevision:0},{profile:{phone:null},expectedProfileRevision:0},
    {season:{stallDates:['February 31, 2026']},expectedSeasonRevision:0},
    {season:{stallDates:['2026-11-06','2026-11-06']},expectedSeasonRevision:0},
    JSON.parse('{"profile":{"__proto__":"value"},"expectedProfileRevision":0}'),
    {profile:{constructor:'value'},expectedProfileRevision:0}]
  for(const body of invalid)assert.equal((await patch(db,body)).status,400,JSON.stringify(body))
  assert.equal((await patch(db,{profile:{phone:'9876543210'}})).status,428)
  assert.equal((await api(db,{path:'settings?locationId=loc-b'})).status,400)
  assert.equal((await api(db,{method:'DELETE'})).status,405)
  assert.equal(await count(db,'location_settings_events'),0)
})

test('unchanged saves are no-ops and stale retries cannot duplicate audit events or silently overwrite',async t=>{
  const db=await setup(t),body={profile:{phone:'9876543210'},expectedProfileRevision:0}
  assert.equal((await patch(db,body)).status,200)
  assert.equal((await patch(db,body)).status,409)
  const response=await patch(db,{...body,expectedProfileRevision:1});assert.equal(response.status,200);assert.equal((await response.json()).changed,false)
  assert.equal(await count(db,'location_settings_events'),1)
  assert.equal((await get(db)).revisions.profile,1)
})

test('concurrent same-revision saves have one winner and independent stalls do not share revisions',async t=>{
  const db=await setup(t)
  const replies=await Promise.all(['9876543210','9876543211'].map(phone=>patch(db,{profile:{phone},expectedProfileRevision:0})))
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,409])
  assert.equal(await count(db,'location_settings_events'),1)
  assert.equal((await patch(db,{profile:{phone:'9876543212'},expectedProfileRevision:0},{actor:'owner-b',location:'loc-b'})).status,200)
  assert.equal((await get(db)).revisions.profile,1)
  assert.equal((await get(db,{actor:'owner-b',location:'loc-b'})).revisions.profile,1)
})

test('commit-time demotion rolls back lazy settings rows, canonical edits and audit atomically',async t=>{
  const db=await setup(t),batch=db.batch
  db.batch=async statements=>{
    if(statements.some(s=>s.sql.startsWith('INSERT INTO location_settings_events'))){db.batch=batch;await db.prepare("UPDATE location_members SET role = 'admin' WHERE admin_user_id = 'owner'").bind().run()}
    return batch(statements)
  }
  assert.equal((await patch(db,{profile:{stallName:'Unauthorized'},expectedProfileRevision:0})).status,403)
  for(const table of ['location_settings','location_season_settings','location_settings_events'])assert.equal(await count(db,table),0)
  assert.equal((await db.prepare("SELECT name FROM business_locations WHERE id = 'loc-a'").bind().first()).name,'A')
})

test('injected audit failure preserves all prior settings and canonical metadata',async t=>{
  const db=await setup(t)
  assert.equal((await patch(db,{profile:{phone:'9876543210'},expectedProfileRevision:0})).status,200)
  const before=await get(db)
  await db.script("CREATE TRIGGER fail_settings_audit BEFORE INSERT ON location_settings_events BEGIN SELECT RAISE(ABORT,'audit_failure'); END;")
  const failed=await patch(db,{profile:{phone:'9999999999',stallName:'Lost'},expectedProfileRevision:1,season:{stallTimings:'New'},expectedSeasonRevision:0})
  assert.equal(failed.status,503);assert.ok(!JSON.stringify(await failed.json()).includes('audit_failure'))
  assert.deepEqual(await get(db),before);assert.equal(await count(db,'location_settings_events'),1)
})

test('settings audit events are immutable and exclude unrelated financial/credential data',async t=>{
  const db=await setup(t)
  assert.equal((await patch(db,{profile:{phone:'9876543210'},expectedProfileRevision:0},{actor:'super'})).status,200)
  const event=await db.prepare('SELECT * FROM location_settings_events').bind().first()
  assert.equal(event.actor_user_id,'super');assert.equal(event.actor_role,'super_admin');assert.equal(event.location_id,'loc-a')
  assert.deepEqual(JSON.parse(event.changes_json),{profile:{phone:{before:'',after:'9876543210'}}})
  await assert.rejects(db.prepare('UPDATE location_settings_events SET changes_json = ?').bind('{}').run(),/immutable/)
  await assert.rejects(db.prepare('DELETE FROM location_settings_events').bind().run(),/immutable/)
  await assert.rejects(db.prepare('INSERT OR REPLACE INTO location_settings_events SELECT * FROM location_settings_events').bind().run(),/scope_or_duplicate/)
})

test('fresh service reads revalidate revoked memberships instead of trusting a captured context',async t=>{
  const db=await setup(t),{request}=await requestContext(db)
  const context=getAdminContext(request)
  await db.prepare("DELETE FROM location_members WHERE admin_user_id = 'owner'").bind().run()
  await assert.rejects(getStallSettings(db,{seasonId:'season-2026',context}),error=>error.status===403)
})

test('missing settings schema fails explicitly; legacy mode remains unchanged and does not infer a location',async t=>{
  const db=await setup(t,{migrate:false})
  assert.equal((await api(db)).status,503)
  const legacy=await setup(t,{migrate:false}),before=await legacy.prepare('SELECT * FROM platform_settings').bind().all()
  assert.equal((await api(legacy,{mode:false})).status,503)
  assert.deepEqual(await legacy.prepare('SELECT * FROM platform_settings').bind().all(),before)
})

test('migration preserves existing locations and globals; season foreign keys and audit business scope are enforced',async t=>{
  const db=await setup(t,{migrate:false})
  const beforeLocations=await db.prepare('SELECT * FROM business_locations').bind().all()
  const beforeGlobal=await db.prepare('SELECT * FROM platform_settings').bind().all()
  await db.script(migration)
  assert.deepEqual(await db.prepare('SELECT * FROM business_locations').bind().all(),beforeLocations)
  assert.deepEqual(await db.prepare('SELECT * FROM platform_settings').bind().all(),beforeGlobal)
  await assert.rejects(db.prepare('INSERT INTO location_season_settings(location_id,season_id) VALUES(?,?)').bind('loc-a','foreign-season').run(),/FOREIGN KEY/)
  await assert.rejects(db.prepare(`INSERT INTO location_settings_events(event_id,business_id,location_id,season_id,actor_user_id,actor_role,profile_revision,season_revision,changes_json)
    VALUES('forged-event','foreign-business','loc-a','season-2026','owner','owner',0,0,'{}')`).bind().run(),/settings_event_scope_or_duplicate/)
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').bind().all()).results,[])
})

test('Worker rejects unauthenticated settings requests before accessing settings storage',async()=>{
  const response=await worker.fetch(new Request('https://example.test/api/admin/settings'),{DB:{},ADMIN_LOCATION_MODE:true},{})
  assert.equal(response.status,401)
})
