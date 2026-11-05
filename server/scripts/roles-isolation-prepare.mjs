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
const p2 = JSON.parse(await readFile(path.join(root, 'phase2-current.json'), 'utf8'))
const previous = JSON.parse(await readFile(path.join(p2.directory, 'state.json'), 'utf8'))
const prefix = 'p3-' + crypto.randomUUID().slice(0, 8), directory = path.join(root, prefix)
await mkdir(directory)
const state = { root, directory, prefix, p2: p2.directory, business: previous.business, a: previous.a, b: previous.b, season: previous.season, historical: previous.historical, historicalLocation: previous.historicalLocation, products: previous.products, actors: {} }
const run = promisify(execFile)
await run('C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe', ['server/scripts/roles-isolation-db.py', root, directory, 'snapshot'], { windowsHide: true })
const password = 'Phase3-' + crypto.randomUUID(), hash = await hashPassword(password)
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const sql = []
for (const [name, roleA, roleB] of [['controller', 'owner', 'owner'], ['subject', 'super_admin', 'admin'], ['sender', 'admin', 'admin'], ['recipient', 'owner', 'owner']]) {
  const actor = { id: prefix + '-' + name, email: prefix + '-' + name + '@acceptance.invalid', password, location: state.a }
  state.actors[name] = actor
  sql.push(`INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(${q(actor.id)},${q(actor.email)},${q(name)},'owner',${q(hash)});`)
  sql.push(`INSERT INTO season_members(season_id,admin_user_id,role) VALUES(${q(state.season)},${q(actor.id)},'owner');`)
  for (const [location, role] of [[state.a, roleA], [state.b, roleB]]) sql.push(`INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(${q(location)},${q(state.season)},${q(actor.id)},${q(role)});`)
}
await writeFile(path.join(directory, 'state.json'), JSON.stringify(state, null, 2), { flag: 'wx' })
await writeFile(path.join(directory, 'seed.sql'), sql.join('\n'), { flag: 'wx' })
await run(process.execPath, [path.resolve('server/node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'diwali-release-disposable', '--local', '--config', manifest.config, '--persist-to', manifest.persist, '--file', path.join(directory, 'seed.sql'), '--json'], { windowsHide: true, maxBuffer: 2e6, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })
await writeFile(path.join(root, 'phase3-current.json'), JSON.stringify({ directory }), { flag: 'wx' })
console.log(JSON.stringify({ directory, newActors: 4, existingRecordsChanged: false }))
