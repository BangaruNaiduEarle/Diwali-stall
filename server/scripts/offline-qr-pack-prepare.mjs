import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {hashPassword} from '../src/lib/passwordHash.js'

const root=path.resolve(process.argv[2]),manifest=JSON.parse(await readFile(path.join(root,'isolation.json'),'utf8'))
assert.equal(manifest.root,root);assert.ok(manifest.disposableDatabaseFile.startsWith(path.join(root,'persist')+path.sep));assert.notEqual(manifest.disposableDatabaseFile,manifest.original)
const prefix='p6-'+crypto.randomUUID().slice(0,8),directory=path.join(root,prefix);await mkdir(directory)
const stamp=Date.now(),state={root,directory,prefix,business:prefix+'-business',a:prefix+'-a',season:'season-2026',actors:{},products:{a:'P'+stamp+'1',extra:'P'+stamp+'2'},packs:{classic:'FP'+stamp+'1',premium:'FP'+stamp+'2'}}
const run=promisify(execFile)
await run('C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe',['server/scripts/offline-qr-pack-db.py',root,directory,'snapshot'],{windowsHide:true})
const password='Phase6-'+crypto.randomUUID(),hash=await hashPassword(password),q=value=>"'"+String(value).replaceAll("'","''")+"'"
const sql=[`INSERT INTO businesses(id,slug,name,business_type) VALUES(${q(state.business)},${q(state.business)},'Phase 6 QR Fixtures','permanent');`,`INSERT INTO business_locations(id,business_id,slug,name) VALUES(${q(state.a)},${q(state.business)},${q(state.a)},'Phase 6 QR Stall');`,`INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(${q(state.a)},${q(state.season)},2026);`,`INSERT INTO categories(slug,label,season_id,location_id) VALUES(${q(prefix+'-cat')},'Phase 6 Category',${q(state.season)},${q(state.a)});`]
for(const [name,role]of [['admin','admin'],['owner','owner'],['super','super_admin']]){
 const actor={id:prefix+'-'+name,email:prefix+'-'+name+'@acceptance.invalid',password,role,location:state.a};state.actors[name]=actor
 sql.push(`INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(${q(actor.id)},${q(actor.email)},${q('Phase6 '+name)},'owner',${q(hash)});`,`INSERT INTO season_members(season_id,admin_user_id,role) VALUES(${q(state.season)},${q(actor.id)},${q(role)});`,`INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(${q(state.a)},${q(state.season)},${q(actor.id)},${q(role)});`)
}
for(const [key,price,final,pieces]of [['a',10000,8000,10],['extra',20000,15000,5]]){
 sql.push(`INSERT INTO products(id,category_slug,name,pack,company,selling_price_paise,final_price_paise,pieces_per_pack,allow_loose_sale,season_id,location_id) VALUES(${q(state.products[key])},${q(prefix+'-cat')},${q('Phase 6 Product '+key)},${q(pieces+' pieces')},'Phase 6 Fixtures',${price},${final},${pieces},1,${q(state.season)},${q(state.a)});`,`INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES(${q(state.products[key])},5000,'2026-01-01',${q(state.season)},${q(state.a)});`)
}
for(const [key,price,label,first,second,unit1,unit2]of [['classic',45000,'Classic',2,1,'box','piece'],['premium',70000,'Premium',3,2,'packet','bundle']]){
 sql.push(`INSERT INTO family_packs(id,slug,name,selling_price_paise,pack_label,active,season_id,location_id) VALUES(${q(state.packs[key])},${q(prefix+'-'+key)},${q('Phase 6 Family '+label)},${price},${q(label)},1,${q(state.season)},${q(state.a)});`,`INSERT INTO family_pack_items(family_pack_id,product_id,quantity,unit_label,sort_order) VALUES(${q(state.packs[key])},${q(state.products.a)},${first},${q(unit1)},0),(${q(state.packs[key])},${q(state.products.extra)},${second},${q(unit2)},1);`)
}
await writeFile(path.join(directory,'state.json'),JSON.stringify(state,null,2),{flag:'wx'});await writeFile(path.join(directory,'seed.sql'),sql.join('\n'),{flag:'wx'})
await run(process.execPath,[path.resolve('server/node_modules/wrangler/bin/wrangler.js'),'d1','execute','diwali-release-disposable','--local','--config',manifest.config,'--persist-to',manifest.persist,'--file',path.join(directory,'seed.sql'),'--json'],{windowsHide:true,maxBuffer:2e6,env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
await writeFile(path.join(root,'phase6-current.json'),JSON.stringify({directory}),{flag:'wx'})
console.log(JSON.stringify({directory,newActors:3,variants:2,snapshotCreated:true}))
