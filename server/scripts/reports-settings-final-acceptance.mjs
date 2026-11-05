// Missing final-acceptance checks only. Explicit local Miniflare; no Wrangler/migrations.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { build as buildFrontend } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pwaShellPlugin } from '../../scripts/pwaShellPlugin.js'

const root = 'C:/Users/naidu/AppData/Local/Temp/diwali-release-b38657123a324f3a9e7c02c159b82c79'
const mode = process.argv[2]
const directory = mode === 'prepare' ? path.join(root, 'reports-settings-final-' + crypto.randomUUID().slice(0, 8)) : path.resolve(process.argv[3])
assert.equal(path.dirname(directory), path.resolve(root))
assert.ok(path.basename(directory).startsWith('reports-settings-final-'))
const file = name => path.join(directory, name)
const save = (name, value) => writeFile(file(name), JSON.stringify(value, null, 2))
const source = JSON.parse(await readFile(path.join(root, 'chain-687017a4/state.json'), 'utf8'))
const inspect = async action => {
  const result = await promisify(execFile)('C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe',
    ['server/scripts/reports-settings-final-db.py', directory, action], { windowsHide: true })
  console.log(result.stdout.trim())
}
let state
const options = () => ({ modules: true, compatibilityDate: '2026-05-01', host: '127.0.0.1', port: 0,
  d1Databases: { DB: state.databaseId }, d1Persist: file('persist/v3/d1'),
  cachePersist: false, kvPersist: false, r2Persist: false, durableObjectsPersist: false })
if (mode === 'prepare') {
  await mkdir(directory)
  const tag = path.basename(directory).slice(-8)
  state = { databaseId: crypto.randomUUID(), sourceDatabase: source.databaseFile,
    a: 'final-' + tag + '-a', b: 'final-' + tag + '-b', business: 'final-' + tag,
    season: source.season, productA: 'P' + (950000 + Math.floor(Math.random() * 10000)), productB: 'P' + (970000 + Math.floor(Math.random() * 10000)),
    productZero: 'P' + (990000 + Math.floor(Math.random() * 10000)) }
  const empty = new Miniflare({ ...options(), script: 'export default {fetch(){return new Response("fixture")}}' })
  try { await (await empty.getD1Database('DB')).prepare('SELECT 1').first() } finally { await empty.dispose() }
  const data = file('persist/v3/d1/miniflare-D1DatabaseObject')
  const names = (await readdir(data)).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  assert.equal(names.length, 1)
  state.databaseFile = path.join(data, names[0])
  await save('state.json', state)
  await inspect('clone')
  console.log(JSON.stringify({ directory, migrationsApplied: false }))
  process.exit(0)
}
state = JSON.parse(await readFile(file('state.json'), 'utf8'))
if (mode === 'verify') { await inspect('verify'); process.exit(0) }
if (mode === 'build') {
  await buildFrontend({ configFile: false, envDir: false, root: process.cwd(), plugins: [react(), tailwindcss(), pwaShellPlugin()],
    define: { 'import.meta.env.VITE_API_BASE_URL': '""' }, build: { outDir: file('frontend-dist'), emptyOutDir: false }, logLevel: 'warn' })
  console.log('BUILD PASS'); process.exit(0)
}
assert.ok(['runtime', 'runtime-resume', 'browser'].includes(mode))
const bundle = await build({ entryPoints: [path.resolve('server/src/index.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent' })
const runtime = new Miniflare({ ...options(), script: bundle.outputFiles[0].text,
  bindings: { ADMIN_LOCATION_MODE: true, ADMIN_LOCAL_DEV_AUTH: false } })
const base = new URL(await runtime.ready)
const db = await runtime.getD1Database('DB')
const sql = (query, ...values) => db.prepare(query).bind(...values)
const trace = [], results = [], cookies = {}
const resultMode = mode === 'runtime-resume' ? 'runtime' : mode
if (mode === 'runtime-resume') {
  const previous = JSON.parse(await readFile(file('runtime-results.json'), 'utf8'))
  await save('runtime-attempt-' + Date.now() + '.json', previous)
  results.push(...previous.filter(row => row.status === 'PASS'))
  trace.push(...JSON.parse(await readFile(file('runtime-trace.json'), 'utf8')))
}
async function api(actor, route, { method = 'GET', body, location = state.a, season = state.season, revision } = {}) {
  const response = await fetch(new URL('/api/admin/' + route, base), { method,
    headers: { Origin: base.origin, 'Content-Type': 'application/json', Cookie: cookies[actor] ?? '',
      'X-Admin-Location-Id': location, 'X-Admin-Season-Id': season, 'Idempotency-Key': crypto.randomUUID(),
      ...(revision == null ? {} : { 'If-Match': String(revision) }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json()
  trace.push({ actor, route, method, location, season, status: response.status, error: data.error })
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], cache: response.headers.get('cache-control') }
}
async function okay(actor, route, options) {
  const response = await api(actor, route, options)
  assert.ok(response.status === 200 || response.status === 201, JSON.stringify({ route, status: response.status, error: response.data }))
  return response.data
}
async function check(id, caseIds, callback) {
  if (results.some(row => row.id === id && row.status === 'PASS')) { console.log('RETAIN ' + id); return }
  try { const evidence = await callback(); results.push({ id, caseIds, status: 'PASS', evidence }); console.log('PASS ' + id) }
  catch (error) { results.push({ id, caseIds, status: 'FAIL', error: error.stack }); throw error }
  finally { await save(resultMode + '-results.json', results); await save(resultMode + '-trace.json', trace) }
}
async function businessHash() {
  const tables = (await sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results
  const hashes = {}
  for (const { name } of tables) if (!['admin_users', 'admin_sessions', 'admin_login_attempts'].includes(name)) {
    const rows = (await sql('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()).results.map(row => JSON.stringify(row)).sort()
    hashes[name] = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  return hashes
}
async function makeBill({ actor = 'owner', location = state.a, product = state.productA, due = 17000, quantity = 2, unitType = 'box', finalize = true } = {}) {
  const created = await okay(actor, 'quick-bill/checkout', { method: 'POST', location,
    body: { customer: { name: 'Final acceptance ' + location, mobile: '9876543210' }, items: [{ productId: product, quantity, unitType }], pricingMode: 'bargain', acceptedAmountPaise: due } })
  const id = created.request.id
  if (finalize) {
    const revision = (await sql('SELECT revision FROM customer_requests WHERE id=?', id).first()).revision
    await okay(actor, `customer-requests/${id}/finalize`, { method: 'PATCH', location, revision })
  }
  return id
}
async function report(type, query = '', actor = 'owner', location = state.a) {
  return okay(actor, 'reports/' + type + (query ? '?' + query : ''), { location })
}
async function runNative() {
  assert.ok(mode === 'runtime-resume' || !state.seeded, 'Never replay fixture setup on saved target')
  for (const actor of ['owner', 'ownerB']) {
    const response = await api(actor, 'auth/login', { method: 'POST', body: { email: source.actors[actor].email, password: source.password } })
    assert.equal(response.status, 200); cookies[actor] = response.cookie
  }
  if (!state.seeded) {
  const statements = [sql("INSERT INTO businesses(id,slug,name,business_type) VALUES(?,?,?,'permanent')", state.business, state.business, 'Final acceptance')]
  for (const location of [state.a, state.b]) {
    statements.push(sql('INSERT INTO business_locations(id,business_id,slug,name) VALUES(?,?,?,?)', location, state.business, location, location),
      sql('INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(?,?,2026)', location, state.season),
      sql('INSERT INTO categories(slug,label,season_id,location_id) VALUES(?,?,?,?)', location + '-cat', location, state.season, location))
  }
  for (const [location, actor, role] of [[state.a, 'owner', 'owner'], [state.b, 'owner', 'admin'], [state.b, 'ownerB', 'owner']])
    statements.push(sql('INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(?,?,?,?)', location, state.season, source.actors[actor].id, role))
  for (const [product, location, cost] of [[state.productA, state.a, 6001], [state.productB, state.b, 5000], [state.productZero, state.a, 0]]) {
    statements.push(sql('INSERT INTO products(id,category_slug,name,pack,company,selling_price_paise,final_price_paise,pieces_per_pack,allow_loose_sale,season_id,location_id) VALUES(?,?,?,?,?,10000,8000,10,1,?,?)', product, location + '-cat', product, '10 pieces', 'Fixture', state.season, location),
      sql("INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES(?,?,'2026-01-01',?,?)", product, cost, state.season, location))
  }
  await db.batch(statements)
  state.seeded = true; await save('state.json', state)
  }
  await check('FINAL-01-QUOTE-REGISTER', ['REPORTS-01-REGISTER-TOTALS'], async () => {
    state.billA = await makeBill()
    state.lossBill = await makeBill({ due: 100, quantity: 3, unitType: 'piece' })
    state.zeroBill = await makeBill({ due: 9000, product: state.productZero })
    state.billB = await makeBill({ actor: 'ownerB', location: state.b, product: state.productB, due: 9000 })
    state.pending = await makeBill({ finalize: false })
    state.void = await makeBill({ finalize: false })
    // Test-only fixtures: older void quotations and a void request, new IDs only.
    await sql("UPDATE customer_requests SET status='void' WHERE id=?", state.void).run()
    for (let index = 0; index < 2; index++) await sql("INSERT INTO quotations(id,customer_request_id,status,subtotal_paise,total_paise,season_id,location_id) VALUES(?,?,'void',999999,999999,?,?)", crypto.randomUUID(), state.billA, state.season, state.a).run()
    const rows = await report('bills', 'limit=1')
    assert.equal(rows.summary.billCount, 3); assert.equal(rows.summary.amountDuePaise, 26100); assert.equal(rows.pagination.total, 3)
    const ids = []
    for (let page = 1; page <= 3; page++) {
      const result = await report('bills', 'limit=1&page=' + page)
      assert.equal(result.summary.amountDuePaise, 26100); ids.push(result.rows[0].requestId)
    }
    assert.deepEqual(new Set(ids), new Set([state.billA, state.lossBill, state.zeroBill]))
    const b = await report('bills', '', 'ownerB', state.b); assert.equal(b.summary.amountDuePaise, 9000); assert.equal(b.summary.billCount, 1)
    await save('state.json', state)
    return { aBills: 3, aDuePaise: 26100, bBills: 1, bDuePaise: 9000, oldVoidQuotes: 2, pendingExcluded: true, voidRequestExcluded: true, uniquePagedBills: ids.length }
  })
  await check('FINAL-02-PAYMENT-AGGREGATION', ['REPORTS-03-PAYMENT-BALANCE'], async () => {
    assert.equal((await report('bills', 'requestId=' + state.billA)).rows[0].paymentStatus, 'UNPAID')
    async function payment(entryType, amountPaise, paymentMethod, index) {
      const revision = (await sql('SELECT revision FROM customer_requests WHERE id=?', state.billA).first()).revision
      await okay('owner', `customer-requests/${state.billA}/payments`, { method: 'POST', revision, body: {
        operationId: crypto.randomUUID(), entryType, amountPaise, recordingMode: index % 2 ? 'OFFLINE' : 'ONLINE',
        occurredAt: '2026-11-01T12:00:00.000Z', ...(paymentMethod ? { paymentMethod, reference: paymentMethod === 'CASH' ? undefined : 'FINAL-' + crypto.randomUUID() } : {}) } })
    }
    await payment('PAYMENT', 1000, 'CASH', 0)
    await payment('HOLD', 0, null, 0)
    assert.equal((await report('bills', 'requestId=' + state.billA)).rows[0].paymentStatus, 'HOLD')
    await payment('RELEASE_HOLD', 0, null, 0)
    const partial = (await report('bills', 'requestId=' + state.billA)).rows[0]
    assert.equal(partial.paymentStatus, 'PARTIAL'); assert.equal(partial.receivedPaise, 1000); assert.equal(partial.outstandingPaise, 16000)
    for (const [index, method, amount] of [[1, 'UPI', 2000], [2, 'CARD', 3000], [3, 'BANK', 4000], [4, 'OTHER', 7000]]) await payment('PAYMENT', amount, method, index)
    const paid = (await report('bills', 'requestId=' + state.billA)).rows[0]
    assert.equal(paid.paymentStatus, 'PAID'); assert.equal(paid.outstandingPaise, 0); assert.equal(paid.receivedPaise, 17000)
    const collected = await report('collections', 'requestId=' + state.billA)
    assert.equal(collected.summary.paymentCount, 5); assert.equal(collected.summary.collectedPaise, 17000)
    assert.deepEqual(new Set(collected.rows.map(row => row.paymentMethod)), new Set(['CASH', 'UPI', 'CARD', 'BANK', 'OTHER']))
    assert.equal((await report('bills', 'requestId=' + state.zeroBill)).rows[0].paymentStatus, 'UNPAID')
    return { partialReceivedPaise: 1000, partialOutstandingPaise: 16000, paidReceivedPaise: 17000, paidOutstandingPaise: 0, paymentCount: 5, holdEvents: 2, methods: 5, modes: 2 }
  })
  await check('FINAL-03-LOSS-AND-LOOSE-COST', ['REPORTS-06-UNITS-PROFIT'], async () => {
    await sql('UPDATE product_purchase_rates SET unit_rate_paise=99999 WHERE product_id=?', state.productA).run()
    const loss = (await report('profit', 'requestId=' + state.lossBill)).rows[0]
    assert.equal(loss.purchaseCostPaise, 1800); assert.equal(loss.profitPaise, -1700)
    const zero = (await report('profit', 'requestId=' + state.zeroBill)).rows[0]
    assert.equal(zero.purchaseCostPaise, 0); assert.equal(zero.profitPaise, 9000)
    return { frozenBoxRate: 6001, piecesPerBox: 10, floorPieceCost: 600, quantity: 3, frozenCostPaise: 1800, duePaise: 100, lossPaise: -1700, changedCurrentRate: 99999, zeroCostProfitPaise: 9000 }
  })
  await check('FINAL-04-RECIPROCAL-REPORT-SCOPE', ['REPORTS-04-ROLE-PROJECTION', 'REPORTS-05-FOREIGN-SCOPE'], async () => {
    const before = await businessHash()
    assert.equal((await api('owner', 'reports/bills?requestId=' + state.billB)).status, 404)
    assert.equal((await api('ownerB', 'reports/bills?requestId=' + state.billA, { location: state.b })).status, 404)
    const sourceBill = (await sql('SELECT request_id FROM request_payment_accounts WHERE location_id=? LIMIT 1', source.a).first()).request_id
    assert.equal((await api('owner', 'reports/bills?requestId=' + sourceBill)).status, 404)
    assert.equal((await api('owner', 'reports/bills?requestId=' + state.billA, { location: source.a })).status, 404)
    assert.equal((await report('products', 'productId=' + state.productB)).rows.length, 0)
    assert.equal((await report('products', 'productId=' + state.productA, 'ownerB', state.b)).rows.length, 0)
    for (const query of ['businessId=' + source.business, 'locationId=' + state.b, 'seasonId=' + source.otherSeason]) assert.equal((await api('owner', 'reports/bills?' + query)).status, 400)
    const admin = await report('bills', '', 'owner', state.b)
    assert.equal(admin.rows.length, 1); assert.ok(!Object.hasOwn(admin.summary, 'amountDuePaise'))
    assert.ok(!/purchaseCostPaise|profitPaise|recordedQuotationTotalPaise/.test(JSON.stringify(admin)))
    assert.equal((await api('owner', 'reports/profit', { location: state.b })).status, 403)
    assert.deepEqual(await businessHash(), before)
    await sql("UPDATE location_members SET disabled_at='final-test-revocation' WHERE location_id=? AND season_id=? AND admin_user_id=?", state.a, state.season, source.actors.owner.id).run()
    try {
      assert.equal((await api('owner', 'reports/bills')).status, 403)
      assert.equal((await api('owner', 'reports/bills', { location: state.b })).status, 200)
    } finally { await sql('UPDATE location_members SET disabled_at=NULL WHERE location_id=? AND season_id=? AND admin_user_id=?', state.a, state.season, source.actors.owner.id).run() }
    return { ownA: 200, ownB: 200, reciprocalForeignBill: 404, crossBusinessBothDirections: 404, foreignProductsExcluded: true, queryScopeInjection: 400, lowerBRole: 403, revokedA: 403, sameSessionB: 200, reportBusinessRowsUnchanged: true }
  })
  await check('FINAL-05-RECIPROCAL-SETTINGS', ['SETTINGS-01-INDEPENDENCE', 'SETTINGS-02-ROLE-ARCHIVE', 'SETTINGS-04-CONCURRENT-RETRY'], async () => {
    const a = await okay('owner', 'settings'), b = await okay('ownerB', 'settings', { location: state.b })
    const saved = await Promise.all([
      okay('owner', 'settings', { method: 'PATCH', body: { profile: { phone: '9111111111', locationName: 'Final Venue A', brandName: 'Final Brand A' }, expectedProfileRevision: a.revisions.profile, season: { stallDates: ['2026-11-06'], stallTimings: '9 AM to 6 PM' }, expectedSeasonRevision: a.revisions.season } }),
      okay('ownerB', 'settings', { method: 'PATCH', location: state.b, body: { profile: { phone: '9222222222', locationName: 'Final Venue B', brandName: 'Final Brand B' }, expectedProfileRevision: b.revisions.profile, season: { stallDates: ['2026-11-07'], stallTimings: '10 AM to 7 PM' }, expectedSeasonRevision: b.revisions.season } })])
    assert.equal(saved[0].profile.phone, '9111111111'); assert.equal(saved[1].profile.phone, '9222222222')
    const denied = await api('owner', 'settings', { method: 'PATCH', location: state.b, body: { profile: { phone: '9333333333' }, expectedProfileRevision: saved[1].revisions.profile } })
    assert.equal(denied.status, 403)
    assert.equal((await api('ownerB', 'settings', { location: state.a })).status, 403)
    assert.equal((await okay('owner', 'settings')).profile.phone, '9111111111')
    assert.equal((await okay('ownerB', 'settings', { location: state.b })).profile.phone, '9222222222')
    state.settingsA = saved[0].revisions; state.settingsB = saved[1].revisions
    await save('state.json', state)
    return { independentParallelSaves: 200, aRevisions: saved[0].revisions, bRevisions: saved[1].revisions, ownerAAdminBDenied: 403, ownerBForeignADenied: 403, reloadIndependent: true }
  })
  await check('FINAL-06-REPORT-GET-PRESERVATION', ['REPORTS-08-READ-ONLY-OFFLINE'], async () => {
    const before = await businessHash()
    for (const type of ['sales-by-date', 'bills', 'collections', 'products', 'seasons', 'profit']) {
      const result = await api('owner', 'reports/' + type); assert.equal(result.status, 200); assert.equal(result.cache, 'no-store')
    }
    assert.deepEqual(await businessHash(), before)
    await save('report-read-hashes.json', before)
    return { sixGetRoutes: 200, cacheControl: 'no-store', unchangedNonAuthTables: Object.keys(before).length }
  })
  await check('FINAL-09-SETTINGS-BOUNDS-AND-AUDIT', ['SETTINGS-03-VALIDATION-ATOMICITY'], async () => {
    const before = await businessHash()
    const current = await okay('owner', 'settings')
    const invalidProfiles = [{ stallName: 'x'.repeat(201) }, { brandName: 'x'.repeat(121) }, { locationAddress: 'x'.repeat(1001) },
      { locationDetailLines: Array.from({ length: 9 }, (_, index) => 'detail ' + index) }, { password: 'forbidden-test-value' }]
    for (const profile of invalidProfiles) assert.equal((await api('owner', 'settings', { method: 'PATCH', body: { profile, expectedProfileRevision: current.revisions.profile } })).status, 400)
    assert.equal((await api('owner', 'settings', { method: 'PATCH', body: { season: { stallTimings: 'x'.repeat(161) }, expectedSeasonRevision: current.revisions.season } })).status, 400)
    assert.equal((await api('owner', 'settings', { method: 'PATCH', body: { profile: { phone: '9555555555' }, expectedProfileRevision: current.revisions.profile, actorUserId: 'forged', receivedAt: '1970-01-01' } })).status, 400)
    assert.deepEqual(await businessHash(), before)
    const audit = await sql('SELECT actor_user_id,actor_role,business_id,location_id,season_id,received_at FROM location_settings_events WHERE location_id=?', state.a).first()
    assert.equal(audit.actor_user_id, source.actors.owner.id); assert.equal(audit.actor_role, 'owner')
    assert.equal(audit.business_id, state.business); assert.equal(audit.season_id, state.season); assert.ok(Number.isFinite(Date.parse(audit.received_at)))
    return { invalidExtendedBoundsAndSecurityInputs: 7, status: 400, allNonAuthRowsUnchanged: true, validatedAuditActorScopeAndServerTimestamp: true }
  })
  await check('FINAL-10-UNKNOWN-PAYMENT-TIMES', ['REPORTS-02-DATE-BASIS'], async () => {
    // Malformed legacy time fixture only; normal payment API does not accept this input.
    const id = crypto.randomUUID()
    await sql(`INSERT INTO request_payment_ledger(payment_id,operation_id,payload_fingerprint,request_id,business_id,location_id,season_id,
      entry_type,amount_paise,recording_mode,payment_method,actor_user_id,actor_role,occurred_at,received_at)
      VALUES(?,?,?,?,?,?,?,'PAYMENT',1,'ONLINE','CASH',?,'owner','unknown-legacy-time','unknown-legacy-time')`,
    id, id, 'final-legacy-time-fixture', state.lossBill, state.business, state.a, state.season, source.actors.owner.id).run()
    for (const basis of ['received', 'occurred']) {
      const all = await report('collections', 'requestId=' + state.lossBill + '&dateBasis=' + basis)
      assert.equal(all.summary.unknownTimestampPaymentCountInScope, 1)
      assert.equal(all.summary.collectedPaise, 1); assert.equal(all.rows[0].businessDate, null)
      const filtered = await report('collections', 'requestId=' + state.lossBill + '&dateBasis=' + basis + '&from=2026-01-01&toExclusive=2027-01-01')
      assert.equal(filtered.summary.unknownTimestampPaymentCountInScope, 1)
      assert.equal(filtered.summary.collectedPaise, 0); assert.equal(filtered.rows.length, 0)
    }
    return { seededUnknownTimePaymentPaise: 1, bothTimestampBases: true, unknownCoverageCount: 1, unfilteredDate: null, dateFilteredRows: 0, fabricatedTimestamp: false }
  })
}

// One fresh profile for the previously missing real browser offline checks.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, predicate = Boolean) {
  for (let n = 0; n < 200; n++) { const value = await read(); if (predicate(value)) return value; await delay(100) }
  throw Error('Browser state timed out')
}
async function runBrowser() {
  assert.ok(state.seeded)
  const before = await businessHash()
  const server = createServer(async (request, response) => {
    try {
      if (request.url.startsWith('/api/')) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk)
        const headers = new Headers()
        for (const [key, value] of Object.entries(request.headers)) if (!['host', 'content-length', 'connection'].includes(key) && value != null) headers.set(key, String(value))
        // Same-origin local proxy; Worker sees its own local Origin.
        headers.set('Origin', base.origin)
        const result = await fetch(new URL(request.url, base), { method: request.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) })
        for (const [key, value] of result.headers) if (!['transfer-encoding', 'connection', 'content-length', 'content-encoding', 'set-cookie'].includes(key)) response.setHeader(key, value)
        const cookieHeaders = result.headers.getSetCookie(); if (cookieHeaders.length) response.setHeader('Set-Cookie', cookieHeaders)
        trace.push({ route: request.url, method: request.method, status: result.status })
        response.writeHead(result.status); response.end(Buffer.from(await result.arrayBuffer())); return
      }
      const assetRoot = file('frontend-dist')
      let asset = path.resolve(assetRoot, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
      assert.ok(asset === assetRoot || asset.startsWith(assetRoot + path.sep))
      try { if (!(await stat(asset)).isFile()) asset = path.join(assetRoot, 'index.html') } catch { asset = path.join(assetRoot, 'index.html') }
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(asset)] ?? 'application/octet-stream')
      response.end(await readFile(asset))
    } catch { response.writeHead(500); response.end('local test proxy failed') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
  const profile = file('browser-offline-' + crypto.randomUUID().slice(0, 8))
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--enable-automation', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let socket, sequence = 0
  const pending = new Map(), errors = []
  let browserCall
  try {
    const target = await until(async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json() } catch { return null } }, value => value?.webSocketDebuggerUrl)
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    browserCall = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task.reject(Error(JSON.stringify(message.error))); else task.resolve(message.result) }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
      if (message.method === 'Fetch.requestPaused') {
        const url = new URL(message.params.request.url), allowed = url.origin === origin || ['about:', 'data:', 'blob:'].includes(url.protocol)
        browserCall(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: message.params.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) }).catch(() => {})
      }
    }
    const evaluate = async expression => { const result = await browserCall('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value }
    const wait = expression => until(() => evaluate(expression))
    const click = label => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Unavailable button');b.click()})()`)
    const field = (label, value) => evaluate(`(()=>{const e=document.querySelector('[aria-label='+JSON.stringify(${JSON.stringify(label)})+']')||document.querySelector(${JSON.stringify(label === 'Email' ? 'input[type=email]' : 'input[type=password]')});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    const choose = async value => { await wait(`Array.from(document.querySelectorAll('select')).some(s=>[...s.options].some(o=>o.value===${JSON.stringify(value)}))`); await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value===${JSON.stringify(value)}));s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(200) }
    const navigate = async route => { await wait(`Boolean(document.querySelector('a[href="${route}"]'))`); await evaluate(`document.querySelector('a[href="${route}"]').click()`); await wait(`location.pathname===${JSON.stringify(route)}`) }
    const offline = value => browserCall('Network.emulateNetworkConditions', { offline: value, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await browserCall('Runtime.enable'); await browserCall('Network.enable'); await browserCall('Page.enable'); await browserCall('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    assert.ok((await browserCall('Browser.getBrowserCommandLine')).arguments.includes('--user-data-dir=' + profile))
    await browserCall('Page.navigate', { url: origin + '/admin/login' })
    await wait("Boolean(document.querySelector('input[type=email]'))")
    await field('Email', source.actors.owner.email); await field('Password', source.password); await click('Sign in')
    await wait("location.pathname!=='/admin/login'"); await choose(state.season); await choose(state.a)
    await navigate('/admin/reports'); await wait("Boolean(document.querySelector('[aria-label=\"Report results\"]'))")
    await check('FINAL-07-BROWSER-REPORTS-OFFLINE', ['REPORTS-08-READ-ONLY-OFFLINE'], async () => {
      await offline(true)
      await choose('bills')
      await wait("Boolean(document.querySelector('[role=alert]'))")
      assert.equal(await evaluate("Boolean(document.querySelector('[aria-label=\"Report results\"]'))"), false)
      const message = await evaluate("document.querySelector('[role=alert]').textContent")
      await offline(false); await click('Retry reports'); await wait("Boolean(document.querySelector('[aria-label=\"Report results\"]'))")
      const caches = await evaluate("(async()=>{const found=[];for(const name of await caches.keys()){const c=await caches.open(name);for(const r of await c.keys())if(r.url.includes('/api/admin/reports'))found.push(r.url)}return found})()")
      assert.deepEqual(caches, [])
      return { offlineTransport: 'Chrome Network.emulateNetworkConditions', explicitError: message, staleResultsHidden: true, onlineRetryRecovered: true, sharedReportCacheEntries: 0, physicalAndroid: false }
    })
    await navigate('/admin/settings'); await wait("Boolean(document.querySelector('[aria-label=Phone]'))")
    await check('FINAL-08-BROWSER-SETTINGS-OFFLINE', ['SETTINGS-05-SWITCH-OFFLINE'], async () => {
      await field('Phone', '9444444444'); await offline(true); await click('Save settings')
      await wait("Boolean(document.querySelector('[role=alert]'))")
      const message = await evaluate("document.querySelector('[role=alert]').textContent")
      assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save settings').disabled"), true)
      await offline(false); await click('Reload settings and discard edits')
      await wait("document.querySelector('[aria-label=Phone]')?.value==='9111111111'")
      assert.deepEqual(await businessHash(), before)
      return { explicitError: message, savePausedUntilReload: true, serverValueUnchanged: true, allNonAuthTableHashesUnchanged: true, physicalAndroid: false }
    })
    const screenshot = await browserCall('Page.captureScreenshot', { format: 'png' }); await writeFile(file('offline-recovery.png'), Buffer.from(screenshot.data, 'base64'))
    assert.deepEqual(errors, []); await save('browser-console.json', { uncaughtExceptions: errors })
  } finally {
    if (socket?.readyState === 1) { await Promise.race([browserCall('Browser.close').catch(() => {}), delay(1500)]); socket.close() }
    chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
}
try { if (resultMode === 'runtime') await runNative(); else await runBrowser() }
finally { await runtime.dispose(); await save(resultMode + '-results.json', results); await save(resultMode + '-trace.json', trace); console.log(JSON.stringify({ directory, mode, checks: results.length })) }
