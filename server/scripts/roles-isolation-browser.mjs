import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

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

const apiTraceDirect = []
async function api(actor, route, { method = 'GET', body, location = state.a } = {}) {
  const response = await fetch(worker + route, { method, headers: { Cookie: actor.cookie ?? '', Origin: worker, 'Content-Type': 'application/json', 'X-Admin-Location-Id': location, 'X-Admin-Season-Id': state.season }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  apiTraceDirect.push({ actor: actor.id, route, method, location, status: response.status, error: data.error })
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
const okay = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data }
const profiles = { subject: resumed?.profiles.subject ?? path.join(directory, 'browser-role-' + attempt) }
let durable, requestId, captured
async function rawStorage() { return evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('diwali-offline-billing-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['profiles','outbox','drafts','meta'],'readonly'),q={};for(const n of ['profiles','outbox','drafts','meta'])q[n]=tx.objectStore(n).getAll();tx.oncomplete=()=>{resolve(Object.fromEntries(Object.entries(q).map(([n,r])=>[n,r.result])));db.close()}}})`) }
try {
  const controllerLogin = await api(state.actors.controller, '/api/admin/auth/login', { method: 'POST', body: { email: state.actors.controller.email, password: state.actors.controller.password } })
  okay(controllerLogin); state.actors.controller.cookie = controllerLogin.cookie
  await launch(profiles.subject)
  if (resumed) { await command('Page.navigate', { url: site + '/admin/context' }); await selectStall(state.a) }
  else await login(state.actors.subject, state.a)
  let create
  if (resumed) {
    await link('/admin/offline'); await wait("document.querySelector('h1')?.textContent==='Offline billing workspace'")
    await wait("document.body.textContent.includes('1 failed / conflict')")
    captured = await rawStorage(); durable = captured
    create = captured.outbox.find(row => row.payload.kind === 'CREATE')
    requestId = create.acknowledgement.requestId
  } else {
  await prepare()
  assert.equal((await rawStorage()).profiles[0].role, 'super_admin')
  await offline(true); await click('New local request'); await field('Customer name', 'Phase 3 role revalidation ' + attempt); await field('Mobile', '9876543210'); await field('Saved catalogue', state.products.a); await click('Add product'); await field('Customer-agreed amount', '100'); await saved(); await click('Queue request creation'); await wait("document.body.textContent.includes('1 pending')")
  await offline(false); await click('Synchronize pending operations'); await wait("document.body.textContent.includes('1 synced')")
  const initial = await rawStorage(); create = initial.outbox.find(row => row.payload.kind === 'CREATE')
  requestId = create.acknowledgement.requestId
  assert.ok(requestId)
  await offline(true); await field('Customer-agreed amount', '100'); await saved(); await click('Queue agreed amount'); await wait("document.body.textContent.includes('1 pending')"); await click('Queue closure'); await wait("document.body.textContent.includes('2 pending')"); await field('Received amount', '100'); await click('Save payment to outbox'); await wait("document.body.textContent.includes('3 pending')")
  captured = await rawStorage()
  assert.deepEqual(captured.outbox.filter(row => row.state === 'pending').map(row => row.payload.kind).sort(), ['AGREEMENT','CLOSE','PAYMENT'])
  assert.ok(captured.outbox.every(row => row.payload.capturedRole === 'super_admin'))
  okay(await api(state.actors.controller, `/api/admin/users/${state.actors.subject.id}/role`, { method: 'POST', body: { role: 'admin' } }))
  assert.equal(await evaluate('navigator.onLine'), false)
  await offline(false); await click('Synchronize pending operations')
  await wait("document.body.textContent.includes('1 failed / conflict')")
  durable = await rawStorage()
  }
  const failed = durable.outbox.find(row => row.payload.kind === 'AGREEMENT')
  assert.equal(failed.state, 'failed'); assert.equal(failed.lastError.status, 403)
  for (const kind of ['CLOSE','PAYMENT']) assert.equal(durable.outbox.find(row => row.payload.kind === kind).state, 'pending')
  assert.deepEqual(durable.outbox.map(row => row.payload.operationId).sort(), captured.outbox.map(row => row.payload.operationId).sort())
  assert.equal(durable.profiles[0].role, 'admin')
  assert.equal((durable.profiles[0].handover?.privateCatalogue ?? []).length, 0)
  await wait("!Array.from(document.querySelectorAll('button')).some(x=>x.textContent.trim()==='Queue closure')")
  const sessionCookies = (await command('Network.getCookies', { urls: [worker] })).cookies
  state.actors.subject.cookie = sessionCookies.map(row => row.name + '=' + row.value).join('; ')
  const subject = state.actors.subject
  const snapshot = okay(await api(subject, '/api/admin/offline/requests/' + requestId))
  assert.equal(snapshot.request.status, 'quoted')
  assert.doesNotMatch(JSON.stringify(snapshot), /purchase|profit|margin|finalSubtotal|bargainFloor/i)
  const device = durable.meta.find(row => row.key === 'device')
  const deniedKinds = []
  for (const row of captured.outbox.filter(row => row.payload.kind !== 'CREATE')) {
    const response = await api(subject, '/api/admin/offline/sync', { method: 'POST', body: { ...row.payload, operationId: crypto.randomUUID(), parentOperationId: undefined, requestId, expectedRevision: snapshot.request.revision, deviceToken: device.deviceToken } })
    assert.equal(response.status, 403); deniedKinds.push(row.payload.kind)
  }
  const financial = await api(subject, '/api/admin/offline/sync', { method: 'POST', body: { ...create.payload, operationId: crypto.randomUUID(), kind: 'EDIT', requestId, expectedRevision: snapshot.request.revision, deviceToken: device.deviceToken, body: { items: [{ productId: state.products.a, quantity: 1, unitRatePaise: 1 }] } } })
  assert.equal(financial.status, 403)
  const after = okay(await api(state.actors.controller, '/api/admin/offline/requests/' + requestId))
  assert.equal(after.request.revision, snapshot.request.revision); assert.equal(after.request.status, 'quoted')
  pass('P3-OFFLINE-01', 'Offline role demotion revalidates authority, rejects finances and preserves dependent outbox', [5,6,10,11], { resumedFrom: resumePath, requestId, deniedKinds, financialEdit: financial.status, failedOperation: failed.payload.operationId, unchangedRevision: after.request.revision, retainedOperationIds: durable.outbox.map(row => row.payload.operationId), refreshedRole: durable.profiles[0].role, noPrivateCatalogueRetained: true })
  okay(await api(state.actors.controller, '/api/admin/users/' + subject.id, { method: 'DELETE' }))
  assert.equal((await api(subject, '/api/admin/offline/sync', { method: 'POST', body: { ...create.payload, deviceToken: device.deviceToken } })).status, 403)
  assert.equal(okay(await api(subject, '/api/admin/session', { location: state.b })).effectiveRole, 'admin')
  okay(await api(subject, '/api/admin/products', { location: state.b }))
  const removed = await rawStorage()
  assert.deepEqual(removed.outbox.map(row => row.payload.operationId).sort(), durable.outbox.map(row => row.payload.operationId).sort())
  pass('P3-OFFLINE-02', 'Removed membership denies even receipt replay while B and local pending work remain intact', [3,10,11], { replayStatus: 403, otherStallRole: 'admin', cookieUnchanged: true, retainedOperationIds: removed.outbox.map(row => row.payload.operationId) })
} catch (error) {
  results.push({ id: 'P3-OFFLINE-remaining', status: 'FAIL', error: error.stack }); console.log('FAIL ' + error.message)
} finally { await close() }
const report = path.join(directory, 'offline-browser-' + attempt + '.json')
await writeFile(report, JSON.stringify({ resumedFrom: resumePath, results, profiles, apiTrace, apiTraceDirect, blockedOrigins: [...blockedOrigins], requestId, captured: captured && { operations: captured.outbox.map(row => ({ id: row.payload.operationId, kind: row.payload.kind, capturedRole: row.payload.capturedRole })) }, durable: durable && { profiles: durable.profiles.map(row => ({ role: row.role, scope: row.scope, noPrivateCatalogueRetained: !(row.handover?.privateCatalogue.length) })), outbox: durable.outbox.map(row => ({ id: row.payload.operationId, kind: row.payload.kind, state: row.state, lastError: row.lastError })) } }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ report, pass: results.filter(row => row.status === 'PASS').length, fail: results.filter(row => row.status === 'FAIL').length }))
if (results.some(row => row.status === 'FAIL')) process.exitCode = 1

