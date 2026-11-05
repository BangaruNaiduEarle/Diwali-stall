import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const root=path.resolve(process.argv[2]??'')
const isolation=JSON.parse(await readFile(path.join(root,'isolation.json'),'utf8'))
assert.ok(path.basename(root).startsWith('diwali-release-'))
assert.ok(isolation.disposableDatabaseFile.startsWith(path.join(root,'persist')+path.sep))
const run=promisify(execFile),results=[]
const args=[path.resolve('server/node_modules/wrangler/bin/wrangler.js'),'d1','execute','diwali-release-disposable','--local','--config',path.join(root,'wrangler.toml'),'--persist-to',isolation.persist]
async function sql(command){const result=await run(process.execPath,[...args,'--command',command,'--json'],{windowsHide:true,maxBuffer:2e6});return JSON.parse(result.stdout)[0].results}
async function check(name,fn){try{const detail=await fn();results.push({name,passed:true,detail});console.log('PASS '+name)}catch(error){results.push({name,passed:false,error:error.message});console.log('FAIL '+name+': '+error.message)}}
await check('real Wrangler batch rollback retains earlier committed data',async()=>{
  await sql('CREATE TABLE IF NOT EXISTS rr_release_atomic_probe (id INTEGER PRIMARY KEY, value TEXT UNIQUE); INSERT OR IGNORE INTO rr_release_atomic_probe VALUES(1,\'committed\');')
  const file=path.join(root,'atomic-failure.sql');await writeFile(file,"INSERT INTO rr_release_atomic_probe VALUES(2,'rollback'); INSERT INTO rr_release_atomic_probe VALUES(3,'committed');")
  await assert.rejects(run(process.execPath,[...args,'--file',file,'--json'],{windowsHide:true}),error=>/UNIQUE constraint/.test(String(error.stdout)+String(error.stderr)))
  assert.equal((await sql('SELECT count(*) AS n FROM rr_release_atomic_probe WHERE id IN (2,3)'))[0].n,0)
  await sql("INSERT OR IGNORE INTO rr_release_atomic_probe VALUES(4,'persisted');")
  assert.equal((await sql('SELECT count(*) AS n FROM rr_release_atomic_probe'))[0].n,2)
})
await check('actual D1 foreign-key enforcement',async()=>{
  await sql('CREATE TABLE IF NOT EXISTS rr_release_fk_parent(id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS rr_release_fk_child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES rr_release_fk_parent(id));')
  await assert.rejects(sql('INSERT INTO rr_release_fk_child VALUES(1,999);'),error=>/FOREIGN KEY constraint/i.test(String(error.stdout)+String(error.stderr)))
  assert.deepEqual(await sql('PRAGMA foreign_key_check'),[])
})
await check('migration history reapply has no pending migrations',async()=>{
  const result=await run(process.execPath,[args[0],'d1','migrations','apply','diwali-release-disposable','--local','--config',path.join(root,'wrangler.toml'),'--persist-to',isolation.persist],{windowsHide:true})
  assert.match(result.stdout,/No migrations to apply/i)
  assert.equal((await sql('SELECT count(*) AS n FROM d1_migrations'))[0].n,25)
})
await check('legacy-mode real Worker session and product read',async()=>{
  const actors=JSON.parse(await readFile(path.join(root,'fixture-actors-authenticated.json'),'utf8')),actor=actors.find(row=>row.id==='rr-owner-a')
  const headers={Cookie:actor.cookie,Origin:'http://localhost:8793','X-Admin-Season-Id':'season-2026'}
  const response=await fetch('http://localhost:8794/api/admin/session',{headers}),session=await response.json()
  assert.equal(response.status,200);assert.notEqual(session.locationModeEnabled,true);assert.equal(session.seasonRole,'owner')
  const products=await fetch('http://localhost:8794/api/admin/products',{headers});assert.equal(products.status,200)
  return {sessionStatus:response.status,productsStatus:products.status,locationModeEnabled:session.locationModeEnabled}
})
await check('legacy-mode real Worker checkout and unchanged idempotent retry',async()=>{
  const actors=JSON.parse(await readFile(path.join(root,'fixture-actors-authenticated.json'),'utf8')),actor=actors.find(row=>row.id==='rr-owner-a')
  const headers={Cookie:actor.cookie,Origin:'http://localhost:8793','X-Admin-Season-Id':'season-2026','Content-Type':'application/json','Idempotency-Key':'rr-legacy-'+crypto.randomUUID()}
  const body=JSON.stringify({customer:{name:'Release Legacy Fixture',mobile:'9876543210'},items:[{productId:'P880001',quantity:1,unitType:'box'}],pricingMode:'selling'})
  const response=await fetch('http://localhost:8794/api/admin/quick-bill/checkout',{method:'POST',headers,body}),created=await response.json()
  assert.ok(response.status>=200&&response.status<300,JSON.stringify({status:response.status,...created}))
  const retry=await fetch('http://localhost:8794/api/admin/quick-bill/checkout',{method:'POST',headers,body}),replayed=await retry.json()
  assert.ok(retry.status>=200&&retry.status<300);assert.equal(replayed.request.id,created.request.id)
  return {requestId:created.request.id,status:response.status,retryStatus:retry.status}
})
await writeFile(path.join(root,'additional-probes.json'),JSON.stringify({results},null,2))
if(results.some(row=>!row.passed))process.exitCode=1
