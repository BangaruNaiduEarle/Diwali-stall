import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { hashPassword } from '../src/lib/passwordHash.js'

const root = path.resolve(process.argv[2] ?? '')
const isolation = JSON.parse(await readFile(path.join(root, 'isolation.json'), 'utf8'))
assert.ok(isolation.disposableDatabaseFile.startsWith(path.join(root, 'persist') + path.sep))
assert.equal(isolation.databaseName ?? 'diwali-release-disposable', 'diwali-release-disposable')
const token = crypto.randomUUID().slice(0, 8), prefix = 'p2-' + token
const directory = path.join(root, prefix); await mkdir(directory)
const data = { root, directory, prefix, business: prefix + '-business', otherBusiness: prefix + '-other', a: prefix + '-a', c: prefix + '-c', historicalLocation: prefix + '-historical', season: 'season-2026', historical: 'season-' + prefix, actors: {}, requests: {}, historicalRequest: crypto.randomUUID(), historicalProduct: 'P' + Date.now() }
const password = 'Acceptance-' + crypto.randomUUID(), passwordHash = await hashPassword(password)
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const sql = [
  `INSERT INTO businesses(id,slug,name,business_type) VALUES(${q(data.business)},${q(data.business)},'Phase 2 Fixture Business','seasonal'),(${q(data.otherBusiness)},${q(data.otherBusiness)},'Phase 2 Other Business','permanent');`,
  `INSERT INTO business_locations(id,business_id,slug,name) VALUES(${q(data.a)},${q(data.business)},${q(data.a)},'Acceptance Stall A'),(${q(data.c)},${q(data.otherBusiness)},${q(data.c)},'Acceptance Other Business'),(${q(data.historicalLocation)},${q(data.business)},${q(data.historicalLocation)},'Historical Seasonal Stall');`,
  `INSERT INTO business_seasons(id,code,label,status) VALUES(${q(data.historical)},${q(prefix)},'Acceptance Historical Season','archived');`,
]
for (const loc of [data.a, data.c]) sql.push(`INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(${q(loc)},'season-2026',2026);`)
sql.push(`INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(${q(data.historicalLocation)},${q(data.historical)},2025),(${q(data.c)},${q(data.historical)},2025);`)
for (const [name, role, globalRole] of [['platform', null, 'admin'], ['ownerA', 'owner', 'owner'], ['ownerB', null, 'admin'], ['dual', 'owner', 'owner'], ['super', 'owner', 'owner'], ['admin', 'admin', 'owner']]) {
  const actor = { id: prefix + '-' + name.toLowerCase(), email: prefix + '-' + name.toLowerCase() + '@acceptance.invalid', password, role: role ?? 'owner', location: data.a }
  data.actors[name] = actor
  sql.push(`INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(${q(actor.id)},${q(actor.email)},${q(name)},${q(globalRole)},${q(passwordHash)});`)
  if (name === 'platform') { actor.location = null; sql.push(`INSERT INTO platform_admins(admin_user_id) VALUES(${q(actor.id)});`); continue }
  if (name === 'ownerB') { actor.location = null; continue }
  for (const season of [data.season, data.historical]) {
    sql.push(`INSERT INTO season_members(season_id,admin_user_id,role) VALUES(${q(season)},${q(actor.id)},${q(role)});`)
    sql.push(`INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(${q(season === data.historical ? data.historicalLocation : data.a)},${q(season)},${q(actor.id)},${q(name === 'super' ? 'super_admin' : role)});`)
    if (name === 'dual') sql.push(`INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(${q(data.c)},${q(season)},${q(actor.id)},'owner');`)
  }
}
sql.push(`INSERT INTO categories(slug,label,season_id,location_id) VALUES(${q(prefix+'-history-category')},'Historical Category',${q(data.historical)},${q(data.historicalLocation)});`,
  `INSERT INTO products(id,category_slug,name,pack,selling_price_paise,season_id,location_id) VALUES(${q(data.historicalProduct)},${q(prefix+'-history-category')},'Historical Product','Box',1000,${q(data.historical)},${q(data.historicalLocation)});`,
  `INSERT INTO customer_requests(id,public_reference,source,status,customer_name,customer_phone,season_id,location_id) VALUES(${q(data.historicalRequest)},${q('HIST-'+token)},'manual','received','Historical Fixture Customer','9876543210',${q(data.historical)},${q(data.historicalLocation)});`,
  `INSERT INTO customer_request_items(request_id,line_number,product_id,product_name,quantity,unit_price_paise) VALUES(${q(data.historicalRequest)},1,${q(data.historicalProduct)},'Historical Product',1,1000);`)
const run = promisify(execFile)
const backupScript = `import sqlite3,sys;from pathlib import Path
source=Path(sys.argv[1]).resolve(strict=True);target=Path(sys.argv[2]).resolve()
assert 'diwali-release-' in str(source) and '/persist/' in source.as_posix() and not target.exists()
with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as db,sqlite3.connect(target) as out: db.backup(out)
`
await run('C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe', ['-c', backupScript, isolation.disposableDatabaseFile, path.join(directory, 'before.sqlite')], { windowsHide: true })
await writeFile(path.join(directory, 'fixture-seed.sql'), sql.join('\n'))
await run(process.execPath, [path.resolve('server/node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'diwali-release-disposable', '--local', '--config', path.join(root, 'wrangler.toml'), '--persist-to', isolation.persist, '--file', path.join(directory, 'fixture-seed.sql'), '--json'], { windowsHide: true, maxBuffer: 3e6, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })
await writeFile(path.join(directory, 'state.json'), JSON.stringify(data, null, 2))
await writeFile(path.join(root, 'phase2-current.json'), JSON.stringify({ directory }, null, 2))
console.log(JSON.stringify({ directory, fixtures: prefix, users: Object.keys(data.actors).length, existingDataBackedUp: true }))
