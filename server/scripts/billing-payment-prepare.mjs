import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { hashPassword } from '../src/lib/passwordHash.js'

const root = path.resolve(process.argv[2])
const manifest = JSON.parse(await readFile(path.join(root, 'isolation.json'), 'utf8'))
assert.equal(manifest.root, root)
assert.ok(manifest.disposableDatabaseFile.startsWith(path.join(root, 'persist') + path.sep))
assert.notEqual(manifest.disposableDatabaseFile, manifest.original)
if(process.argv[3]==='--add-active-season') {
  const {directory}=JSON.parse(await readFile(path.join(root,'phase4-current.json'),'utf8'))
  assert.ok(directory.startsWith(root+path.sep)&&path.basename(directory).startsWith('p4-'))
  const file=path.join(directory,'state.json'),existing=JSON.parse(await readFile(file,'utf8'))
  assert.equal(existing.alternate,undefined,'Already prepared; do not repeat')
  const alternate=existing.prefix+'-active-season',q=value=>"'"+String(value).replaceAll("'","''")+"'",actor=existing.actors.dual.id
  const sql=[`INSERT INTO business_seasons(id,code,label,status) VALUES(${q(alternate)},${q(alternate)},'Phase 4 alternate active season','active');`,`INSERT INTO season_members(season_id,admin_user_id,role) VALUES(${q(alternate)},${q(actor)},'owner');`]
  for(const location of [existing.a,existing.b])sql.push(`INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(${q(location)},${q(alternate)},2027);`,`INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(${q(location)},${q(alternate)},${q(actor)},'owner');`)
  const seed=path.join(directory,'alternate-active-season.sql');await writeFile(seed,sql.join('\n'),{flag:'wx'})
  await promisify(execFile)(process.execPath,[path.resolve('server/node_modules/wrangler/bin/wrangler.js'),'d1','execute','diwali-release-disposable','--local','--config',manifest.config,'--persist-to',manifest.persist,'--file',seed,'--json'],{windowsHide:true,maxBuffer:2e6,env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
  existing.alternate=alternate;await writeFile(file,JSON.stringify(existing,null,2));console.log(JSON.stringify({alternate,newRowsOnly:true}));process.exit(0)
}
const prefix = 'p4-' + crypto.randomUUID().slice(0, 8), directory = path.join(root, prefix)
await mkdir(directory)
const p2 = JSON.parse(await readFile(path.join(root, 'phase2-current.json'), 'utf8'))
const prior = JSON.parse(await readFile(path.join(p2.directory, 'state.json'), 'utf8'))
const state = { root, directory, prefix, business: prefix + '-business', a: prefix + '-a', b: prefix + '-b', season: 'season-2026', historical: prior.historical, actors: {}, products: { a: 'P' + Date.now() + '1', extra: 'P' + Date.now() + '2', b: 'P' + Date.now() + '3' } }
const run = promisify(execFile)
await run('C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe', ['server/scripts/billing-payment-db.py', root, directory, 'snapshot'], { windowsHide: true })
const password = 'Phase4-' + crypto.randomUUID(), hash = await hashPassword(password)
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const sql = [`INSERT INTO businesses(id,slug,name,business_type) VALUES(${q(state.business)},${q(state.business)},'Phase 4 Billing Fixtures','permanent');`]
for (const key of ['a','b']) {
  sql.push(`INSERT INTO business_locations(id,business_id,slug,name) VALUES(${q(state[key])},${q(state.business)},${q(state[key])},${q('Phase 4 Stall '+key.toUpperCase())});`)
  for (const [season, year] of [[state.season,2026],[state.historical,2025]]) sql.push(`INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(${q(state[key])},${q(season)},${year});`)
  sql.push(`INSERT INTO categories(slug,label,season_id,location_id) VALUES(${q(prefix+'-'+key+'-cat')},'Phase 4 Category',${q(state.season)},${q(state[key])});`)
}
for (const [name,role,locations] of [['admin','admin',['a']],['owner','owner',['a']],['super','super_admin',['a']],['ownerB','owner',['b']],['dual','owner',['a','b']]]) {
  const actor = { id: prefix+'-'+name.toLowerCase(), email: prefix+'-'+name.toLowerCase()+'@acceptance.invalid', password, role, location: state[locations[0]] }
  state.actors[name] = actor
  sql.push(`INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(${q(actor.id)},${q(actor.email)},${q('Phase4 '+name)},'owner',${q(hash)});`)
  for (const season of [state.season,state.historical]) {
    sql.push(`INSERT INTO season_members(season_id,admin_user_id,role) VALUES(${q(season)},${q(actor.id)},${q(role)});`)
    for (const loc of locations) sql.push(`INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(${q(state[loc])},${q(season)},${q(actor.id)},${q(role)});`)
  }
}
for (const [key,loc,price,final] of [['a','a',10001,8001],['extra','a',3333,2222],['b','b',25003,20001]]) {
  sql.push(`INSERT INTO products(id,category_slug,name,pack,selling_price_paise,final_price_paise,pieces_per_pack,allow_loose_sale,season_id,location_id) VALUES(${q(state.products[key])},${q(prefix+'-'+loc+'-cat')},${q('Phase 4 Product '+key)},'3 pieces',${price},${final},3,1,${q(state.season)},${q(state[loc])});`)
  sql.push(`INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES(${q(state.products[key])},3001,'2026-01-01',${q(state.season)},${q(state[loc])});`)
  sql.push(`INSERT INTO private_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES(${q(state.products[key])},9001,'2026-01-01',${q(state.season)},${q(state[loc])});`)
}
await writeFile(path.join(directory,'state.json'),JSON.stringify(state,null,2),{flag:'wx'})
await writeFile(path.join(directory,'seed.sql'),sql.join('\n'),{flag:'wx'})
await run(process.execPath,[path.resolve('server/node_modules/wrangler/bin/wrangler.js'),'d1','execute','diwali-release-disposable','--local','--config',manifest.config,'--persist-to',manifest.persist,'--file',path.join(directory,'seed.sql'),'--json'],{windowsHide:true,maxBuffer:2e6,env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
await writeFile(path.join(root,'phase4-current.json'),JSON.stringify({directory}),{flag:'wx'})
console.log(JSON.stringify({directory,newActors:5,newStalls:2,snapshotCreated:true}))
