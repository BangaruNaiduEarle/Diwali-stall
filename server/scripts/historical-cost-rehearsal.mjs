import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { hashPassword } from '../src/lib/passwordHash.js'

const root = 'C:/Users/naidu/AppData/Local/Temp/diwali-release-b38657123a324f3a9e7c02c159b82c79'
const run = promisify(execFile), python = 'C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe'
const requestedMode = process.argv[2]
const mode = requestedMode === 'post-resume' ? 'post' : requestedMode
const directory = mode === 'prepare' ? path.join(root, 'p25-' + crypto.randomUUID().slice(0, 8)) : path.resolve(process.argv[3])
assert.ok(directory.startsWith(path.resolve(root) + path.sep) && path.basename(directory).startsWith('p25-'))
const file = name => path.join(directory, name)
const save = (name, value) => writeFile(file(name), JSON.stringify(value, null, 2))
const inspect = async task => {
  const r = await run(python, ['server/scripts/historical-cost-rehearsal-db.py', root, directory, task], { windowsHide: true })
  await writeFile(file(task + '.log'), r.stdout)
  console.log(r.stdout.trim())
}
const migration = '0025_bill_purchase_cost_snapshots.sql'
let state
if (mode === 'prepare') {
  await mkdir(directory)
  await inspect('export')
  state = { directory, databaseId: crypto.randomUUID(), databaseName: 'diwali-cost-rehearsal', season: 'cost-2026', otherSeason: 'cost-2027',
    a: 'cost-stall-a', b: 'cost-stall-b', password: 'Cost-' + crypto.randomUUID(), actors: {}, created: {} }
  await mkdir(file('migrations'))
  await writeFile(file('migrations/' + migration), await readFile('server/database/migrations/' + migration))
  await writeFile(file('wrangler.toml'), `name = "diwali-cost-rehearsal"\nmain = "${path.resolve('server/src/index.js').replaceAll('\\', '/')}"\ncompatibility_date = "2026-05-01"\n[vars]\nADMIN_LOCATION_MODE = true\nADMIN_LOCAL_DEV_AUTH = false\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${state.databaseName}"\ndatabase_id = "${state.databaseId}"\nmigrations_dir = "migrations"\n`)
  await save('state.json', state)
} else state = JSON.parse(await readFile(file('state.json'), 'utf8'))

if (mode === 'verify-migration' || mode === 'verify-final') {
  await inspect(mode)
  process.exit(0)
}

if (mode === 'complete-prepare') {
  const entries = await readdir(file('persist/v3/d1/miniflare-D1DatabaseObject'))
  const files = entries.filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  assert.equal(files.length, 1)
  state.databaseFile = file('persist/v3/d1/miniflare-D1DatabaseObject/' + files[0])
  for (const actor of ['owner','super','admin']) state.actors[actor] = { id: 'cost-' + actor, email: 'cost-' + actor + '@rehearsal.invalid' }
  await save('state.json', state)
  console.log(JSON.stringify({directory, preparationResumed:true, businessRowsRepeated:false}))
  process.exit(0)
}

if (mode === 'apply') {
  await inspect('freeze')
  for (const [name, args] of [
    ['migration-apply', ['migrations', 'apply']], ['migration-list', ['migrations', 'list']],
  ]) {
    const command = [path.resolve('server/node_modules/wrangler/bin/wrangler.js'), 'd1', ...args, state.databaseName, '--local',
      '--config', file('wrangler.toml'), '--persist-to', file('persist')]
    let result
    try { result = await run(process.execPath, command, { windowsHide: true, maxBuffer: 4e6, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }) }
    catch (error) { await writeFile(file(name + '.stderr.log'), error.stderr ?? error.message); await writeFile(file(name + '.stdout.log'), error.stdout ?? ''); throw error }
    await writeFile(file(name + '.stdout.log'), result.stdout); await writeFile(file(name + '.stderr.log'), result.stderr)
    console.log(name + ' exit 0')
  }
  await inspect('verify-migration')
  process.exit(0)
}
if (mode === 'regressions') {
  const suites = [
    ['cost-billing-offline', ['server/tests/billPurchaseCostSnapshots.test.js', 'server/tests/requestPayments.test.js', 'server/tests/billAdjustmentsHandover.test.js', 'server/tests/offlineSync.test.js']],
    ['finalization-isolation', ['server/tests/adminCustomerRequestFinalizeAgreed.test.js', 'server/tests/adminBillingLocationApi.test.js']],
    ['legacy', ['--test-name-pattern=gate OFF|legacy retries', 'server/tests/adminQuickBillAtomic.test.js']],
    ['qr-history', ['--test-name-pattern=offline handover atomically|Owner-first mixed Family Pack|assignment captures', 'server/tests/handoverSync.test.js', 'server/tests/requestWorkflowHistory.test.js']],
  ]
  const results = []
  for (const [name, selection] of suites) {
    const args = ['--test', '--test-concurrency=1', ...selection]
    const r = await run(process.execPath, args, { windowsHide: true, maxBuffer: 5e6 })
    await writeFile(file(name + '.stdout.log'), r.stdout); await writeFile(file(name + '.stderr.log'), r.stderr)
    const row = { name, args, status: 'PASS' }
    for (const key of ['tests','pass','fail','cancelled','skipped']) row[key] = Number(r.stdout.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))?.[1])
    assert.equal(row.fail, 0); results.push(row); await save('regression-results.json', results); console.log(JSON.stringify(row))
  }
  assert.equal(results.reduce((sum, row) => sum + row.pass, 0), 79)
  process.exit(0)
}
if (!['prepare','pre','post'].includes(mode)) throw Error('Unsupported mode')
const built = await build({ entryPoints: [path.resolve('server/src/index.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent' })
await writeFile(file('worker-bundle.mjs'), built.outputFiles[0].text)
const runtime = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-05-01', host: '127.0.0.1', port: 0,
  d1Databases: { DB: state.databaseId }, d1Persist: file('persist/v3/d1'),
  cachePersist: false, kvPersist: false, r2Persist: false, durableObjectsPersist: false,
  bindings: { ADMIN_LOCATION_MODE: true, ADMIN_LOCAL_DEV_AUTH: false } })
let results = [], trace = []
if (requestedMode === 'post-resume') {
  const previous = JSON.parse(await readFile(file('post-results.json'), 'utf8'))
  await save('post-attempt-' + Date.now() + '.json', previous)
  results = previous.filter(row => row.status === 'PASS')
  trace = JSON.parse(await readFile(file('post-http-trace.json'), 'utf8'))
}
let db, base
const check = async (id, name, callback) => {
  if (results.some(row => row.id === id && row.status === 'PASS')) { console.log('RETAIN ' + id); return }
  try { const evidence = await callback(); results.push({ id, name, status: 'PASS', evidence }); console.log('PASS ' + id) }
  catch (error) { results.push({ id, name, status: 'FAIL', error: error.stack }); throw error }
  finally { await save(mode + '-results.json', results); await save(mode + '-http-trace.json', trace) }
}
const sql = async (text, ...values) => db.prepare(text).bind(...values).all()
const first = async (text, ...values) => (await sql(text, ...values)).results[0]
const api = async (actor, route, { method = 'GET', body, rev, location = state.a, season = state.season, key } = {}) => {
  const r = await fetch(new URL('/api/admin/' + route, base), { method, headers: { 'Content-Type': 'application/json', Origin: base.origin,
    Cookie: state.actors[actor]?.cookie ?? '', 'X-Admin-Location-Id': location, 'X-Admin-Season-Id': season,
    ...(rev == null ? {} : { 'If-Match': String(rev) }), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await r.json()
  trace.push({ actor, route, method, location, season, status: r.status, error: data.error })
  return { status: r.status, data, cookie: r.headers.get('set-cookie')?.split(';')[0] }
}
const okay = response => { assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response.data)); return response.data }
const quote = async (id, actor = 'owner', extra = {}) => okay(await api(actor, `customer-requests/${id}/quotation`, extra)).quotation
const detail = async id => okay(await api('owner', `customer-requests/${id}`)).request
const close = async (id, extra = {}) => api('owner', `customer-requests/${id}/finalize`, { method: 'PATCH', rev: (await detail(id)).revision, ...extra })
const checkout = async (name, { product = 'P925001', quantity = 2, unitType = 'box', ...extra } = {}) => {
  const r = okay(await api('owner', 'quick-bill/checkout', { method: 'POST', key: 'cost-' + name,
    body: { customer: { name: 'Runtime ' + name, mobile: '9876543210' }, items: [{ productId: product, quantity, unitType }], pricingMode: 'bargain', acceptedAmountPaise: 17000 }, ...extra }))
  state.created[name] = r.request.id; await save('state.json', state); return r.request.id
}
const costs = async id => (await sql('SELECT * FROM bill_item_purchase_costs WHERE request_id = ? ORDER BY quotation_item_id', id)).results
try {
  base = await runtime.ready; db = await runtime.getD1Database('DB')
  if (mode === 'prepare') {
    const exported = JSON.parse(await readFile(file('schema-export.json'), 'utf8'))
    for (const [, , , statement] of exported.schema) await db.prepare(statement).run()
    for (const [id, name, appliedAt] of exported.migrations) await db.prepare('INSERT INTO d1_migrations(id,name,applied_at) VALUES(?,?,?)').bind(id, name, appliedAt).run()
    const hash = await hashPassword(state.password)
    const statements = []
    const add = (text, ...values) => statements.push(db.prepare(text).bind(...values))
    add("INSERT INTO businesses(id,slug,name,business_type) VALUES('cost-business','cost-business','Cost Rehearsal','permanent')")
    for (const season of [state.season, state.otherSeason]) add("INSERT INTO business_seasons(id,code,label,status) VALUES(?,?,?,'active')", season, season, season)
    for (const loc of [state.a,state.b]) {
      add("INSERT INTO business_locations(id,business_id,slug,name) VALUES(?,'cost-business',?,?)", loc, loc, loc)
      for (const season of [state.season,state.otherSeason]) add('INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(?,?,2026)', loc, season)
      add('INSERT INTO categories(slug,label,location_id,season_id) VALUES(?,?,?,?)', loc + '-cat', loc, loc, state.season)
    }
    for (const [actor,role] of [['owner','owner'],['super','super_admin'],['admin','admin']]) {
      state.actors[actor] = { id: 'cost-' + actor, email: 'cost-' + actor + '@rehearsal.invalid' }
      add('INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(?,?,?,?,?)', state.actors[actor].id, state.actors[actor].email, actor, role, hash)
      for (const season of [state.season,state.otherSeason]) {
        add('INSERT INTO season_members(season_id,admin_user_id,role) VALUES(?,?,?)', season, state.actors[actor].id, role)
        for (const loc of [state.a,state.b]) add('INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(?,?,?,?)', loc, season, state.actors[actor].id, role)
      }
    }
    for (const [product,loc,cost] of [['P925001',state.a,5000],['P925002',state.b,9000],['P925003',state.a,null]]) {
      add('INSERT INTO products(id,category_slug,name,pack,selling_price_paise,final_price_paise,pieces_per_pack,allow_loose_sale,location_id,season_id) VALUES(?,?,?,?,20000,16000,10,1,?,?)', product, loc + '-cat', product, '10 pieces', loc, state.season)
      if (cost != null) add("INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,location_id,season_id) VALUES(?,?,'2026-01-01',?,?)", product, cost, loc, state.season)
    }
    await db.batch(statements)
    const find = async dir => { const found = []; for (const e of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir,e.name); if(e.isDirectory()) found.push(...await find(p)); else if(p.endsWith('.sqlite')) found.push(p) } return found }
    const files = (await find(file('persist'))).filter(p => path.basename(p) !== 'metadata.sqlite'); assert.equal(files.length,1); state.databaseFile = files[0]
    await save('state.json', state)
    console.log(JSON.stringify({ directory, freshD1: true, schemaObjects: exported.schema.length, businessDataCopied: false }))
  } else {
    for (const actor of Object.keys(state.actors)) {
      const logged = await api(actor, 'auth/login', { method: 'POST', body: { email: state.actors[actor].email, password: state.password } })
      okay(logged); state.actors[actor].cookie = logged.cookie
    }
    if (mode === 'pre') {
      await check('PRE-01', 'Historical bill finalized and partially paid before 0025', async () => {
        assert.equal(await first("SELECT name FROM sqlite_master WHERE name = 'bill_item_purchase_costs'"), undefined)
        const id = await checkout('historical'); okay(await close(id))
        okay(await api('owner', `customer-requests/${id}/payments`, { method: 'POST', rev: (await detail(id)).revision,
          body: { operationId: 'historical-payment-1', entryType: 'PAYMENT', amountPaise: 3000, recordingMode: 'ONLINE', paymentMethod: 'CASH' } }))
        state.historicalBefore = await first('SELECT * FROM request_payment_summaries WHERE request_id = ?',id)
        return state.historicalBefore
      })
    } else {
      await check('D1-01', '0025 schema, indexes, foreign keys and migration receipt', async () => {
        const objects = (await sql("SELECT type,name FROM sqlite_master WHERE name LIKE 'bill_purchase_cost%' OR name = 'bill_item_purchase_costs' OR name = 'idx_bill_purchase_cost_scope' ORDER BY name")).results
        assert.equal(objects.length,7)
        const indexes = (await sql('PRAGMA index_list(bill_item_purchase_costs)')).results
        assert.ok(indexes.some(row => row.name === 'idx_bill_purchase_cost_scope'))
        assert.ok(indexes.some(row => row.unique === 1))
        const columns = (await sql('PRAGMA table_info(bill_item_purchase_costs)')).results
        assert.equal(columns.length,18)
        const migrated = await first('SELECT name FROM d1_migrations WHERE name = ?',migration); assert.ok(migrated)
        assert.equal((await sql('PRAGMA foreign_key_check')).results.length,0)
        return { objects, indexes, columns, migration:migrated }
      })
      await check('D1-02', 'Historical cost unavailable and prior bill/payment rows unchanged', async () => {
        const id = state.created.historical, summary = (await quote(id)).internalFinancialSummary
        assert.equal(summary.available,false); assert.equal(summary.profitPaise,null); assert.equal(summary.unavailableReason,'historical_cost_unavailable')
        assert.deepEqual(await first('SELECT * FROM request_payment_summaries WHERE request_id = ?',id),state.historicalBefore)
        okay(await close(id)); assert.equal((await costs(id)).length,0)
        return { summary, paymentSummary:state.historicalBefore }
      })
      await check('D1-03', 'Finalization captures per-item costs on the native D1 transaction', async () => {
        const id = await checkout('current')
        assert.equal((await costs(id)).length,0)
        await sql("UPDATE product_purchase_rates SET unit_rate_paise = 6001 WHERE product_id = 'P925001'")
        okay(await close(id))
        const rows = await costs(id), summary = (await quote(id)).internalFinancialSummary
        assert.equal(rows.length,1); assert.equal(rows[0].purchase_line_paise,12002); assert.equal(rows[0].purchase_unit_paise,6001)
        assert.ok(rows[0].request_line_id); assert.ok(rows[0].quotation_item_id)
        assert.equal(summary.profitPaise,4998); assert.equal(summary.available,true)
        state.frozenRows = rows; state.frozenSummary = summary
        return { rows, summary }
      })
      await check('D1-04', 'Cost stays frozen after rate edits; bill and partial payment balances unchanged', async () => {
        const id = state.created.current, before = await quote(id)
        await sql("UPDATE product_purchase_rates SET unit_rate_paise = 9900 WHERE product_id = 'P925001'")
        assert.deepEqual((await quote(id)).internalFinancialSummary,state.frozenSummary)
        const p = okay(await api('owner',`customer-requests/${id}/payments`,{method:'POST',rev:(await detail(id)).revision,
          body:{operationId:'runtime-payment-1',entryType:'PAYMENT',amountPaise:3000,recordingMode:'ONLINE',paymentMethod:'CASH'}}))
        assert.equal(p.summary.amountDuePaise,17000); assert.equal(p.summary.receivedPaise,3000); assert.equal(p.summary.outstandingPaise,14000)
        assert.equal((await quote(id)).totalPaise,before.totalPaise)
        assert.deepEqual((await quote(id)).internalFinancialSummary,state.frozenSummary)
        return { quotedTotalPaise:before.totalPaise, paymentSummary:p.summary }
      })
      await check('D1-05', 'Snapshots reject UPDATE DELETE and INSERT OR REPLACE', async () => {
        const id = state.created.current, errors = []
        for (const statement of ['UPDATE bill_item_purchase_costs SET purchase_unit_paise = 1 WHERE request_id = ?',
          'DELETE FROM bill_item_purchase_costs WHERE request_id = ?', 'INSERT OR REPLACE INTO bill_item_purchase_costs SELECT * FROM bill_item_purchase_costs WHERE request_id = ?']) {
          await assert.rejects(async()=>{try{await sql(statement,id)}catch(error){errors.push(error.message);throw error}}, /immutable|scope_or_duplicate/)
        }
        assert.deepEqual(await costs(id),state.frozenRows)
        return { errors, unchanged:true }
      })
      await check('D1-06', 'Duplicate and concurrent finalize retries retain one snapshot and account', async () => {
        const id = state.created.current
        const replies = await Promise.all([close(id),close(id),close(id)])
        replies.forEach(okay); assert.deepEqual(await costs(id),state.frozenRows)
        assert.equal((await first('SELECT count(*) n FROM request_payment_accounts WHERE request_id = ?',id)).n,1)
        return { statuses:replies.map(r=>r.status), snapshots:1, accounts:1 }
      })
      await check('D1-07', 'Stall/season IDs and Admin authority cannot expose historical costs or finalize', async () => {
        const id = state.created.current
        for(const extra of [{location:state.b},{season:state.otherSeason}]) assert.equal((await api('owner',`customer-requests/${id}/quotation`,extra)).status,404)
        assert.equal((await quote(id,'admin')).internalFinancialSummary,undefined)
        const pending = await checkout('admin-denial')
        assert.equal((await api('admin',`customer-requests/${pending}/finalize`,{method:'PATCH',rev:(await detail(pending)).revision})).status,403)
        assert.equal((await costs(pending)).length,0)
        const b = await checkout('stall-b',{product:'P925002',location:state.b})
        const bDetail = okay(await api('super',`customer-requests/${b}`,{location:state.b})).request
        okay(await api('super',`customer-requests/${b}/finalize`,{method:'PATCH',location:state.b,rev:bDetail.revision}))
        const [row] = await costs(b); assert.equal(row.location_id,state.b); assert.equal(row.season_id,state.season); assert.equal(row.purchase_unit_paise,9000)
        const other = await checkout('season-b',{season:state.otherSeason})
        const otherDetail = okay(await api('owner',`customer-requests/${other}`,{season:state.otherSeason})).request
        okay(await api('owner',`customer-requests/${other}/finalize`,{method:'PATCH',season:state.otherSeason,rev:otherDetail.revision}))
        const [otherRow] = await costs(other); assert.equal(otherRow.season_id,state.otherSeason)
        return { foreignStatuses:[404,404], adminFinalize:403, stallB:row, otherSeason:otherRow }
      })
      await check('D1-08', 'Missing rates remain unavailable after later import; loose units retain saved divisor', async () => {
        const id = await checkout('missing',{product:'P925003'}); okay(await close(id))
        assert.equal((await costs(id))[0].unavailable_reason,'missing_purchase_rate')
        await sql("INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,location_id,season_id) VALUES('P925003',4000,'2026-01-01',?,?)",state.a,state.season)
        assert.equal((await quote(id)).internalFinancialSummary.profitPaise,null)
        await sql("UPDATE product_purchase_rates SET unit_rate_paise = 10005 WHERE product_id = 'P925001'")
        const loose = await checkout('loose',{quantity:3,unitType:'piece'}); okay(await close(loose))
        const [row] = await costs(loose); assert.equal(row.pieces_per_pack,10); assert.equal(row.purchase_unit_paise,1000); assert.equal(row.purchase_line_paise,3000)
        return { missingCostProfit:null, loose:row }
      })
      await check('D1-09', 'Offline CLOSE and repeated payment use atomic receipts without duplicate snapshots', async () => {
        const id = await checkout('offline'), scope = {businessId:'cost-business',locationId:state.a,seasonId:state.season,userId:state.actors.owner.id,deviceId:'cost-runtime-device'}
        const deviceToken = 'ab'.repeat(32)
        okay(await api('owner','offline/devices',{method:'POST',body:{deviceId:scope.deviceId,deviceToken}}))
        const op = {operationId:'runtime-close-1',scope,deviceToken,occurredAt:'2026-11-01T12:00:00.000Z',kind:'CLOSE',requestId:id,expectedRevision:(await detail(id)).revision,body:{}}
        const closed = okay(await api('owner','offline/sync',{method:'POST',body:op}))
        const replay = okay(await api('owner','offline/sync',{method:'POST',body:op})); assert.equal(replay.idempotentReplay,true)
        const pay = {...op,operationId:'runtime-offline-payment-1',kind:'PAYMENT',expectedRevision:closed.revision,
          body:{entryType:'PAYMENT',amountPaise:2500,recordingMode:'OFFLINE',paymentMethod:'CASH'}}
        okay(await api('owner','offline/sync',{method:'POST',body:pay})); okay(await api('owner','offline/sync',{method:'POST',body:pay}))
        assert.equal((await costs(id)).length,1)
        const receipts = await first('SELECT count(*) n FROM offline_sync_receipts WHERE request_id = ?',id)
        const ledger = await first('SELECT count(*) n FROM request_payment_ledger WHERE request_id = ?',id)
        assert.equal(receipts.n,2); assert.equal(ledger.n,1)
        return {snapshots:1,receipts:receipts.n,payments:ledger.n}
      })
      await check('D1-10', 'Injected snapshot failure rolls back bill/account/history and offline receipt', async () => {
        const id = await checkout('rollback'), before = await detail(id)
        const countBefore = await first('SELECT count(*) n FROM request_workflow_events WHERE request_id = ?',id)
        await sql("CREATE TRIGGER rehearsal_fail_cost BEFORE INSERT ON bill_item_purchase_costs BEGIN SELECT RAISE(ABORT,'rehearsal_cost_failure'); END")
        try {
          const scope = {businessId:'cost-business',locationId:state.a,seasonId:state.season,userId:state.actors.owner.id,deviceId:'cost-runtime-device'}
          const response = await api('owner','offline/sync',{method:'POST',body:{operationId:'runtime-rollback-close',scope,deviceToken:'ab'.repeat(32),occurredAt:'2026-11-01T12:00:00.000Z',kind:'CLOSE',requestId:id,expectedRevision:before.revision,body:{}}})
          assert.ok(response.status >= 400)
          assert.equal((await detail(id)).revision,before.revision)
          assert.equal((await detail(id)).finalizationStatus,'pending')
          assert.deepEqual(await first('SELECT count(*) n FROM request_workflow_events WHERE request_id = ?',id),countBefore)
          for(const table of ['bill_item_purchase_costs','request_payment_accounts','offline_sync_receipts']) assert.equal((await first(`SELECT count(*) n FROM ${table} WHERE request_id = ?`,id)).n,0)
          return {status:response.status,noPartialRows:true,revision:before.revision}
        } finally { await sql('DROP TRIGGER rehearsal_fail_cost') }
      })
      await check('D1-11', 'Native D1 foreign-key and row/identity counts; integrity checked read-only after disposal', async () => {
        assert.deepEqual((await sql('PRAGMA foreign_key_check')).results,[])
        const counts = {}; for(const table of ['customer_requests','request_payment_accounts','bill_item_purchase_costs','request_payment_ledger','offline_sync_receipts']) counts[table] = (await first(`SELECT count(*) n FROM ${table}`)).n
        return { counts, integrityViaD1: 'NOT TESTED: PRAGMA integrity_check is rejected with SQLITE_AUTH; read-only SQLite verification follows runtime disposal' }
      })
      await check('D1-12', 'Concurrent first finalizations create one snapshot, account and closure event', async () => {
        const id = await checkout('fresh-concurrent'), rev = (await detail(id)).revision
        const replies = await Promise.all([close(id,{rev}),close(id,{rev}),close(id,{rev})])
        assert.ok(replies.some(r => r.status === 200))
        assert.ok(replies.every(r => r.status === 200 || r.status === 409))
        assert.equal((await costs(id)).length,1)
        assert.equal((await first('SELECT count(*) n FROM request_payment_accounts WHERE request_id = ?',id)).n,1)
        assert.equal((await first("SELECT count(*) n FROM request_workflow_events WHERE request_id = ? AND event_type = 'request_closed'",id)).n,1)
        return { statuses: replies.map(r => r.status), snapshots:1, accounts:1, closureEvents:1 }
      })
      await check('D1-13', 'Multiple bill items receive separate stable snapshots and an exact complete cost total', async () => {
        const id = await checkout('multiple-lines', { body: {
          customer: {name:'Multiple cost lines',mobile:'9876543210'}, pricingMode:'bargain',acceptedAmountPaise:17000,
          items:[{productId:'P925001',quantity:1,unitType:'box'},{productId:'P925003',quantity:1,unitType:'box'}],
        } })
        okay(await close(id))
        const rows = await costs(id)
        assert.equal(rows.length,2); assert.ok(rows.every(row => row.bill_line_count === 2))
        assert.equal(new Set(rows.map(row => row.quotation_item_id)).size,2)
        assert.equal(new Set(rows.map(row => row.request_line_id)).size,2)
        const summary = (await quote(id)).internalFinancialSummary
        assert.equal(summary.available,true); assert.equal(summary.purchaseSubtotalPaise,14005); assert.equal(summary.profitPaise,2995)
        return {rows,summary}
      })
    }
    await save('state.json',state)
  }
} finally {
  await runtime.dispose()
}
if (mode === 'post') await inspect('verify-final')
