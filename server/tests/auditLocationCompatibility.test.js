import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  auditLocalDatabase, runPython, captureComparisonSnapshot, validateComparisonArtifacts, verifyPreMigrationSnapshot,
  compareComparisonSnapshot as compareWithBaseline,
} from '../scripts/audit-location-compatibility.mjs'

const script = fileURLToPath(new URL('../scripts/audit-location-compatibility.mjs', import.meta.url))
const migrations = fs.readdirSync(new URL('../database/migrations/', import.meta.url))
  .filter(n => /^\d+.*\.sql$/.test(n)).sort()
const SECRET = 'PRIVATE-CUSTOMER-PHONE-PASSWORD-DO-NOT-PRINT'

// Small, disposable SQLite fixture. No Wrangler, existing DB, or migration execution.
const definitions = {
  business_seasons: 'id TEXT PRIMARY KEY, code TEXT UNIQUE, status TEXT',
  platform_settings: 'singleton_id INTEGER PRIMARY KEY, public_catalogue_season_id TEXT REFERENCES business_seasons(id)',
  admin_users: 'id TEXT PRIMARY KEY, email TEXT UNIQUE, role TEXT, disabled_at TEXT, password_hash TEXT',
  season_members: 'season_id TEXT REFERENCES business_seasons(id), admin_user_id TEXT REFERENCES admin_users(id), role TEXT, disabled_at TEXT, PRIMARY KEY(season_id, admin_user_id)',
  categories: 'slug TEXT PRIMARY KEY, season_id TEXT REFERENCES business_seasons(id)',
  products: 'id TEXT PRIMARY KEY, category_slug TEXT REFERENCES categories(slug), season_id TEXT REFERENCES business_seasons(id)',
  family_packs: 'id TEXT PRIMARY KEY, slug TEXT UNIQUE, season_id TEXT REFERENCES business_seasons(id)',
  private_rates: 'id INTEGER PRIMARY KEY, product_id TEXT REFERENCES products(id), season_id TEXT REFERENCES business_seasons(id), effective_to TEXT',
  product_purchase_rates: 'id INTEGER PRIMARY KEY, product_id TEXT REFERENCES products(id), season_id TEXT REFERENCES business_seasons(id), effective_to TEXT',
  customer_requests: 'id TEXT PRIMARY KEY, season_id TEXT REFERENCES business_seasons(id), public_reference TEXT, customer_phone TEXT',
  quotations: 'id TEXT PRIMARY KEY, customer_request_id TEXT REFERENCES customer_requests(id), season_id TEXT REFERENCES business_seasons(id), status TEXT',
  customer_request_items: 'id INTEGER PRIMARY KEY, request_id TEXT REFERENCES customer_requests(id), product_id TEXT REFERENCES products(id), family_pack_id TEXT REFERENCES family_packs(id), line_number INTEGER, snapshot TEXT, UNIQUE(request_id,line_number)',
  quotation_items: 'id INTEGER PRIMARY KEY, quotation_id TEXT REFERENCES quotations(id), product_id TEXT REFERENCES products(id), line_number INTEGER, snapshot TEXT, UNIQUE(quotation_id,line_number)',
  family_pack_items: 'id INTEGER PRIMARY KEY, family_pack_id TEXT REFERENCES family_packs(id), product_id TEXT REFERENCES products(id), quantity INTEGER',
  family_pack_images: 'id INTEGER PRIMARY KEY, family_pack_id TEXT REFERENCES family_packs(id), url TEXT',
  platform_admins: 'admin_user_id TEXT PRIMARY KEY REFERENCES admin_users(id)',
  admin_sessions: 'id TEXT PRIMARY KEY, admin_user_id TEXT REFERENCES admin_users(id)',
  admin_login_attempts: 'id INTEGER PRIMARY KEY',
  admin_owner_bootstrap: 'singleton_id INTEGER PRIMARY KEY, owner_user_id TEXT',
  d1_migrations: "id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, applied_at TEXT DEFAULT 'original timestamp'",
}

function pythonSql(database, statements) {
  const result = runPython(`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
for sql,params in json.loads(sys.stdin.read()): c.execute(sql,params)
c.commit()
c.close()`, [database], JSON.stringify(statements))
  assert.equal(result.status, 0, result.stderr)
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diwali-location-audit-'))
  t.after(() => {
    // Delete only the exact disposable directory created above.
    assert.equal(path.dirname(directory), fs.realpathSync(os.tmpdir()))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const database = path.join(directory, 'fixture with spaces.sqlite')
  const sql = Object.entries(definitions).map(([name, columns]) => [`CREATE TABLE ${name} (${columns})`, []])
  for (const [table, name, columns, where] of [
    ['private_rates', 'idx_private_rates_one_current', 'product_id', 'effective_to IS NULL'],
    ['product_purchase_rates', 'idx_product_purchase_rates_one_current', 'product_id', 'effective_to IS NULL'],
    ['quotations', 'idx_quotations_one_active_per_request', 'customer_request_id', "customer_request_id IS NOT NULL AND status != 'void'"],
    ['customer_requests', 'idx_customer_requests_public_reference', 'public_reference', 'public_reference IS NOT NULL'],
  ]) sql.push([`CREATE UNIQUE INDEX ${name} ON ${table} (${columns}) WHERE ${where}`, []])
  for (const name of migrations) sql.push(['INSERT INTO d1_migrations (name) VALUES (?)', [name]])
  for (const [n, year] of [[1, '2026'], [2, '2099']]) {
    const season = `season-${year}`
    sql.push(
      ['INSERT INTO business_seasons VALUES (?,?,?)', [season, year, 'active']],
      ['INSERT INTO admin_users VALUES (?,?,?,?,?)', [`u${n}`, `${SECRET}-${n}`, 'owner', null, SECRET]],
      ['INSERT INTO season_members VALUES (?,?,?,?)', [season, `u${n}`, 'owner', null]],
      ['INSERT INTO categories VALUES (?,?)', [`c${n}`, season]],
      ['INSERT INTO products VALUES (?,?,?)', [`P00${n}`, `c${n}`, season]],
      ['INSERT INTO family_packs VALUES (?,?,?)', [`FP00${n}`, `pack-${n}`, season]],
      ['INSERT INTO private_rates VALUES (?,?,?,?)', [n, `P00${n}`, season, null]],
      ['INSERT INTO product_purchase_rates VALUES (?,?,?,?)', [n, `P00${n}`, season, null]],
      ['INSERT INTO customer_requests VALUES (?,?,?,?)', [`r${n}`, season, `DWL-${n}`, SECRET]],
      ['INSERT INTO quotations VALUES (?,?,?,?)', [`q${n}`, `r${n}`, season, 'draft']],
      ['INSERT INTO customer_request_items VALUES (?,?,?,?,?,?)', [n, `r${n}`, `P00${n}`, `FP00${n}`, 1, SECRET]],
      ['INSERT INTO quotation_items VALUES (?,?,?,?,?)', [n, `q${n}`, `P00${n}`, 1, SECRET]],
      ['INSERT INTO family_pack_items VALUES (?,?,?,?)', [n, `FP00${n}`, `P00${n}`, 1]],
      ['INSERT INTO family_pack_images VALUES (?,?,?)', [n, `FP00${n}`, SECRET]],
      ['INSERT INTO platform_admins VALUES (?)', [`u${n}`]],
    )
  }
  sql.push(['INSERT INTO platform_settings VALUES (1,?)', ['season-2026']])
  pythonSql(database, sql)
  return { database, directory }
}

const fileHash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

test('explicit local path required; invalid CLI/path cannot create a database', t => {
  const { directory } = fixture(t)
  const absent = path.join(directory, 'absent.sqlite')
  for (const value of [undefined, '', 'https://example.com/db', 'file:db.sqlite', '\\\\host\\share\\db', directory, absent]) {
    assert.throws(() => auditLocalDatabase(value))
  }
  assert.equal(fs.existsSync(absent), false)
  for (const args of [[], ['--remote'], ['--database', absent], ['--database', absent, '--remote']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.doesNotMatch(result.stderr, /Traceback|PRIVATE-CUSTOMER/)
  }
})

test('reports schema/migrations/counts and stable separate complete hashes without writes or secrets', t => {
  const { database, directory } = fixture(t)
  const before = fileHash(database)
  const mtime = fs.statSync(database).mtimeMs
  const names = fs.readdirSync(directory)
  const report = auditLocalDatabase(database)
  assert.equal(report.compatible, true)
  assert.deepEqual(report.violations, [])
  assert.deepEqual(report.migrations.applied, migrations)
  assert.equal(report.counts.products, 2)
  assert.equal(report.schema.tables.products.foreignKeys.length, 2)
  for (const season of ['season-2026', 'season-2099']) {
    assert.equal(report.seasons[season].complete, true)
    for (const table of ['customer_request_items', 'quotation_items', 'family_pack_items', 'family_pack_images', 'season_members', 'admin_users', 'platform_admins']) {
      assert.equal(report.seasons[season].tables[table].count, 1)
    }
  }
  assert.notEqual(report.seasons['season-2026'].sha256, report.seasons['season-2099'].sha256)
  assert.deepEqual(auditLocalDatabase(database), report)
  const cli = spawnSync(process.execPath, [script, '--database', database], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.deepEqual(JSON.parse(cli.stdout), report)
  assert.ok(!cli.stdout.includes(SECRET))
  assert.equal(fileHash(database), before)
  assert.equal(fs.statSync(database).mtimeMs, mtime)
  assert.deepEqual(fs.readdirSync(directory), names)
})

test('all child types, membership and linked identity changes affect only their owning season', t => {
  const { database } = fixture(t)
  let previous = auditLocalDatabase(database)
  for (const sql of [
    "UPDATE customer_request_items SET snapshot='changed' WHERE id=2",
    "UPDATE quotation_items SET snapshot='changed' WHERE id=2",
    'UPDATE family_pack_items SET quantity=2 WHERE id=2',
    "UPDATE family_pack_images SET url='changed' WHERE id=2",
    "UPDATE season_members SET disabled_at='now' WHERE season_id='season-2099'",
    "UPDATE admin_users SET password_hash='changed' WHERE id='u2'",
    "DELETE FROM platform_admins WHERE admin_user_id='u2'",
  ]) {
    pythonSql(database, [[sql, []]])
    const next = auditLocalDatabase(database)
    assert.notEqual(next.seasons['season-2099'].sha256, previous.seasons['season-2099'].sha256, sql)
    assert.equal(next.seasons['season-2026'].sha256, previous.seasons['season-2026'].sha256, sql)
    previous = next
  }
})

test('reports orphans, cross-season links, missing ownership and migrations without row values', t => {
  const { database } = fixture(t)
  pythonSql(database, [
    ['UPDATE products SET category_slug=? WHERE id=?', ['c1', 'P002']],
    ['UPDATE customer_request_items SET product_id=? WHERE id=2', [SECRET]],
    ['UPDATE private_rates SET season_id=NULL WHERE id=2', []],
    ['DELETE FROM d1_migrations WHERE name=?', [migrations[0]]],
    ['INSERT INTO d1_migrations (name) VALUES (?)', [SECRET]],
  ])
  const report = auditLocalDatabase(database)
  for (const code of ['foreign_key_violation', 'missing_relationship', 'cross_season_relationship', 'missing_season_ownership', 'missing_migration', 'unknown_applied_migrations']) {
    assert.ok(report.violations.some(v => v.code === code), code)
  }
  assert.equal(report.compatible, false)
  assert.ok(!JSON.stringify(report).includes(SECRET))
  const cli = spawnSync(process.execPath, [script, '--database', database], { encoding: 'utf8' })
  assert.equal(cli.status, 2)
})

test('older/malformed schema produces an incomplete audit; invalid SQLite errors are sanitized', t => {
  const { database, directory } = fixture(t)
  pythonSql(database, [['DROP TABLE family_pack_images', []], ['DROP INDEX idx_private_rates_one_current', []]])
  const report = auditLocalDatabase(database)
  assert.equal(report.compatible, false)
  assert.equal(report.seasons['season-2099'].complete, false)
  assert.ok(report.violations.some(v => v.code === 'missing_table'))
  assert.ok(report.violations.some(v => v.code === 'missing_partial_unique_index'))
  const invalid = path.join(directory, 'invalid.sqlite')
  fs.writeFileSync(invalid, SECRET)
  const cli = spawnSync(process.execPath, [script, '--database', invalid], { encoding: 'utf8' })
  assert.equal(cli.status, 1)
  assert.ok(!`${cli.stdout}${cli.stderr}`.includes(SECRET))
  assert.doesNotMatch(cli.stderr, /Traceback/)
})

test('includes committed WAL rows without changing the main file or WAL', async t => {
  const { database, directory } = snapshotFixture(t)
  const originalSnapshot = captureComparisonSnapshot(database)
  const baseline = fixtureBaselines.get(database)
  const initial = verifyPreMigrationSnapshot(database, originalSnapshot, baseline)
  assert.equal(initial.compatible, true)
  const interpreter = runPython('import sys; print(sys.executable)').stdout.trim()
  const writer = spawn(interpreter, ['-c', `import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute('PRAGMA journal_mode=WAL')
c.execute("UPDATE customer_requests SET customer_phone='committed WAL change' WHERE id='r2'")
c.commit()
print('ready',flush=True)
sys.stdin.read()
c.close()`, database], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const closed = once(writer, 'close')
  try {
    const ready = await Promise.race([
      once(writer.stdout, 'data'),
      closed.then(() => { throw new Error('Fixture WAL writer exited before ready') }),
    ])
    assert.equal(ready[0].toString().trim(), 'ready')
    const files = fs.readdirSync(directory)
    const before = [fileHash(database), fileHash(`${database}-wal`)]
    const report = verifyPreMigrationSnapshot(database, originalSnapshot, baseline)
    const walSnapshot = captureComparisonSnapshot(database)
    assert.equal(report.compatible, false)
    assert.ok(report.violations.some(v => v.code === 'original_rows_changed' && v.subject === 'customer_requests'))
    assert.notEqual(report.seasons['season-2099'].sha256, initial.seasons['season-2099'].sha256)
    assert.equal(report.seasons['season-2026'].sha256, initial.seasons['season-2026'].sha256)
    assert.notEqual(walSnapshot.tables.customer_requests.sha256, originalSnapshot.tables.customer_requests.sha256)
    assert.deepEqual([fileHash(database), fileHash(`${database}-wal`)], before)
    assert.deepEqual(fs.readdirSync(directory), files)
  } finally {
    writer.stdin.end()
    await closed
  }
})

// Models only the comparison contract on disposable data. This is not migration
// 0020 and does not rehearse its implementation or trigger behavior.
const OWNED_TABLES = ['categories', 'products', 'family_packs', 'private_rates',
  'product_purchase_rates', 'customer_requests', 'quotations']
const FOUNDATION_NAME = '0020_business_location_foundation.sql'
const fixtureBaselines = new Map()

function compareComparisonSnapshot(database, snapshot, policy = null) {
  return compareWithBaseline(database, snapshot, policy, fixtureBaselines.get(database))
}

function modelPostFoundationFixture(database) {
  const statements = [
    ["CREATE TABLE businesses (id TEXT PRIMARY KEY, business_type TEXT, status TEXT)", []],
    ["CREATE TABLE business_locations (id TEXT PRIMARY KEY, business_id TEXT REFERENCES businesses(id), status TEXT)", []],
    ["CREATE TABLE location_seasons (location_id TEXT REFERENCES business_locations(id), season_id TEXT REFERENCES business_seasons(id), operating_year INTEGER, status TEXT, PRIMARY KEY(location_id,season_id))", []],
    ["CREATE TABLE location_members (location_id TEXT, season_id TEXT, admin_user_id TEXT, role TEXT, disabled_at TEXT, PRIMARY KEY(location_id,season_id,admin_user_id), FOREIGN KEY(location_id,season_id) REFERENCES location_seasons(location_id,season_id), FOREIGN KEY(season_id,admin_user_id) REFERENCES season_members(season_id,admin_user_id))", []],
    ["INSERT INTO businesses VALUES ('business-diwali','seasonal','active')", []],
    ["INSERT INTO business_locations VALUES ('location-diwali-2026','business-diwali','active')", []],
    ["INSERT INTO location_seasons VALUES ('location-diwali-2026','season-2026',2026,'active')", []],
    ["INSERT INTO location_members SELECT 'location-diwali-2026',season_id,admin_user_id,role,disabled_at FROM season_members WHERE season_id='season-2026'", []],
  ]
  for (const table of OWNED_TABLES) statements.push(
    [`ALTER TABLE ${table} ADD COLUMN location_id TEXT REFERENCES business_locations(id)`, []],
    [`UPDATE ${table} SET location_id='location-diwali-2026' WHERE season_id='season-2026'`, []],
  )
  statements.push(['INSERT INTO d1_migrations (name) VALUES (?)', [FOUNDATION_NAME]])
  pythonSql(database, statements)
}

// Policy represents a reviewed, fixed test schema. Production tooling must never
// derive approval automatically from the database it is supposed to validate.
function reviewedFixturePolicy(database) {
  const result = runPython(`import sqlite3,sys,json,hashlib,pathlib
c=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True)
rows=c.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()
rows=[r for r in rows if not any(n.lower().startswith('_cf_') for n in (r[1],r[2]))]
print(hashlib.sha256(json.dumps(rows,ensure_ascii=True,separators=(',',':')).encode()).hexdigest())
c.close()`, [database])
  assert.equal(result.status, 0, result.stderr)
  return { formatVersion: 2, schemaScope: 'application', migration: FOUNDATION_NAME, schemaSha256: result.stdout.trim() }
}

function snapshotFixture(t) {
  const files = fixture(t)
  pythonSql(files.database, [
    ['CREATE TABLE extra_global (value, binary BLOB)', []],
    ["INSERT INTO extra_global VALUES (NULL, X'00ff'), (1,NULL), ('1',NULL), (?,NULL), (?,NULL)", [SECRET, SECRET]],
    ['CREATE TABLE _cf_METADATA (key TEXT PRIMARY KEY, value TEXT)', []],
    ['INSERT INTO _cf_METADATA VALUES (?,?)', ['fixture', SECRET]],
    ['INSERT INTO products VALUES (?,?,?)', ['P003', 'c2', 'season-2099']],
    ['INSERT INTO admin_sessions VALUES (?,?)', [SECRET, 'u1']],
    ['INSERT INTO admin_login_attempts VALUES (1)', []],
    ['INSERT INTO admin_owner_bootstrap VALUES (1,?)', ['u1']],
    ['CREATE INDEX idx_fixture_product_season ON products(season_id)', []],
    ['CREATE VIEW fixture_catalogue AS SELECT id FROM products', []],
    ['CREATE TRIGGER fixture_products_update AFTER UPDATE ON products BEGIN SELECT 1; END', []],
    // The repository can contain the pending migration; the fixture is pre-0020.
    ['DELETE FROM d1_migrations WHERE name=?', [FOUNDATION_NAME]],
  ])
  const baseline = auditLocalDatabase(files.database)
  baseline.migrations.expected = baseline.migrations.expected.filter(n => n !== FOUNDATION_NAME)
  baseline.violations = baseline.violations.filter(v => v.code !== 'missing_migration' || v.subject !== FOUNDATION_NAME)
  baseline.compatible = baseline.violations.length === 0
  fixtureBaselines.set(files.database, baseline)
  t.after(() => fixtureBaselines.delete(files.database))
  return files
}

// Reproduce the historical v1 artifact format on disposable data. This helper
// never opens the actual saved database, rewrites artifacts, or approves policy.
function legacyFixtureArtifacts(database) {
  const result = runPython(`import sqlite3,sys,json,hashlib,pathlib,collections
def digest(v): return hashlib.sha256(json.dumps(v,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
def quote(n): return '"'+n.replace('"','""')+'"'
def typed(v):
 if v is None: return ['null']
 if isinstance(v,bytes): return ['blob',v.hex()]
 if isinstance(v,int): return ['integer',str(v)]
 if isinstance(v,float): return ['real',v.hex()]
 return ['text',v]
s=json.loads(sys.stdin.read())
c=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True)
master=c.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()
for _,t,_,_ in (r for r in master if r[0]=='table' and r[1] not in s['tables']):
 cols=[{'name':r[1],'type':r[2],'notNull':bool(r[3]),'defaultSha256':digest(r[4]),'primaryKeyPosition':r[5],'hidden':r[6]} for r in c.execute('PRAGMA table_xinfo('+quote(t)+')')]
 groups=collections.defaultdict(list)
 for r in c.execute('PRAGMA foreign_key_list('+quote(t)+')'): groups[r[0]].append(list(r[1:]))
 names=[col['name'] for col in cols]
 rows=c.execute('SELECT '+','.join(quote(n) for n in names)+' FROM '+quote(t)).fetchall()
 encoded=sorted(json.dumps([typed(v) for v in row],ensure_ascii=True,separators=(',',':')) for row in rows)
 s['tables'][t]={'columns':cols,'foreignKeys':sorted([sorted(g) for g in groups.values()]),'count':len(rows),'sha256':digest([names,encoded])}
s['schemaObjects']=[{'type':r[0],'name':r[1],'table':r[2],'sha256':digest(r[3])} for r in master]
s['schemaSha256']=digest(master)
s['formatVersion']=1
del s['schemaScope']
del s['sha256']
s['sha256']=digest(s)
print(json.dumps(s))
c.close()`, [database], JSON.stringify(captureComparisonSnapshot(database)))
  assert.equal(result.status, 0, result.stderr)
  const snapshot = JSON.parse(result.stdout)
  const baseline = structuredClone(fixtureBaselines.get(database))
  baseline.formatVersion = 1
  delete baseline.schemaScope
  baseline.schema.sha256 = snapshot.schemaSha256
  assert.deepEqual(validateComparisonArtifacts(snapshot, baseline).violations, [])
  return { snapshot, baseline }
}

test('application snapshots cover retained tables, globals, blobs and duplicates without writes', t => {
  const { database, directory } = snapshotFixture(t)
  const before = fileHash(database)
  const files = fs.readdirSync(directory)
  const snapshot = captureComparisonSnapshot(database)
  assert.equal(snapshot.kind, 'diwali-pre-0020-comparison-snapshot')
  assert.equal(snapshot.formatVersion, 2)
  assert.equal(snapshot.schemaScope, 'application')
  assert.equal(snapshot.tables._cf_METADATA, undefined)
  assert.ok(snapshot.schemaObjects.every(o => !/^_cf_/i.test(o.name) && !/^_cf_/i.test(o.table)))
  assert.equal(snapshot.tables.products.count, 3)
  for (const table of ['extra_global', 'platform_settings', 'admin_sessions',
    'admin_login_attempts', 'admin_owner_bootstrap', 'sqlite_sequence', 'season_members', 'customer_request_items']) {
    assert.ok(snapshot.tables[table], table)
    assert.match(snapshot.tables[table].sha256, /^[0-9a-f]{64}$/)
  }
  assert.equal(snapshot.tables.extra_global.count, 5)
  assert.deepEqual(captureComparisonSnapshot(database), snapshot)
  const cli = spawnSync(process.execPath, [script, '--database', database, '--snapshot'], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.deepEqual(JSON.parse(cli.stdout), snapshot)
  assert.ok(!cli.stdout.includes(SECRET))
  assert.ok(!cli.stdout.includes('original timestamp')) // SQL default is hashed too.
  assert.equal(fileHash(database), before)
  assert.deepEqual(fs.readdirSync(directory), files)
  // Physical row ordering does not change the deterministic digest; duplicates count.
  pythonSql(database, [
    ['DELETE FROM extra_global', []],
    ["INSERT INTO extra_global VALUES (?,NULL), (?,NULL), ('1',NULL), (1,NULL), (NULL,X'00ff')", [SECRET, SECRET]],
  ])
  assert.deepEqual(captureComparisonSnapshot(database), snapshot)
})

test('comparison allows only reviewed additive schema, exact ownership, and one migration entry', t => {
  const { database, directory } = snapshotFixture(t)
  const snapshot = captureComparisonSnapshot(database)
  const serialized = JSON.stringify(snapshot)
  modelPostFoundationFixture(database)
  const policy = reviewedFixturePolicy(database)
  assert.ok(compareComparisonSnapshot(database, snapshot).violations.some(v => v.code === 'reviewed_schema_policy_required'))
  const before = fileHash(database)
  const result = compareComparisonSnapshot(database, snapshot, policy)
  assert.equal(result.compatible, true, JSON.stringify(result.violations))
  assert.deepEqual(result.violations, [])
  assert.equal(result.tables.products.sha256, snapshot.tables.products.sha256)
  assert.equal(result.tables.d1_migrations.sha256, snapshot.tables.d1_migrations.sha256)
  assert.equal(result.ownership.products.mapped2026, 1)
  assert.equal(result.ownership.products.expected2026, 1)
  for (const season of ['season-2026', 'season-2099']) {
    assert.equal(result.seasons[season].sha256, fixtureBaselines.get(database).seasons[season].sha256)
  }
  assert.ok(!JSON.stringify(result).includes(SECRET))
  assert.equal(fileHash(database), before)
  assert.equal(JSON.stringify(snapshot), serialized)
  const input = path.join(directory, 'comparison.json')
  const approval = path.join(directory, 'reviewed-policy.json')
  const baselineFile = path.join(directory, 'fixture-baseline.json')
  fs.writeFileSync(input, serialized)
  fs.writeFileSync(approval, JSON.stringify(policy))
  fs.writeFileSync(baselineFile, JSON.stringify(fixtureBaselines.get(database)))
  const cli = spawnSync(process.execPath, [script, '--database', database, '--compare', input,
    '--schema-policy', approval, '--baseline', baselineFile], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.deepEqual(JSON.parse(cli.stdout), result)
  assert.equal(fs.readFileSync(input, 'utf8'), serialized)
  const denied = spawnSync(process.execPath, [script, '--database', database, '--compare', input,
    '--baseline', baselineFile], { encoding: 'utf8' })
  assert.equal(denied.status, 2)
  assert.ok(JSON.parse(denied.stdout).violations.some(v => v.code === 'reviewed_schema_policy_required'))
  assert.throws(() => captureComparisonSnapshot(database)) // Cannot silently re-baseline after 0020.
})

test('comparison catches original global, child, unowned and 2099 edits plus migration-history tampering', t => {
  const { database } = snapshotFixture(t)
  const snapshot = captureComparisonSnapshot(database)
  modelPostFoundationFixture(database)
  const policy = reviewedFixturePolicy(database)
  pythonSql(database, [
    ["UPDATE platform_settings SET public_catalogue_season_id='season-2099'", []],
    ["UPDATE products SET category_slug='c1' WHERE id='P003'", []],
    ["UPDATE customer_request_items SET snapshot='changed' WHERE id=2", []],
    ['DELETE FROM admin_sessions', []],
    ['INSERT INTO admin_login_attempts VALUES (2)', []],
    ["UPDATE _cf_METADATA SET value='changed'", []],
    ['DELETE FROM extra_global WHERE rowid=5', []],
    ["UPDATE season_members SET role='admin' WHERE season_id='season-2099'", []],
    ["UPDATE d1_migrations SET applied_at='changed' WHERE id=1", []],
    ['INSERT INTO d1_migrations (name) VALUES (?)', [SECRET]],
  ])
  const report = compareComparisonSnapshot(database, snapshot, policy)
  for (const table of ['platform_settings', 'products', 'customer_request_items', 'admin_sessions',
    'admin_login_attempts', 'extra_global', 'season_members', 'd1_migrations', 'sqlite_sequence']) {
    assert.ok(report.violations.some(v => v.code === 'original_rows_changed' && v.subject === table), table)
  }
  assert.equal(report.compatible, false)
  assert.ok(!JSON.stringify(report).includes(SECRET))
})

test('comparison fails on absent, renumbered or duplicate 0020 history entries', t => {
  const { database } = snapshotFixture(t)
  const snapshot = captureComparisonSnapshot(database)
  modelPostFoundationFixture(database)
  const policy = reviewedFixturePolicy(database)
  pythonSql(database, [['DELETE FROM d1_migrations WHERE name=?', [FOUNDATION_NAME]]])
  assert.ok(compareComparisonSnapshot(database, snapshot, policy).violations
    .some(v => v.code === 'expected_migration_entry_missing_or_duplicate'))
  pythonSql(database, [['INSERT INTO d1_migrations (name) VALUES (?)', [FOUNDATION_NAME]]])
  assert.ok(compareComparisonSnapshot(database, snapshot, policy).violations
    .some(v => v.code === 'unexpected_migration_id'))
  pythonSql(database, [['INSERT INTO d1_migrations (name) VALUES (?)', [FOUNDATION_NAME]]])
  assert.ok(compareComparisonSnapshot(database, snapshot, policy).violations
    .some(v => v.code === 'expected_migration_entry_missing_or_duplicate'))
})

test('comparison rejects misownership, rate divergence, membership changes and unexpected schema', t => {
  const { database } = snapshotFixture(t)
  const snapshot = captureComparisonSnapshot(database)
  modelPostFoundationFixture(database)
  const policy = reviewedFixturePolicy(database)
  pythonSql(database, [
    ["UPDATE products SET location_id='location-diwali-2026' WHERE id='P002'", []],
    ["UPDATE private_rates SET location_id=NULL WHERE id=1", []],
    ["UPDATE product_purchase_rates SET location_id=NULL WHERE id=1", []],
    ["UPDATE quotations SET location_id=NULL WHERE id='q1'", []],
    ["INSERT INTO location_seasons VALUES ('location-diwali-2026','season-2099',2099,'active')", []],
    ["UPDATE location_members SET role='admin'", []],
    ['ALTER TABLE platform_settings ADD COLUMN unrelated TEXT', []],
    ['DROP INDEX idx_private_rates_one_current', []],
    ['CREATE TABLE unexpected (value TEXT)', []],
    ["CREATE TRIGGER unwanted AFTER UPDATE ON products BEGIN SELECT 1; END", []],
  ])
  const report = compareComparisonSnapshot(database, snapshot, policy)
  for (const code of ['unapproved_schema', 'unexpected_table', 'original_column_schema_changed',
    'original_schema_object_changed', 'unexpected_location_ownership', 'rate_product_location_mismatch',
    'quotation_request_scope_mismatch', 'unexpected_foundation_rows', 'unexpected_location_memberships']) {
    assert.ok(report.violations.some(v => v.code === code), code)
  }
  assert.equal(report.compatible, false)
})

test('comparison rejects corrupt snapshots and malformed policies; preserves original saved baseline bytes', t => {
  const { database, directory } = snapshotFixture(t)
  const baseline = fileURLToPath(new URL('../reports/location-compatibility-baseline-2026-11-01.json', import.meta.url))
  const bytes = fs.readFileSync(baseline)
  assert.equal(fileHash(baseline), '089fe9b084600cb39e05965624326a6765abc03bdf5873271c4f34cb96f89ced')
  const snapshot = captureComparisonSnapshot(database)
  const corrupt = structuredClone(snapshot)
  corrupt.tables.products.count++
  assert.ok(compareComparisonSnapshot(database, corrupt).violations.some(v => v.code === 'invalid_comparison_snapshot'))
  assert.ok(compareComparisonSnapshot(database, snapshot, { formatVersion: 1 }).violations.some(v => v.code === 'invalid_schema_policy'))
  const invalid = path.join(directory, 'bad.json')
  fs.writeFileSync(invalid, SECRET)
  const cli = spawnSync(process.execPath, [script, '--database', database, '--compare', invalid], { encoding: 'utf8' })
  assert.equal(cli.status, 1)
  assert.ok(!`${cli.stdout}${cli.stderr}`.includes(SECRET))
  assert.deepEqual(fs.readFileSync(baseline), bytes)
})

test('original baseline catches pre-snapshot season drift despite unchanged companion hashes', t => {
  const { database } = snapshotFixture(t)
  pythonSql(database, [["UPDATE quotation_items SET snapshot='pre-snapshot drift' WHERE id=2", []]])
  const laterSnapshot = captureComparisonSnapshot(database)
  modelPostFoundationFixture(database)
  const report = compareComparisonSnapshot(database, laterSnapshot, reviewedFixturePolicy(database))
  assert.ok(!report.violations.some(v => v.code === 'original_rows_changed'))
  assert.ok(report.violations.some(v => v.code === 'baseline_season_rows_changed' && v.subject === 'season-2099.quotation_items'))
  assert.ok(report.violations.some(v => v.code === 'baseline_season_fingerprint_changed' && v.subject === 'season-2099'))
  assert.equal(report.compatible, false)
})

test('ownership compares approved counts and rejects copied 2099 location memberships', t => {
  const { database } = snapshotFixture(t)
  const snapshot = captureComparisonSnapshot(database)
  modelPostFoundationFixture(database)
  const policy = reviewedFixturePolicy(database)
  pythonSql(database, [
    ["UPDATE products SET location_id=NULL WHERE id='P001'", []],
    ["INSERT INTO location_members SELECT 'location-diwali-2026',season_id,admin_user_id,role,disabled_at FROM season_members WHERE season_id='season-2099'", []],
  ])
  const report = compareComparisonSnapshot(database, snapshot, policy)
  for (const code of ['unexpected_2026_ownership_count', 'unexpected_location_memberships', 'unexpected_2026_membership_count']) {
    assert.ok(report.violations.some(v => v.code === code), code)
  }
  assert.equal(report.ownership.products.expected2026, 1)
  assert.equal(report.ownership.products.mapped2026, 0)
})

test('missing or incompatible baseline fails closed with clear artifact reasons', t => {
  const { database } = snapshotFixture(t)
  const snapshot = captureComparisonSnapshot(database)
  modelPostFoundationFixture(database)
  assert.ok(compareWithBaseline(database, snapshot).violations.some(v => v.code === 'compatibility_baseline_required'))
  const wrongBaseline = structuredClone(fixtureBaselines.get(database))
  wrongBaseline.schema.sha256 = '0'.repeat(64)
  wrongBaseline.counts.products++
  const report = compareWithBaseline(database, snapshot, reviewedFixturePolicy(database), wrongBaseline)
  assert.equal(report.compatible, false)
  assert.ok(report.violations.some(v => v.code === 'artifact_schema_mismatch'))
  assert.ok(report.violations.some(v => v.code === 'artifact_record_count_mismatch'))
})

test('saved baseline and uploaded companion snapshot validate together without opening a database', () => {
  const artifactPaths = [
    fileURLToPath(new URL('../reports/location-compatibility-baseline-2026-11-01.json', import.meta.url)),
    fileURLToPath(new URL('../reports/location-comparison-snapshot-pre-0020-2026-11-01.json', import.meta.url)),
  ]
  const before = artifactPaths.map(file => fs.readFileSync(file))
  assert.deepEqual(artifactPaths.map(fileHash), [
    '089fe9b084600cb39e05965624326a6765abc03bdf5873271c4f34cb96f89ced',
    'a3035dfffb7920d5fe55eb13107bc0aa3cd44a4a465bb01cbfa0f2527445c54b',
  ])
  const [baseline, snapshot] = before.map(bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')))
  const result = validateComparisonArtifacts(snapshot, baseline)
  assert.deepEqual(result, { readOnly: true, compatible: true, violations: [] })
  assert.equal(Object.keys(snapshot.tables).length, 22)
  for (const [table, count] of Object.entries({categories:14,products:162,family_packs:6,
    private_rates:161,product_purchase_rates:180,customer_requests:67,quotations:66,season_members:3})) {
    assert.equal(baseline.seasons['season-2026'].tables[table].count, count, table)
  }
  for (const [i, file] of artifactPaths.entries()) assert.deepEqual(fs.readFileSync(file), before[i])
})

test('legacy snapshots ignore platform-only schema/data changes before and after 0020', t => {
  const { database } = snapshotFixture(t)
  pythonSql(database, [
    ['CREATE TABLE _Cf_Other (key TEXT PRIMARY KEY, value TEXT)', []],
    ['CREATE INDEX neutral_platform_index ON _Cf_Other(value)', []],
    ['CREATE TRIGGER neutral_platform_trigger AFTER UPDATE ON _Cf_Other BEGIN SELECT 1; END', []],
    ['CREATE VIEW _cF_View AS SELECT id FROM products', []],
    ['CREATE INDEX _CF_NamedIndex ON products(id)', []],
  ])
  const scopedSnapshot = captureComparisonSnapshot(database)
  const audit = auditLocalDatabase(database)
  const { snapshot, baseline } = legacyFixtureArtifacts(database)
  assert.ok(snapshot.tables._cf_METADATA)
  assert.ok(snapshot.schemaObjects.some(o => o.name === 'neutral_platform_index'))
  const serialized = JSON.stringify(snapshot)
  const corrupt = structuredClone(snapshot)
  corrupt.tables._cf_METADATA.count++
  // Ignoring DB platform data must never ignore corruption of the saved seal.
  assert.ok(verifyPreMigrationSnapshot(database, corrupt, baseline).violations
    .some(v => v.code === 'invalid_comparison_snapshot'))
  pythonSql(database, [
    ["UPDATE _cf_METADATA SET value='platform-only change'", []],
    ['ALTER TABLE _cf_METADATA ADD COLUMN platform_version TEXT', []],
    ['DROP TABLE _Cf_Other', []],
    ['DROP VIEW _cF_View', []],
    ['DROP INDEX _CF_NamedIndex', []],
    ['CREATE TABLE _CF_New (value TEXT)', []],
    ['CREATE INDEX neutral_new_index ON _CF_New(value)', []],
    ['CREATE TRIGGER neutral_new_trigger AFTER INSERT ON _CF_New BEGIN SELECT 1; END', []],
  ])
  assert.deepEqual(captureComparisonSnapshot(database), scopedSnapshot)
  assert.deepEqual(auditLocalDatabase(database), audit)
  const before = fileHash(database)
  const pre = verifyPreMigrationSnapshot(database, snapshot, baseline)
  assert.equal(pre.compatible, true, JSON.stringify(pre.violations))
  assert.equal(fileHash(database), before)
  assert.equal(pre.schemaScope, 'application')
  assert.equal(pre.schemaSha256, scopedSnapshot.schemaSha256)
  assert.equal(pre.tables._cf_METADATA, undefined)
  assert.ok(pre.tables.sqlite_sequence)
  modelPostFoundationFixture(database)
  const policy = reviewedFixturePolicy(database)
  const post = compareWithBaseline(database, snapshot, policy, baseline)
  assert.equal(post.compatible, true, JSON.stringify(post.violations))
  pythonSql(database, [
    ['DROP TABLE _cf_METADATA', []],
    ['ALTER TABLE _CF_New ADD COLUMN changed INTEGER', []],
  ])
  assert.deepEqual(compareWithBaseline(database, snapshot, policy, baseline), post)
  assert.equal(JSON.stringify(snapshot), serialized)
  assert.equal(validateComparisonArtifacts(snapshot, baseline).compatible, true)
})

test('pre-0020 CLI verifies retained schema/data, baseline seasons and exact history without writes', t => {
  const { database, directory } = snapshotFixture(t)
  const { snapshot, baseline } = legacyFixtureArtifacts(database)
  const input = path.join(directory, 'pre-snapshot.json')
  const baselineFile = path.join(directory, 'pre-baseline.json')
  fs.writeFileSync(input, JSON.stringify(snapshot))
  fs.writeFileSync(baselineFile, JSON.stringify(baseline))
  const args = [script, '--database', database, '--verify-pre-0020', input, '--baseline', baselineFile]
  const before = [fileHash(database), fileHash(input), fileHash(baselineFile)]
  const cli = spawnSync(process.execPath, args, { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  const report = JSON.parse(cli.stdout)
  assert.equal(report.kind, 'diwali-pre-0020-verification')
  assert.equal(report.compatible, true)
  assert.deepEqual(report.ownership, {})
  assert.equal(report.tables.d1_migrations.sha256, snapshot.tables.d1_migrations.sha256)
  assert.equal(report.tables.sqlite_sequence.sha256, snapshot.tables.sqlite_sequence.sha256)
  for (const season of ['season-2026', 'season-2099']) assert.equal(report.seasons[season].sha256, baseline.seasons[season].sha256)
  assert.ok(!cli.stdout.includes(SECRET))
  assert.deepEqual([fileHash(database), fileHash(input), fileHash(baselineFile)], before)
  for (const extra of [['--compare', input], ['--snapshot'], ['--schema-policy', input]]) {
    assert.equal(spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8' }).status, 1)
  }
  pythonSql(database, [
    ["UPDATE quotation_items SET snapshot='changed' WHERE id=2", []],
    ["UPDATE d1_migrations SET applied_at='changed' WHERE id=1", []],
    ['INSERT INTO d1_migrations (name) VALUES (?)', [FOUNDATION_NAME]],
  ])
  const denied = spawnSync(process.execPath, args, { encoding: 'utf8' })
  assert.equal(denied.status, 2)
  const failures = JSON.parse(denied.stdout).violations
  for (const subject of ['quotation_items', 'd1_migrations', 'sqlite_sequence']) {
    assert.ok(failures.some(v => v.code === 'original_rows_changed' && v.subject === subject), subject)
  }
  assert.ok(failures.some(v => v.code === 'baseline_season_fingerprint_changed' && v.subject === 'season-2099'))
  assert.ok(failures.some(v => v.code === 'unexpected_migration_inventory'))
  assert.deepEqual([fileHash(input), fileHash(baselineFile)], before.slice(1))
})

test('pre-0020 verification rejects application columns, FKs, objects and tables added or changed', t => {
  const { database } = snapshotFixture(t)
  const snapshot = captureComparisonSnapshot(database)
  const baseline = fixtureBaselines.get(database)
  assert.equal(verifyPreMigrationSnapshot(database, snapshot, baseline).compatible, true)
  pythonSql(database, [
    ['ALTER TABLE platform_settings ADD COLUMN unrelated TEXT REFERENCES admin_users(id)', []],
    ['DROP VIEW fixture_catalogue', []],
    ['CREATE VIEW fixture_catalogue AS SELECT category_slug FROM products', []],
    ['DROP TRIGGER fixture_products_update', []],
    ['CREATE TRIGGER fixture_products_update AFTER UPDATE ON products BEGIN SELECT 2; END', []],
    ['DROP INDEX idx_fixture_product_season', []],
    ['CREATE INDEX idx_fixture_product_season ON products(category_slug)', []],
    ['CREATE VIEW unexpected_view AS SELECT id FROM products', []],
    ['CREATE TABLE _cfX_global(value TEXT)', []], // Literal prefix only, not SQL LIKE wildcards.
    ['CREATE TABLE businesses(id TEXT)', []],
  ])
  const report = verifyPreMigrationSnapshot(database, snapshot, baseline)
  assert.equal(report.compatible, false)
  for (const code of ['original_column_schema_changed', 'foreign_key_schema_changed',
    'original_schema_object_changed', 'unexpected_schema_object', 'unexpected_table']) {
    assert.ok(report.violations.some(v => v.code === code), code)
  }
  for (const subject of ['_cfX_global', 'businesses']) assert.ok(report.violations
    .some(v => v.code === 'unexpected_table' && v.subject === subject))
})

test('post-0020 policy rejects missing, incorrect, ambiguous and legacy full-schema approvals', t => {
  const { database, directory } = snapshotFixture(t)
  const snapshot = captureComparisonSnapshot(database)
  modelPostFoundationFixture(database)
  const policy = reviewedFixturePolicy(database)
  const input = path.join(directory, 'policy-snapshot.json')
  const baselineFile = path.join(directory, 'policy-baseline.json')
  const policyFile = path.join(directory, 'policy.json')
  fs.writeFileSync(input, JSON.stringify(snapshot))
  fs.writeFileSync(baselineFile, JSON.stringify(fixtureBaselines.get(database)))
  const { schemaScope, ...withoutScope } = policy
  for (const [candidate, code] of [
    [null, 'reviewed_schema_policy_required'],
    [{}, 'reviewed_schema_policy_required'],
    [{ ...policy, schemaSha256: '0'.repeat(64) }, 'unapproved_schema'],
    [{ ...policy, schemaScope: 'full' }, 'invalid_schema_policy'],
    [withoutScope, 'invalid_schema_policy'],
    [{ ...withoutScope, formatVersion: 1 }, 'invalid_schema_policy'],
    [{ ...policy, formatVersion: 1 }, 'invalid_schema_policy'],
    [{ ...policy, migration: '0021_unapproved.sql' }, 'invalid_schema_policy'],
    [{ ...policy, schemaSha256: SECRET }, 'invalid_schema_policy'],
  ]) {
    fs.writeFileSync(policyFile, JSON.stringify(candidate))
    const cli = spawnSync(process.execPath, [script, '--database', database,
      '--compare', input, '--baseline', baselineFile, '--schema-policy', policyFile], { encoding: 'utf8' })
    assert.equal(cli.status, 2, cli.stderr)
    assert.ok(JSON.parse(cli.stdout).violations.some(v => v.code === code), JSON.stringify(candidate))
    assert.ok(!`${cli.stdout}${cli.stderr}`.includes(SECRET))
    assert.equal(fs.readFileSync(policyFile, 'utf8'), JSON.stringify(candidate))
  }
})

test('post-0020 policy pins application indexes, views and triggers while original objects stay strict', t => {
  const { database } = snapshotFixture(t)
  const snapshot = captureComparisonSnapshot(database)
  modelPostFoundationFixture(database)
  const policy = reviewedFixturePolicy(database)
  assert.equal(compareComparisonSnapshot(database, snapshot, policy).compatible, true)
  for (const sql of ['DROP INDEX idx_fixture_product_season', 'DROP VIEW fixture_catalogue', 'DROP TRIGGER fixture_products_update']) {
    pythonSql(database, [[sql, []]])
    const report = compareComparisonSnapshot(database, snapshot, policy)
    assert.ok(report.violations.some(v => v.code === 'unapproved_schema'), sql)
    assert.ok(report.violations.some(v => v.code === 'original_schema_object_changed'), sql)
  }
})
