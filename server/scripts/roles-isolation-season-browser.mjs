import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const root = path.resolve(process.argv[2] ?? '')
const { directory } = JSON.parse(await readFile(path.join(root, 'phase3-current.json'), 'utf8'))
assert.ok(directory.startsWith(root + path.sep))
const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'))
const site = 'http://localhost:5193', worker = 'http://localhost:8793'
const resumePath = process.argv[3] ? path.resolve(process.argv[3]) : null
if (resumePath) assert.equal(path.dirname(resumePath), directory)
const resumed = resumePath ? JSON.parse(await readFile(resumePath, 'utf8')) : null
const attempt = Date.now(), results = resumed?.results.filter(row => row.status === 'PASS') ?? [], apiTrace = resumed?.apiTrace ?? [], blockedOrigins = new Set(resumed?.blockedOrigins ?? [])
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let chrome, socket, sequence = 0
const pending = new Map()
function command(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) }) }
async function launch(profile) {
  await mkdir(profile, { recursive: true })
  const port = 20000 + Math.floor(Math.random() * 10000)
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let target
  for (let i = 0; i < 100; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); break } catch { await delay(100) } }
  if (!target) throw Error('Chrome startup failed')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item.reject(Error(JSON.stringify(message.error))); else item.resolve(message.result) }
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params.request, url = new URL(request.url)
      const allowed = [site, worker].includes(url.origin) || ['about:', 'data:', 'blob:'].includes(url.protocol)
      if (!allowed) blockedOrigins.add(url.origin)
      if (url.origin === worker && url.pathname.startsWith('/api/admin/')) {
        const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]))
        apiTrace.push({ path: url.pathname, method: request.method, location: headers['x-admin-location-id'] ?? null, season: headers['x-admin-season-id'] ?? null })
      }
      command(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: message.params.requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {})
    }
  }
  await command('Page.enable'); await command('Network.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
}
async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value }
async function wait(expression, seconds = 25) { for (let i = 0; i < seconds * 5; i++) { if (await evaluate(expression).catch(() => false)) return; await delay(200) } throw Error('Timed out: ' + expression + ' | ' + (await evaluate('document.body.innerText')).slice(-1800)) }
async function close() { if (!socket || socket.readyState !== 1) { chrome?.kill(); return } const exited = new Promise(resolve => chrome.once('exit', resolve)); await command('Browser.close').catch(() => {}); await Promise.race([exited, delay(5000)]); socket.close() }
async function field(label, value) {
  await wait(`Array.from(document.querySelectorAll('label')).some(x=>x.textContent.includes(${JSON.stringify(label)})&&(x.querySelector('input,textarea,select')||document.getElementById(x.htmlFor)))`)
  await evaluate(`(()=>{const label=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.includes(${JSON.stringify(label)}));const input=label?.querySelector('input,textarea,select')??document.getElementById(label?.htmlFor);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`)
}
async function click(text) { await wait(`Array.from(document.querySelectorAll('button')).some(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled)`); await evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(text)}).click()`) }
async function link(href) { await wait(`Boolean(document.querySelector('a[href=${JSON.stringify(href)}]'))`); await evaluate(`document.querySelector('a[href=${JSON.stringify(href)}]').click()`) }
async function offline(value) { await command('Network.emulateNetworkConditions', { offline: value, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await wait(`navigator.onLine===${!value}`) }
async function selectStall(location) {
  await wait(`Array.from(document.querySelectorAll('select')).some(x=>Array.from(x.options).some(o=>o.value===${JSON.stringify(state.season)}))`)
  await evaluate(`(()=>{const select=Array.from(document.querySelectorAll('select')).find(x=>Array.from(x.options).some(o=>o.value===${JSON.stringify(state.season)}));if(select.value!==${JSON.stringify(state.season)}){select.value=${JSON.stringify(state.season)};select.dispatchEvent(new Event('change',{bubbles:true}))}})()`)
  await wait(`Array.from(document.querySelectorAll('select')).some(x=>Array.from(x.options).some(o=>o.value===${JSON.stringify(location)}))`)
  await evaluate(`(()=>{const select=Array.from(document.querySelectorAll('select')).find(x=>Array.from(x.options).some(o=>o.value===${JSON.stringify(location)}));select.value=${JSON.stringify(location)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await wait(`Array.from(document.querySelectorAll('select')).some(x=>x.value===${JSON.stringify(location)}&&!x.disabled)`)
  await delay(250)
}
async function login(actor, location) { await command('Page.navigate', { url: site + '/admin/login' }); await wait("Boolean(document.querySelector('input[type=email]'))"); await field('Email', actor.email); await field('Password', actor.password); await click('Sign in'); await wait("location.pathname!=='/admin/login'"); await selectStall(location) }
async function prepare() { await link('/admin/offline'); await wait("document.querySelector('h1')?.textContent==='Offline billing workspace'"); await click('Prepare / refresh selected stall for offline use'); await wait("document.body.textContent.includes('Offline page reload is ready.')") }
async function saved() { await wait("document.body.textContent.includes('Draft saved on this device')&&!document.body.textContent.includes('Saving draft')") }
function pass(id, name, scenarios, evidence) { results.push({ id, name, scenarios, status: 'PASS', modules: ['AdminSessionContext', 'AdminWorkspaceShell', 'AdminQuickBillPage', 'AdminOfflineBillingPage', 'offline/storage'], evidence }); console.log('PASS ' + id + ' ' + name) }

const profile = path.join(directory, 'browser-season-' + attempt)
const previous = JSON.parse(await readFile(path.join(state.p2, 'state.json'), 'utf8'))
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const membershipFile = path.join(directory, 'historical-controller-membership.sql')
await writeFile(membershipFile, `INSERT INTO season_members(season_id,admin_user_id,role) VALUES(${q(state.historical)},${q(state.actors.controller.id)},'owner');\nINSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(${q(state.historicalLocation)},${q(state.historical)},${q(state.actors.controller.id)},'owner');`, { flag: 'wx' })
const manifest = JSON.parse(await readFile(path.join(root, 'isolation.json'), 'utf8'))
assert.ok(manifest.disposableDatabaseFile.startsWith(path.join(root, 'persist') + path.sep))
await promisify(execFile)(process.execPath, [path.resolve('server/node_modules/wrangler/bin/wrangler.js'), 'd1','execute','diwali-release-disposable','--local','--config',manifest.config,'--persist-to',manifest.persist,'--file',membershipFile,'--json'], { windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })
async function summary() { return evaluate(`new Promise(resolve=>{const o=indexedDB.open('diwali-offline-billing-v1');o.onsuccess=()=>{const db=o.result,tx=db.transaction(['profiles','catalogues','drafts','outbox'],'readonly'),q={};for(const n of ['profiles','catalogues','drafts','outbox'])q[n]=tx.objectStore(n).getAll();tx.oncomplete=()=>{resolve({profiles:q.profiles.result.map(x=>({scope:x.scope,role:x.role,writable:x.writable})),catalogues:q.catalogues.result.map(x=>({scope:JSON.parse(x.scopeKey),products:x.products.map(p=>p.id)})),drafts:q.drafts.result.map(x=>({scope:JSON.parse(x.scopeKey),draftId:x.draftId})),outbox:q.outbox.result.map(x=>({id:x.payload.operationId,scope:x.payload.scope,state:x.state}))});db.close()}}})`) }
let durable, archivedStatus
try {
  await launch(profile); await login(state.actors.controller, state.a); await prepare()
  await offline(true); await click('New local request'); await field('Customer name','Phase 3 season-local draft'); await field('Mobile','9876543210'); await field('Saved catalogue',state.products.a); await click('Add product'); await saved(); await click('Queue request creation'); await wait("document.body.textContent.includes('1 pending')")
  const before = await summary(); assert.equal(before.outbox.length,1)
  await offline(false); await link('/admin/context')
  await field('Season', state.historical)
  await wait(`Array.from(document.querySelectorAll('select')).some(s=>Array.from(s.options).some(o=>o.value===${JSON.stringify(state.historicalLocation)}))`)
  await evaluate(`(()=>{const s=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value===${JSON.stringify(state.historicalLocation)}));s.value=${JSON.stringify(state.historicalLocation)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await wait("document.body.textContent.toLowerCase().includes('archived')")
  const cursor = apiTrace.length
  await link('/admin/offline'); await wait("document.querySelector('h1')?.textContent==='Offline billing workspace'")
  assert.equal(await evaluate("document.body.textContent.includes('Phase 3 season-local draft')"),false)
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Synchronize pending operations')?.disabled??true"),true)
  // Use the browser's real authenticated transport in the selected archived context.
  archivedStatus = await evaluate(`(async()=>{const h={'X-Admin-Season-Id':${JSON.stringify(state.historical)},'X-Admin-Location-Id':${JSON.stringify(state.historicalLocation)},'Content-Type':'application/json'};const r=await fetch(${JSON.stringify(worker+'/api/admin/customer-requests/'+previous.historicalRequest)},{credentials:'include',headers:h});const d=await r.json();const w=await fetch(${JSON.stringify(worker+'/api/admin/offline/devices')},{method:'POST',credentials:'include',headers:h,body:JSON.stringify({deviceId:'phase3-archived-denied',deviceToken:'ab'.repeat(32)})});return {read:r.status,requestId:d.request?.id,write:w.status}})()`)
  assert.equal(archivedStatus.read,200); assert.equal(archivedStatus.requestId,previous.historicalRequest); assert.equal(archivedStatus.write,403)
  durable = await summary(); assert.deepEqual(durable,before)
  const scoped = apiTrace.slice(cursor).filter(row=>!['OPTIONS'].includes(row.method)&&row.path!=='/api/admin/session')
  assert.ok(scoped.length>=2); assert.ok(scoped.every(row=>row.season===state.historical&&row.location===state.historicalLocation))
  await link('/admin/context'); await selectStall(state.a); await link('/admin/offline')
  await wait("document.body.textContent.includes('Phase 3 season-local draft')")
  assert.deepEqual(await summary(),before)
  pass('P3-SEASON-BROWSER-01','Archived season switch blocks active draft dispatch and preserves original scoped catalogue/outbox',[7,8,10],{archivedStatus,activeLocalStateUnchanged:true,archivedApiScope:scoped,retainedOperationIds:before.outbox.map(row=>row.id),archivedWritableProfileCreated:false})
} catch(error) {results.push({id:'P3-SEASON-BROWSER-01',status:'FAIL',error:error.stack});console.log('FAIL '+error.message)}
finally {await close()}
const report=path.join(directory,'season-browser-'+attempt+'.json')
await writeFile(report,JSON.stringify({results,profile,apiTrace,blockedOrigins:[...blockedOrigins],durable,archivedStatus},null,2),{flag:'wx'})
console.log(JSON.stringify({report,pass:results.filter(row=>row.status==='PASS').length,fail:results.filter(row=>row.status==='FAIL').length}))
if(results.some(row=>row.status==='FAIL'))process.exitCode=1


