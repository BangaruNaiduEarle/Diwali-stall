import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { hashPassword } from '../src/lib/passwordHash.js'

const root=path.resolve(process.argv[2]),manifest=JSON.parse(await readFile(path.join(root,'isolation.json'),'utf8'))
assert.equal(manifest.root,root)
assert.ok(manifest.disposableDatabaseFile.startsWith(path.join(root,'persist')+path.sep))
assert.notEqual(manifest.disposableDatabaseFile,manifest.original)
const prefix='p5-'+crypto.randomUUID().slice(0,8),directory=path.join(root,prefix)
await mkdir(directory)
const state={root,directory,prefix,business:prefix+'-business',a:prefix+'-a',b:prefix+'-b',season:'season-2026',alternate:prefix+'-alt',actors:{},products:{a:'P'+Date.now()+'1',extra:'P'+Date.now()+'2',b:'P'+Date.now()+'3'}}
const run=promisify(execFile)
await run('C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe',['server/scripts/concurrent-sync-db.py',root,directory,'snapshot'],{windowsHide:true})
const password='Phase5-'+crypto.randomUUID(),hash=await hashPassword(password),q=value=>"'"+String(value).replaceAll("'","''")+"'"
const sql=[`INSERT INTO businesses(id,slug,name,business_type) VALUES(${q(state.business)},${q(state.business)},'Phase 5 Concurrency','permanent');`,`INSERT INTO business_seasons(id,code,label,status) VALUES(${q(state.alternate)},${q(state.alternate)},'Phase 5 second active season','active');`]
for(const key of ['a','b']){
  sql.push(`INSERT INTO business_locations(id,business_id,slug,name) VALUES(${q(state[key])},${q(state.business)},${q(state[key])},${q('Phase 5 Stall '+key.toUpperCase())});`)
  for(const [season,year]of [[state.season,2026],[state.alternate,2027]])sql.push(`INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(${q(state[key])},${q(season)},${year});`)
  sql.push(`INSERT INTO categories(slug,label,season_id,location_id) VALUES(${q(prefix+'-'+key+'-cat')},'Concurrency Category',${q(state.season)},${q(state[key])});`)
}
for(const [name,role]of [['admin1','admin'],['admin2','admin'],['admin3','admin'],['admin4','admin'],['owner','owner'],['super','super_admin']]){
  const actor={id:prefix+'-'+name,email:prefix+'-'+name+'@acceptance.invalid',password,role,location:state.a};state.actors[name]=actor
  sql.push(`INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(${q(actor.id)},${q(actor.email)},${q('Phase5 '+name)},'owner',${q(hash)});`)
  for(const season of [state.season,state.alternate]){
    sql.push(`INSERT INTO season_members(season_id,admin_user_id,role) VALUES(${q(season)},${q(actor.id)},${q(role)});`)
    for(const location of [state.a,state.b])sql.push(`INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(${q(location)},${q(season)},${q(actor.id)},${q(role)});`)
  }
}
for(const [key,loc,price]of [['a','a',10000],['extra','a',5000],['b','b',25000]])sql.push(`INSERT INTO products(id,category_slug,name,pack,selling_price_paise,final_price_paise,season_id,location_id) VALUES(${q(state.products[key])},${q(prefix+'-'+loc+'-cat')},${q('Phase 5 Product '+key)},'Box',${price},${price-1000},${q(state.season)},${q(state[loc])});`)
await writeFile(path.join(directory,'state.json'),JSON.stringify(state,null,2),{flag:'wx'})
await writeFile(path.join(directory,'seed.sql'),sql.join('\n'),{flag:'wx'})
await run(process.execPath,[path.resolve('server/node_modules/wrangler/bin/wrangler.js'),'d1','execute','diwali-release-disposable','--local','--config',manifest.config,'--persist-to',manifest.persist,'--file',path.join(directory,'seed.sql'),'--json'],{windowsHide:true,maxBuffer:2e6,env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
await writeFile(path.join(root,'phase5-current.json'),JSON.stringify({directory}),{flag:'wx'})
console.log(JSON.stringify({directory,admins:4,privileged:2,newStalls:2,snapshotCreated:true}))
