import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { workflowDb } from './helpers/workflowSqlite.js'
import { hashPassword } from '../src/lib/passwordHash.js'

test('native Worker/D1 settings API authenticates, isolates stalls and commits revisioned settings/audit atomically',async t=>{
  // Export schema from a NEW :memory: test fixture, never a local database file.
  // This uses real pre-0020 migrations plus the helper's minimal location model;
  // it is not a full-chain migration rehearsal or deployed-runtime sign-off.
  const source=await workflowDb(t,{migrate:false})
  await source.script(`ALTER TABLE business_locations ADD COLUMN address TEXT;
    ALTER TABLE business_locations ADD COLUMN stall_label TEXT;
    ALTER TABLE business_locations ADD COLUMN updated_at TEXT;
    CREATE UNIQUE INDEX fixture_location_seasons_key ON location_seasons(location_id,season_id);`)
  await source.script(readFileSync(new URL('../database/migrations/0026_stall_settings.sql',import.meta.url),'utf8'))
  const schema=await source.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name`).bind().all()
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/index.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,logLevel:'silent'})
  const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-01',host:'127.0.0.1',port:0,
    d1Databases:['DB'],d1Persist:false,cachePersist:false,kvPersist:false,r2Persist:false,durableObjectsPersist:false,
    bindings:{ADMIN_LOCATION_MODE:true,ADMIN_LOCAL_DEV_AUTH:false}})
  try {
    const base=await runtime.ready,db=await runtime.getD1Database('DB')
    for(const row of schema.results)await db.prepare(row.sql).run()
    const password='Settings-runtime-fixture-2026',hash=await hashPassword(password)
    const statements=[],add=(sql,...args)=>statements.push(db.prepare(sql).bind(...args))
    add("INSERT INTO business_seasons(id,code,label,status) VALUES('season-2026','2026','2026','active')")
    add("INSERT INTO platform_settings(singleton_id,public_catalogue_season_id) VALUES(1,'season-2026')")
    add("INSERT INTO businesses VALUES('shop','shop','Shop','permanent','active')")
    for(const loc of ['loc-a','loc-b']){
      add("INSERT INTO business_locations(id,business_id,slug,name,status) VALUES(?,'shop',?,?,'active')",loc,loc,loc)
      add("INSERT INTO location_seasons VALUES(?,'season-2026',2026,'active')",loc)
    }
    for(const [id,role,loc] of [['owner','owner','loc-a'],['super','super_admin','loc-b'],['admin','admin','loc-a']]){
      add('INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(?,?,?,?,?)',id,id+'@runtime.invalid',id,role,hash)
      add("INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2026',?,?)",id,role)
      add("INSERT INTO location_members VALUES(?,'season-2026',?,?,NULL)",loc,id,role)
    }
    await db.batch(statements)
    const cookies={}
    const api=async(actor,method='GET',body,location=actor==='super'?'loc-b':'loc-a')=>{
      const response=await fetch(new URL('/api/admin/settings',base),{method,headers:{Origin:base.origin,'Content-Type':'application/json',
        Cookie:cookies[actor]??'','X-Admin-Location-Id':location,'X-Admin-Season-Id':'season-2026'},...(body===undefined?{}:{body:JSON.stringify(body)})})
      return {status:response.status,data:await response.json(),cacheControl:response.headers.get('cache-control')}
    }
    assert.equal((await api('unknown')).status,401)
    for(const actor of ['owner','super','admin']){
      const response=await fetch(new URL('/api/admin/auth/login',base),{method:'POST',headers:{Origin:base.origin,'Content-Type':'application/json'},body:JSON.stringify({email:actor+'@runtime.invalid',password})})
      assert.equal(response.status,200);cookies[actor]=response.headers.get('set-cookie').split(';')[0]
    }
    assert.equal((await api('owner')).cacheControl,'no-store')
    const bBefore=(await api('super')).data
    const input={profile:{phone:'9876543210',stallName:'Stall A changed'},expectedProfileRevision:0,
      season:{stallDates:['2026-11-06']},expectedSeasonRevision:0}
    const saved=await api('owner','PATCH',input)
    assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.profile.phone,'9876543210')
    assert.deepEqual(saved.data.revisions,{profile:1,season:1})
    assert.deepEqual((await api('super')).data,bBefore)
    assert.equal((await api('admin')).data.updated,undefined)
    assert.equal((await api('admin','PATCH',input)).status,403)
    assert.equal((await api('owner','GET',undefined,'loc-b')).status,403)
    assert.equal((await api('owner','PATCH',input)).status,409)
    const before=(await api('owner')).data
    await db.prepare("CREATE TRIGGER fail_settings_runtime BEFORE INSERT ON location_settings_events BEGIN SELECT RAISE(ABORT,'injected_settings_failure'); END").run()
    const failed=await api('owner','PATCH',{profile:{phone:'9999999999'},expectedProfileRevision:1})
    assert.equal(failed.status,503);assert.equal(failed.data.error,'settings_not_confirmed')
    assert.deepEqual((await api('owner')).data,before)
    await db.prepare('DROP TRIGGER fail_settings_runtime').run()
    assert.equal((await db.prepare('SELECT count(*) n FROM location_settings_events').first()).n,1)
    assert.equal((await db.prepare('SELECT public_catalogue_season_id FROM platform_settings').first()).public_catalogue_season_id,'season-2026')
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[])
  } finally {await runtime.dispose()}
})
