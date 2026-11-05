// One new deliberately expired session, never an update to an existing session.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const root=path.resolve(process.argv[2]),manifest=JSON.parse(await readFile(path.join(root,'isolation.json'),'utf8')),{directory}=JSON.parse(await readFile(path.join(root,'phase6-current.json'),'utf8'))
assert.ok(directory.startsWith(root+path.sep)&&path.basename(directory).startsWith('p6-'));assert.ok(manifest.disposableDatabaseFile.startsWith(path.join(root,'persist')+path.sep));assert.notEqual(manifest.disposableDatabaseFile,manifest.original)
const state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')),actor=state.actors.owner
assert.ok(actor.id.startsWith(state.prefix+'-'))
const session=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-',''),seed=path.join(directory,'expired-session-'+Date.now()+'.sql')
await writeFile(seed,`INSERT INTO admin_sessions(id,admin_user_id,expires_at) VALUES('${session}','${actor.id}','2000-01-01T00:00:00.000Z');`,{flag:'wx'})
await promisify(execFile)(process.execPath,[path.resolve('server/node_modules/wrangler/bin/wrangler.js'),'d1','execute','diwali-release-disposable','--local','--config',manifest.config,'--persist-to',manifest.persist,'--file',seed,'--json'],{windowsHide:true,maxBuffer:2e6,env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
const base='http://localhost:8793',headers={Origin:base,'Content-Type':'application/json','X-Admin-Location-Id':state.a,'X-Admin-Season-Id':state.season}
const expired=await fetch(base+'/api/admin/offline/catalogue',{headers:{...headers,Cookie:'diwali_admin_session='+session}})
assert.equal(expired.status,401)
const login=await fetch(base+'/api/admin/auth/login',{method:'POST',headers,body:JSON.stringify({email:actor.email,password:actor.password})});assert.equal(login.status,200)
const live=await fetch(base+'/api/admin/offline/catalogue',{headers:{...headers,Cookie:login.headers.get('set-cookie').split(';')[0]}});assert.equal(live.status,200)
const output=path.join(directory,'expiry-'+Date.now()+'.json')
await writeFile(output,JSON.stringify({id:'P6-AUTH-TTL',status:'PASS',fixture:'New expired session for new Phase 6 Owner; existing sessions untouched',expiredSessionPresentBeforeRequest:true,expiresAt:'2000-01-01T00:00:00.000Z',expiredStatus:expired.status,livePasswordSessionStatus:live.status,serverClockUnchanged:true},null,2),{flag:'wx'})
console.log(JSON.stringify({output,status:'PASS',expiredStatus:expired.status,liveStatus:live.status}))
