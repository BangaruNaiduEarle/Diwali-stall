// Real legacy HTTP/SQLite regression. Requires the existing verified disposable run.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const root = path.resolve(process.argv[2] ?? '')
const isolation = JSON.parse(await readFile(path.join(root, 'isolation.json'), 'utf8'))
assert.ok(path.basename(root).startsWith('diwali-release-'))
assert.ok(isolation.disposableDatabaseFile.startsWith(path.join(root, 'persist') + path.sep))
const actors = JSON.parse(await readFile(path.join(root, 'fixture-actors.json'), 'utf8'))
const actor = actors.find(row => row.id === 'rr-owner-a')
const base = 'http://localhost:8794', origin = 'http://localhost:8793'
const login = await fetch(base + '/api/admin/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: actor.email, password: actor.password }) })
assert.equal(login.status, 200)
const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], Origin: origin, 'Content-Type': 'application/json', 'X-Admin-Season-Id': 'season-2026' }
const marker = 'Legacy Retry Regression ' + crypto.randomUUID()
const body = { customer: { name: marker, mobile: '9876543210' }, items: [{ productId: 'P880001', quantity: 1, unitType: 'box' }], pricingMode: 'selling' }
const results = [], ids = new Set(), keys = []
const key = () => { const value = 'legacy-regression-' + crypto.randomUUID(); keys.push(value); return value }
const request = (operationKey, input = body, signal) => fetch(base + '/api/admin/quick-bill/checkout', { method: 'POST', headers: { ...headers, ...(operationKey == null ? {} : { 'Idempotency-Key': operationKey }) }, body: JSON.stringify(input), signal })
async function checkout(operationKey, input) { const response = await request(operationKey, input), data = await response.json(); return { status: response.status, ...data } }
const okay = result => { assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result)); ids.add(result.request.id); return result }
async function check(name, action) { try { await action(); results.push({ name, passed: true }); console.log('PASS ' + name) } catch (error) { results.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message) } }
await check('same legacy operation replays stored request, quotation and totals', async () => {
  const operationKey = key(), first = okay(await checkout(operationKey)), replay = okay(await checkout(operationKey))
  assert.equal(replay.idempotentReplay, true); assert.equal(replay.request.id, first.request.id)
  assert.deepEqual(replay.quotation, first.quotation)
  assert.equal((await checkout(operationKey, { ...body, items: [{ ...body.items[0], quantity: 2 }] })).status, 409)
})
await check('six simultaneous identical legacy submissions create one complete checkout', async () => {
  const operationKey = key(), responses = (await Promise.all(Array.from({ length: 6 }, () => checkout(operationKey)))).map(okay)
  assert.equal(new Set(responses.map(row => row.request.id)).size, 1)
  assert.equal(new Set(responses.map(row => row.quotation.id)).size, 1)
  assert.equal(responses.filter(row => row.idempotentReplay === false).length, 1)
})
await check('lost response after commit can be retried without duplicating the transaction', async () => {
  const operationKey = key(), controller = new AbortController()
  const response = await request(operationKey, body, controller.signal)
  assert.equal(response.status, 201)
  // Abort before the client reads its successful result, simulating lost delivery.
  controller.abort()
  await assert.rejects(response.json(), error => error.name === 'AbortError')
  const recovered = okay(await checkout(operationKey)); assert.equal(recovered.idempotentReplay, true)
})
await check('distinct legitimate operation keys create distinct requests', async () => {
  const first = okay(await checkout(key())), second = okay(await checkout(key()))
  assert.notEqual(first.request.id, second.request.id); assert.notEqual(first.quotation.id, second.quotation.id)
})
await check('legacy checkout rejects absent or invalid operation keys', async () => {
  assert.equal((await checkout(null)).status, 400); assert.equal((await checkout('bad key with spaces')).status, 400)
})
await check('real D1 contains exactly one complete request/quotation per legitimate operation', async () => {
  const run = promisify(execFile)
  const sql = `SELECT r.id, (SELECT count(*) FROM customer_request_items i WHERE i.request_id=r.id) AS lines,
    (SELECT count(*) FROM quotations q WHERE q.customer_request_id=r.id) AS quotes,
    (SELECT count(*) FROM quotation_items qi JOIN quotations q ON q.id=qi.quotation_id WHERE q.customer_request_id=r.id) AS quote_lines
    FROM customer_requests r WHERE customer_name='${marker}';`
  const result = await run(process.execPath, [path.resolve('server/node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'diwali-release-disposable', '--local', '--config', path.join(root, 'wrangler.toml'), '--persist-to', isolation.persist, '--command', sql, '--json'], { windowsHide: true })
  const rows = JSON.parse(result.stdout)[0].results
  assert.equal(rows.length, 5); assert.equal(ids.size, 5)
  assert.ok(rows.every(row => ids.has(row.id) && row.lines === 1 && row.quotes === 1 && row.quote_lines === 1))
})
await writeFile(path.join(root, 'fix-legacy-http-results.json'), JSON.stringify({ results, requestIds: [...ids], operationCount: keys.length }, null, 2))
if (results.some(row => !row.passed)) process.exitCode = 1
