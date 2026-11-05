import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {hashPassword} from '../src/lib/passwordHash.js'

const root=path.resolve(process.argv[2]??'')
const isolation=JSON.parse(await readFile(path.join(root,'isolation.json'),'utf8'))
assert.ok(isolation.disposableDatabaseFile?.startsWith(path.join(root,'persist')+path.sep))
const verified=JSON.parse(await readFile(path.join(root,'migration-verification.json'),'utf8'))
assert.equal(verified.missingObjects.length,0)
const password='ReleaseFixture-'+crypto.randomUUID()
const passwordHash=await hashPassword(password)
const actors=[...[1,2,3,4].map(index=>({id:'rr-admin-'+index,role:'admin',location:'rr-a'})),{id:'rr-owner-a',role:'owner',location:'rr-a'},{id:'rr-super-a',role:'super_admin',location:'rr-a'},{id:'rr-owner-b',role:'owner',location:'rr-b'},{id:'rr-platform',role:'admin',location:null}]
const quote=value=>"'"+String(value).replaceAll("'","''")+"'"
const sql=[`INSERT INTO businesses(id,slug,name,business_type,status) VALUES('rr-business','release-business','Release Fixture Business','permanent','active');`,
  `INSERT INTO business_locations(id,business_id,slug,name,status) VALUES('rr-a','rr-business','release-a','Release Stall A','active'),('rr-b','rr-business','release-b','Release Stall B','active');`,
  `INSERT INTO location_seasons(location_id,season_id,operating_year,status) VALUES('rr-a','season-2026',2026,'active'),('rr-b','season-2026',2026,'active');`]
for(const actor of actors){
  actor.email=actor.id+'@release.invalid';actor.password=password
  sql.push(`INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(${quote(actor.id)},${quote(actor.email)},${quote(actor.id)},${quote(actor.role)},${quote(passwordHash)});`)
  if(actor.location)sql.push(`INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2026',${quote(actor.id)},${quote(actor.role)});`,
    `INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(${quote(actor.location)},'season-2026',${quote(actor.id)},${quote(actor.role)});`)
}
sql.push(`INSERT INTO platform_admins(admin_user_id) VALUES('rr-platform');`,
  `INSERT INTO categories(slug,label,season_id,location_id) VALUES('rr-category-a','Release Category A','season-2026','rr-a'),('rr-category-b','Release Category B','season-2026','rr-b');`,
  `INSERT INTO products(id,category_slug,name,pack,company,selling_price_paise,final_price_paise,pieces_per_pack,allow_loose_sale,season_id,location_id) VALUES
    ('P880001','rr-category-a','Release Product A1','10 pieces','Release Fixture',10000,8000,10,1,'season-2026','rr-a'),
    ('P880003','rr-category-a','Release Product A2','Box','Release Fixture',20000,15000,10,1,'season-2026','rr-a'),
    ('P880002','rr-category-b','Release Product B','Box','Release Fixture',99000,80000,10,0,'season-2026','rr-b');`,
  `INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES
    ('P880001',5000,datetime('now'),'season-2026','rr-a'),('P880003',7000,datetime('now'),'season-2026','rr-a'),('P880002',8000,datetime('now'),'season-2026','rr-b');`,
  `INSERT INTO family_packs(id,slug,name,selling_price_paise,pack_label,active,season_id,location_id) VALUES('FP880001','release-classic','Release Family Classic',45000,'Classic',1,'season-2026','rr-a');`,
  `INSERT INTO family_pack_items(family_pack_id,product_id,quantity,unit_label,sort_order) VALUES('FP880001','P880001',2,'box',0),('FP880001','P880003',1,'box',1);`)
await writeFile(path.join(root,'fixture-seed.sql'),sql.join('\n'),{flag:'wx'})
await writeFile(path.join(root,'fixture-actors.json'),JSON.stringify(actors,null,2),{flag:'wx'})
console.log(JSON.stringify({fixtureUsers:actors.length,locations:['rr-a','rr-b'],products:3,familyPacks:1,seedFile:path.join(root,'fixture-seed.sql')}))
