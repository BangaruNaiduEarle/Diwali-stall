// Only disposable TEMP configuration and Python in-memory SQLite; never Wrangler/D1.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildImportSql, inputHash, parseImportOptions, prepareDisposableTarget, runImport } from '../scripts/import-catalogue-local.mjs'
import { runPython } from '../scripts/audit-location-compatibility.mjs'

const product = (id = 'P001', category = 'cat-a') => ({ id, category_slug: category, name: "Updated 'product'", pack: 'box', description: '', featured: 0,
  stock_status: 'available', active: 1, sort_order: 0, images_json: '[]', company: null })
const schema = {
  productColumns: ['id', 'category_slug', 'season_id', 'location_id'],
  categoryColumns: ['slug', 'season_id', 'location_id'],
  tables: ['products', 'categories', 'businesses', 'business_locations', 'location_seasons'],
}
const legacy = { productColumns: ['id', 'category_slug', 'season_id'], categoryColumns: ['slug', 'season_id'], tables: ['products', 'categories'] }
const scope = { formatVersion: 1, workspace: 'disposable', inputSha256: 'hash', reviewedBy: 'fixture reviewer', businessId: 'business-a', locationId: 'loc-a', seasonId: 'season-2030' }
const options = { scope, workspace: 'disposable', sourceHash: 'hash' }
const plan = records => buildImportSql({ records }, schema, options)
const PYTHON = String.raw`
import sqlite3,json,sys
p=json.load(sys.stdin); c=sqlite3.connect(':memory:'); c.execute('PRAGMA foreign_keys=ON')
loc=p.get('location',True); ownership=', season_id TEXT'+(', location_id TEXT' if loc else '')
c.execute('CREATE TABLE categories (slug TEXT PRIMARY KEY'+ownership+')')
c.execute("CREATE TABLE products (id TEXT PRIMARY KEY,category_slug TEXT NOT NULL REFERENCES categories(slug),name TEXT NOT NULL,pack TEXT,description TEXT,featured INTEGER,stock_status TEXT,active INTEGER,sort_order INTEGER,images_json TEXT,company TEXT,updated_at TEXT DEFAULT 'original'"+ownership+")")
c.executescript("CREATE TABLE businesses(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE business_locations(id TEXT PRIMARY KEY,business_id TEXT,status TEXT); CREATE TABLE business_seasons(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE location_seasons(location_id TEXT,season_id TEXT,status TEXT);")
c.executemany('INSERT INTO business_seasons VALUES (?,?)', [('season-2026','active'),('season-2030','active'),('season-2099','active')])
c.execute("INSERT INTO businesses VALUES ('business-a','active')")
c.execute("INSERT INTO business_locations VALUES ('loc-a','business-a','active')")
c.execute("INSERT INTO location_seasons VALUES ('loc-a','season-2030','active')")
for cat,season,location in [('cat-a','season-2026','loc-a'),('cat-b','season-2030','loc-b'),('cat-test','season-2099',None)]:
 c.execute('INSERT INTO categories VALUES ('+','.join(['?']*(3 if loc else 2))+')',[cat,season]+([location] if loc else []))
for id,cat,season,location in [('P001','cat-a','season-2026','loc-a'),('OTHER','cat-b','season-2030','loc-b'),('TEST-KEEP','cat-test','season-2099',None),('P900','cat-test','season-2099',None),('UNMAPPED','cat-a','season-2026',None)]:
 c.execute('INSERT INTO products(id,category_slug,name,season_id'+(',location_id' if loc else '')+') VALUES ('+','.join(['?']*(5 if loc else 4))+')',[id,cat,'original',season]+([location] if loc else []))
for table in ['family_packs','private_rates','product_purchase_rates']:
 c.execute('CREATE TABLE '+table+'(id TEXT PRIMARY KEY,product_id TEXT REFERENCES products(id),payload TEXT)')
 c.execute('INSERT INTO '+table+" VALUES ('preserve','OTHER','unrelated')")
if p.get('setup'): c.executescript(p['setup'])
c.commit()
def fingerprint():
 return {name: c.execute('SELECT * FROM "'+name+'" ORDER BY 1').fetchall() for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()}
before=fingerprint(); error=None
try:
 c.execute('BEGIN')
 for statement in p['sql'].split(';'):
  if statement.strip(): c.execute(statement)
 c.commit()
except sqlite3.Error as e:
 error=str(e); c.rollback()
print(json.dumps({'before':before,'after':fingerprint(),'error':error}))
`
function execute(sql, extra = {}) {
  const result = runPython(PYTHON, [], JSON.stringify({ sql, ...extra }))
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'import-safety-'))
  t.after(() => {
    assert.equal(path.dirname(directory), fs.realpathSync(os.tmpdir()))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

test('defaults and unsupported target overrides fail before invoking a process', () => {
  let calls = 0
  assert.throws(() => runImport([], () => calls++), /explicit absolute --workspace/)
  for (const args of [['--remote'], ['--config', 'server/wrangler.toml'], ['--persist-to', 'normal'], ['--workspace', 'relative']]) {
    assert.throws(() => parseImportOptions(args))
  }
  assert.equal(calls, 0)
  assert.throws(() => parseImportOptions(['--workspace', os.tmpdir(), '--apply']), /confirm-upsert/)
  assert.throws(() => prepareDisposableTarget(path.resolve('server')), /isolated TEMP/)
})

test('location and partially location-enabled schemas require explicit reviewed scope', () => {
  for (const current of [schema, { ...legacy, tables: [...legacy.tables, 'businesses'] }, { ...legacy, productColumns: [...legacy.productColumns, 'location_id'] }]) {
    assert.throws(() => buildImportSql({ records: [product()] }, current), /reviewed-scope/)
  }
  for (const change of [{ inputSha256: 'wrong' }, { workspace: 'other' }, { reviewedBy: '' }, { seasonId: 'season-2099' }]) {
    assert.throws(() => buildImportSql({ records: [product()] }, schema, { ...options, scope: { ...scope, ...change } }))
  }
})

test('scoped UPSERT preserves all unrelated products, children, test rows and catalogue provenance', () => {
  const sql = plan([product(), product('NEW')])
  assert.doesNotMatch(sql, /\bDELETE\b|\bREPLACE\b|BEGIN|COMMIT/)
  const result = execute(sql)
  assert.equal(result.error, null)
  for (const [table, rows] of Object.entries(result.before)) {
    if (table === 'products') {
      assert.deepEqual(result.after[table].filter(r => !['P001', 'NEW'].includes(r[0])), rows.filter(r => r[0] !== 'P001'))
    } else assert.deepEqual(result.after[table], rows, table)
  }
  const original = result.after.products.find(r => r[0] === 'P001')
  const inserted = result.after.products.find(r => r[0] === 'NEW')
  assert.equal(original.at(-2), 'season-2026')
  assert.equal(inserted.at(-2), 'season-2030')
  assert.equal(inserted.at(-1), 'loc-a')
  assert.equal(original[2], "Updated 'product'")
})

test('foreign and NULL-owned IDs and categories abort rather than silently importing', () => {
  for (const row of [product('OTHER'), product('UNMAPPED'), product('NEW', 'cat-b'), product('NEW', 'cat-test')]) {
    const result = execute(plan([row]))
    assert.match(result.error, /NOT NULL constraint failed: products.category_slug/)
    assert.deepEqual(result.after, result.before)
  }
})

test('invalid business/location/association/status fails closed in the SQL write guard', () => {
  for (const setup of ["UPDATE businesses SET status='archived'", "UPDATE business_locations SET business_id='other'",
    'DELETE FROM location_seasons', "UPDATE location_seasons SET status='archived'", "UPDATE business_seasons SET status='archived' WHERE id='season-2030'"]) {
    const result = execute(plan([product()]), { setup })
    assert.match(result.error, /NOT NULL/)
    assert.deepEqual(result.after, result.before)
  }
})

test('a later ownership conflict rolls back earlier UPSERTs in a SQLite transaction', () => {
  const result = execute(plan([product(), product('OTHER')]))
  assert.match(result.error, /NOT NULL/)
  assert.deepEqual(result.after, result.before)
})

test('protected legacy test IDs and protected season cannot be imported', () => {
  for (const id of ['TEST-KEEP', 'test-any', 'P900', 'P901', 'P902', 'P903', 'P905', 'P906']) {
    assert.throws(() => plan([product(id)]), /Protected test/)
  }
  assert.throws(() => buildImportSql({ records: [product()] }, legacy, { legacySeasonId: 'season-2099' }), /Protected season/)
})

test('non-destructive legacy import requires an explicit season and retains omitted products', () => {
  assert.throws(() => buildImportSql({ records: [product()] }, legacy), /legacy-season-id/)
  const sql = buildImportSql({ records: [product()] }, legacy, { legacySeasonId: 'season-2026' })
  const result = execute(sql, { location: false })
  assert.equal(result.error, null)
  assert.equal(result.before.products.length, result.after.products.length)
  assert.deepEqual(result.after.products.filter(r => r[0] !== 'P001'), result.before.products.filter(r => r[0] !== 'P001'))
  const retry = execute(sql + sql, { location: false })
  assert.equal(retry.error, null)
  assert.deepEqual(retry.after.products.map(r => r[0]), result.after.products.map(r => r[0]))
})

test('malformed or duplicate import fields cannot inject arbitrary SQL', () => {
  for (const changed of [{ sort_order: '0); DELETE FROM products;--' }, { featured: '1' }, { images_json: '{}' }]) {
    assert.throws(() => plan([{ ...product(), ...changed }]))
  }
  assert.throws(() => plan([product(), product()]), /unique/)
})

test('original pre-season schemas retain the product-only UPSERT shape', () => {
  const preSeason = { tables: ['products', 'categories'], productColumns: ['id', 'category_slug'], categoryColumns: ['slug'] }
  const sql = buildImportSql({ records: [product()] }, preSeason)
  assert.doesNotMatch(sql, /season_id|location_id|\bDELETE\b/)
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/)
  assert.throws(() => buildImportSql({ records: [product()] }, preSeason, { legacySeasonId: 'season-2026' }), /not supported/)
})

test('hard-linked persistence cannot redirect writes to another file', t => {
  const workspace = temp(t)
  const source = path.join(workspace, 'unrelated.txt')
  fs.writeFileSync(source, 'preserve')
  fs.mkdirSync(path.join(workspace, 'persist'))
  fs.linkSync(source, path.join(workspace, 'persist', 'linked.sqlite'))
  assert.throws(() => prepareDisposableTarget(workspace), /hard-linked/)
  assert.equal(fs.readFileSync(source, 'utf8'), 'preserve')
})

test('CLI plans by default; all intercepted commands use a standalone dummy config and explicit local persistence', t => {
  const workspace = temp(t)
  const input = path.join(workspace, 'input.json')
  const scopeFile = path.join(workspace, 'scope.json')
  const raw = JSON.stringify({ records: [product()] })
  fs.writeFileSync(input, raw)
  fs.writeFileSync(scopeFile, JSON.stringify({ ...scope, workspace, inputSha256: inputHash(raw) }))
  const calls = []
  const executor = (command, args, opts) => {
    assert.equal(command, process.execPath)
    assert.equal(opts.shell, false)
    assert.equal(opts.cwd, workspace)
    assert.ok(args.includes('--local'))
    assert.ok(!args.includes('--remote'))
    assert.equal(args[args.indexOf('--config') + 1], path.join(workspace, 'import.wrangler.toml'))
    assert.equal(args[args.indexOf('--persist-to') + 1], path.join(workspace, 'persist'))
    const config = fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8')
    assert.match(config, /11111111-1111-4111-8111-000000000004/)
    assert.doesNotMatch(config, /diwali-quotation|c2ae3b00/)
    const sql = fs.readFileSync(args[args.indexOf('--file') + 1], 'utf8')
    calls.push(sql)
    if (sql.startsWith('INSERT')) return JSON.stringify([{ success: true, results: [] }])
    const results = [...schema.tables.map(table_name => ({ table_name, column_name: null })),
      ...schema.productColumns.map(column_name => ({ table_name: 'products', column_name })),
      ...schema.categoryColumns.map(column_name => ({ table_name: 'categories', column_name }))]
    return JSON.stringify([{ success: true, results }])
  }
  const args = ['--workspace', workspace, '--input', input, '--reviewed-scope', scopeFile]
  assert.equal(runImport(args, executor).applied, false)
  assert.equal(calls.length, 1)
  assert.equal(runImport([...args, '--apply', '--confirm-upsert'], executor).applied, true)
  assert.equal(calls.length, 3)
  assert.match(calls[2], /^INSERT INTO products/)
  fs.writeFileSync(path.join(workspace, 'import.wrangler.toml'), 'untrusted config')
  assert.throws(() => runImport(args, executor), /config differs/)
  assert.equal(calls.length, 3)
})
