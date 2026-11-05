import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '')
const { directory } = JSON.parse(await readFile(path.join(root, 'phase2-current.json'), 'utf8'))
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
  await mkdir(profile)
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
async function createDraft(name, product) { await offline(true); await click('New local request'); await field('Customer name', name); await field('Mobile', '9876543210'); await field('Saved catalogue', product); await click('Add product'); await saved(); await click('Queue request creation'); await wait("document.body.textContent.includes('1 pending')") }
async function storageSummary() { return evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('diwali-offline-billing-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['profiles','catalogues','drafts','outbox'],'readonly'),queries={};for(const name of ['profiles','catalogues','drafts','outbox'])queries[name]=tx.objectStore(name).getAll();tx.oncomplete=()=>{const scope=x=>JSON.parse(x.scopeKey);resolve({profiles:queries.profiles.result.map(x=>({scope:scope(x),role:x.role})),catalogues:queries.catalogues.result.map(x=>({scope:scope(x),products:x.products.map(p=>p.id)})),drafts:queries.drafts.result.map(x=>({scope:scope(x),draftId:x.draftId,name:x.body.customer.name,products:x.body.items.map(i=>i.productId)})),outbox:queries.outbox.result.map(x=>({id:x.payload.operationId,scope:x.payload.scope,kind:x.payload.kind,state:x.state}))});db.close()}}})`) }
function pass(id, name, scenarios, evidence) { results.push({ id, name, scenarios, status: 'PASS', modules: ['AdminSessionContext', 'AdminWorkspaceShell', 'AdminQuickBillPage', 'AdminOfflineBillingPage', 'offline/storage'], evidence }); console.log('PASS ' + id + ' ' + name) }
const names = { a: 'Acceptance Offline A ' + attempt, b: 'Acceptance Offline B ' + attempt }
const profiles = { dual: resumed?.profiles.dual ?? path.join(directory, 'browser-dual-' + attempt), ownerB: path.join(directory, 'browser-owner-b-' + attempt) }
let durable = resumed?.durable, ownerBillId
try {
  if (!resumed) {
  await launch(profiles.dual); await login(state.actors.dual, state.a)
  await link('/admin/quick-bill'); await field('Search name or ID', state.products.a)
  await wait("Boolean(document.querySelector('button.admin-quick-bill__product-add'))")
  await evaluate("document.querySelector('button.admin-quick-bill__product-add').click()")
  await wait("document.querySelector('[aria-label=Cart]')?.textContent.includes('Acceptance Product A')")
  await field('Name', 'Cart A Customer')
  await selectStall(state.b)
  await wait("document.querySelector('[aria-label=Cart]')?.textContent.includes('Add products from search')")
  assert.equal(await evaluate("document.querySelector('[aria-label=Cart]').textContent.includes('Acceptance Product A')"), false)
  assert.equal(await evaluate("Array.from(document.querySelectorAll('label')).find(x=>x.textContent.trim()==='Name').querySelector('input').value"), 'Walk-in')
  await field('Search name or ID', state.products.b)
  await wait("Boolean(document.querySelector('button.admin-quick-bill__product-add'))")
  await evaluate("document.querySelector('button.admin-quick-bill__product-add').click()")
  await wait("document.querySelector('[aria-label=Cart]')?.textContent.includes('Acceptance Product B')")
  assert.equal(await evaluate("Boolean(document.querySelector('[aria-label=\"Pricing mode\"]'))"), false)
  assert.equal(await evaluate("Boolean(document.querySelector('[aria-label=\"Internal bargain reference\"]'))"), false)
  pass('BROWSER-01', 'Switching A to B clears the Quick Bill cart and privileged pricing controls', [3, 4, 7, 10])
  await selectStall(state.a); await prepare(); await createDraft(names.a, state.products.a)
  await offline(false); await link('/admin/context'); await selectStall(state.b)
  const cursorB = apiTrace.length
  await prepare()
  assert.equal(await evaluate(`document.body.textContent.includes(${JSON.stringify(names.a)})`), false)
  await wait("document.body.textContent.includes('0 pending')")
  await createDraft(names.b, state.products.b)
  durable = await storageSummary()
  assert.equal(durable.drafts.length, 2); assert.equal(durable.outbox.length, 2)
  for (const [location, product, name] of [[state.a, state.products.a, names.a], [state.b, state.products.b, names.b]]) {
    const draft = durable.drafts.find(x => x.name === name), catalogue = durable.catalogues.find(x => x.scope[1] === location)
    assert.equal(draft.scope[1], location); assert.deepEqual(draft.products, [product]); assert.deepEqual(catalogue.products, [product])
    const op = durable.outbox.find(x => x.scope.locationId === location); assert.equal(op.state, 'pending'); assert.equal(op.scope.userId, state.actors.dual.id)
  }
  const bCalls = apiTrace.slice(cursorB).filter(x => !['/api/admin/session'].includes(x.path) && !x.path.startsWith('/api/admin/auth/'))
  assert.ok(bCalls.length > 0); assert.ok(bCalls.every(x => x.location === state.b && x.season === state.season), JSON.stringify(bCalls))
  pass('BROWSER-02', 'A/B drafts, catalogue snapshots and pending outbox remain distinct; B API calls use only B scope', [5, 7, 9], durable)
  await offline(false); await link('/admin/context'); await selectStall(state.a); await prepare()
  await wait(`document.body.textContent.includes(${JSON.stringify(names.a)})`)
  assert.equal(await evaluate(`document.body.textContent.includes(${JSON.stringify(names.b)})`), false)
  const restored = await storageSummary()
  assert.deepEqual(restored.outbox.map(x => x.id).sort(), durable.outbox.map(x => x.id).sort())
  pass('BROWSER-03', 'Returning to A restores only A while preserving both original operation identities', [7, 14], { operationIds: restored.outbox.map(x => x.id) })
  }
  await close(); await launch(profiles.ownerB); await login(state.actors.ownerB, state.b)
  await link('/admin/quick-bill'); await field('Search name or ID', state.products.b)
  await wait("Boolean(document.querySelector('button.admin-quick-bill__product-add'))")
  await evaluate("document.querySelector('button.admin-quick-bill__product-add').click()")
  await wait("document.querySelector('[aria-label=Cart]')?.textContent.includes('Acceptance Product B')")
  await field('Name', 'Owner B Browser ' + attempt); await field('Mobile (10 digits)', '9876543210'); await click('Save bill & quotation')
  await wait("document.body.textContent.includes('Bill saved')")
  ownerBillId = await evaluate("document.querySelector('a[href^=\"/admin/customer-requests/\"]').getAttribute('href').split('/').pop()")
  assert.ok(ownerBillId)
  pass('BROWSER-04', 'Owner B independently signs in and saves a real B bill in a separate profile', [2, 4, 5], { requestId: ownerBillId })
} catch (error) { results.push({ id: 'BROWSER-remaining', name: 'Remaining browser acceptance workflow', scenarios: [2, 7], status: 'FAIL', error: error.message }); console.log('FAIL ' + error.message) }
finally { await close() }
const report = path.join(directory, 'browser-attempt-' + attempt + '.json')
await writeFile(report, JSON.stringify({ resumedFrom: resumePath, results, profiles, apiTrace, blockedOrigins: [...blockedOrigins], durable, ownerBillId }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ report, pass: results.filter(x => x.status === 'PASS').length, fail: results.filter(x => x.status === 'FAIL').length }))
if (results.some(x => x.status === 'FAIL')) process.exitCode = 1
