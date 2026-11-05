// Read-only/unauthenticated probes: no login, fixture creation or business mutation.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
const root=path.resolve(process.argv[2]),{directory}=JSON.parse(await readFile(path.join(root,'phase7-current.json'),'utf8'))
assert.ok(directory.startsWith(root+path.sep)&&path.basename(directory).startsWith('p7-'))
const config=await readFile(path.join(root,'wrangler.toml'),'utf8')
assert.ok(config.includes('diwali-release-disposable')&&config.includes('ADMIN_LOCAL_DEV_AUTH = "0"'))
const base='http://localhost:8793',results=[]
for(const [name,route,method,origin,expected,extra]of [
 ['actual-local-health','/health','GET',base,200,{}],
 ['forged-role-user-headers-do-not-authenticate','/api/admin/session','GET',base,401,{'X-Admin-Role':'owner','X-Admin-User-Id':'pretend-owner'}],
 ['forged-stall-season-without-session-is-denied','/api/admin/products','GET',base,401,{'X-Admin-Location-Id':'foreign-stall','X-Admin-Season-Id':'foreign-season'}],
 ['platform-without-session-is-denied','/api/admin/platform/session','GET',base,401,{}],
 ['sync-without-session-is-denied','/api/admin/offline/sync','POST',base,401,{}],
 ['untrusted-origin-mutation-is-denied','/api/admin/offline/sync','POST','https://untrusted.invalid',403,{}],
]){
 const response=await fetch(base+route,{method,headers:{Origin:origin,'Content-Type':'application/json',...extra},...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(10000)})
 const data=await response.json();assert.equal(response.status,expected,name)
 results.push({name,route,method,status:'PASS',httpStatus:response.status,error:data.error??null,cacheControl:response.headers.get('cache-control')})
}
const output=path.join(directory,'local-http-security.json');await writeFile(output,JSON.stringify({results,validSessionsUsed:false,businessWritesRequested:false,productionAccessed:false},null,2),{flag:'wx'})
console.log(JSON.stringify({output,pass:results.length,fail:0}))
