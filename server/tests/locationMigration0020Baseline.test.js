import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { Miniflare } from 'miniflare'

const directory = fileURLToPath(new URL('../database/migrations/', import.meta.url))
const files = readdirSync(directory).filter(name => /^00(?:0\d|1\d|20)_.*\.sql$/.test(name)).sort()
const target = '0020_business_location_foundation.sql'
const pythonPath = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python314', 'python.exe')
const python = process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' && existsSync(pythonPath) ? pythonPath : 'python3')
// SQLite's parser keeps complete triggers together, including their internal ';'.
const parsed = JSON.parse(execFileSync(python, ['-c', `import json,sqlite3,sys
result={}
for name,sql in json.load(sys.stdin).items():
 statements=[];pending=''
 for ch in sql:
  pending+=ch
  if ch==';' and sqlite3.complete_statement(pending):statements.append(pending);pending=''
 assert not pending.strip() or all(not line.strip() or line.lstrip().startswith('--') for line in pending.splitlines())
 result[name]=statements
print(json.dumps(result))`], {
  input: JSON.stringify(Object.fromEntries(files.map(name => [name, readFileSync(join(directory, name), 'utf8')]))),
  encoding: 'utf8', windowsHide: true,
}))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function sqlite(t) {
  const child = spawn(python, ['-u', fileURLToPath(new URL('./helpers/workflowSqliteBridge.py', import.meta.url))],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const pending = []
  child.stderr.resume()
  child.on('error', error => { while (pending.length) pending.shift().reject(error) })
  child.on('exit', code => { while (pending.length) pending.shift().reject(Error(`Memory SQLite exited ${code}`)) })
  createInterface({ input: child.stdout }).on('line', line => {
    const result = JSON.parse(line), next = pending.shift()
    if (result.error) next.reject(Error(result.error)); else next.resolve(result.result)
  })
  t.after(() => child.stdin.end())
  const send = input => new Promise((resolve, reject) => { pending.push({ resolve, reject }); child.stdin.write(JSON.stringify(input) + '\n') })
  return {
    query: async (sql, ...values) => (await send({ op: 'query', sql, values })).results,
    script: sql => send({ op: 'script', sql }),
    batch: statements => send({ op: 'batch', statements }),
  }
}

async function apply(db, name) {
  // Migration-runner selection by exact filename, never by numeric max alone.
  if ((await db.query('SELECT name FROM d1_migrations WHERE name=?', name)).length) return false
  await db.batch([...parsed[name].map(sql => ({ sql, values: [] })),
    { sql: 'INSERT INTO d1_migrations(name) VALUES(?)', values: [name] }])
  return true
}

async function starting0017(t, { users = 5, empty = false } = {}) {
  const db = await sqlite(t)
  await db.script('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);')
  for (const name of files.filter(name => name.slice(0, 4) <= '0017')) {
    await db.script(readFileSync(join(directory, name), 'utf8'))
    await db.query('INSERT INTO d1_migrations(name) VALUES(?)', name)
  }
  for (let n = 0; n < users; n++) {
    await db.query('INSERT INTO admin_users(id,email,role,password_hash,disabled_at) VALUES(?,?,?,?,?)',
      `user-${n}`, `user-${n}@example.test`, n === 0 ? 'owner' : 'admin', 'synthetic-hash', n === users - 1 ? '2026-10-01' : null)
  }
  if (!empty) {
    await db.script(`
      INSERT INTO categories(slug,label) VALUES('review','Review category');
      INSERT INTO products(id,category_slug,name,selling_price_paise,final_price_paise) VALUES
        ('review-p1','review','Product 1',11000,9000),('review-p2','review','Product 2',12000,10000),('review-p3','review','Product 3',13000,11000);
      INSERT INTO private_rates(product_id,unit_rate_paise,effective_from) VALUES('review-p1',9000,'2026-01-01'),('review-p2',10000,'2026-01-01');
      INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from) VALUES('review-p1',6000,'2026-01-01');
      INSERT INTO family_packs(id,name,slug,selling_price_paise) VALUES('review-pack','Review pack','review-pack',22000);
      INSERT INTO family_pack_items(family_pack_id,product_id,quantity) VALUES('review-pack','review-p1',2);
      INSERT INTO customer_requests(id,source,status,customer_name) VALUES
        ('review-r1','web','quoted','Synthetic One'),('review-r2','manual','received','Synthetic Two');
      INSERT INTO customer_request_items(request_id,line_number,product_id,product_name,quantity,unit_price_paise)
        VALUES('review-r1',1,'review-p1','Saved product name',2,11000);
      INSERT INTO quotations(id,customer_request_id,subtotal_paise,total_paise) VALUES('review-q1','review-r1',22000,22000);
      INSERT INTO quotation_items(quotation_id,line_number,product_id,product_name,quantity,unit_rate_paise,line_total_paise)
        VALUES('review-q1',1,'review-p1','Saved product name',2,11000,22000);
    `)
  }
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM d1_migrations'))[0].n, 18)
  return db
}

async function preceding(db) {
  await apply(db, '0018_business_seasons_foundation.sql')
  await apply(db, '0019_platform_admins.sql')
}

async function snapshot(db) {
  const schema = await db.query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_%' AND substr(lower(name),1,4)!='_cf_' AND substr(lower(tbl_name),1,4)!='_cf_' ORDER BY type,name")
  const tables = []
  for (const { name } of schema.filter(row => row.type === 'table')) {
    const columns = (await db.query(`PRAGMA table_info("${name}")`)).map(row => row.name)
    const rows = await db.query(`SELECT * FROM "${name}"`)
    tables.push({ name, columns, rows })
  }
  return { schema, tables }
}

async function verifyOriginals(db, before) {
  for (const table of before.tables) {
    if (table.name === 'd1_migrations' || table.name === 'sqlite_sequence') continue
    const rows = await db.query(`SELECT ${table.columns.map(c => `"${c}"`).join(',')} FROM "${table.name}"`)
    const canonical = values => values.map(row => JSON.stringify(table.columns.map(column => [typeof row[column], row[column]]))).sort()
    assert.deepEqual(canonical(rows), canonical(table.rows), `Preserve all original columns: ${table.name}`)
  }
  const originalHistory = before.tables.find(table => table.name === 'd1_migrations').rows
  assert.deepEqual((await db.query('SELECT * FROM d1_migrations ORDER BY id')).slice(0, originalHistory.length), originalHistory)
  for (const sequence of before.tables.find(table => table.name === 'sqlite_sequence').rows.filter(row => row.name !== 'd1_migrations')) {
    assert.deepEqual(await db.query('SELECT * FROM sqlite_sequence WHERE name=?', sequence.name), [sequence])
  }
  assert.deepEqual(await db.query('PRAGMA foreign_key_check'), [])
  assert.equal((await db.query("SELECT name FROM sqlite_master WHERE substr(name,1,6)='_0020_' OR substr(tbl_name,1,6)='_0020_' ")).length, 0)
}

test('0017→0020 accepts non-fixture counts without any 2099 season and preserves original data', async t => {
  const db = await starting0017(t), before0018 = await snapshot(db)
  await preceding(db)
  const before0020 = await snapshot(db)
  assert.deepEqual((await db.query('SELECT id FROM business_seasons')).map(row => row.id), ['season-2026'])
  assert.equal(await apply(db, target), true)
  await verifyOriginals(db, before0018)
  await verifyOriginals(db, before0020)
  for (const table of ['categories', 'products', 'family_packs', 'private_rates', 'product_purchase_rates', 'customer_requests', 'quotations']) {
    assert.equal((await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE season_id='season-2026' AND location_id IS NOT 'location-diwali-2026'`))[0].n, 0)
  }
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM location_members'))[0].n, 5)
  assert.deepEqual(await db.query('SELECT admin_user_id,role,disabled_at,created_at FROM location_members ORDER BY admin_user_id'),
    await db.query("SELECT admin_user_id,role,disabled_at,created_at FROM season_members WHERE season_id='season-2026' ORDER BY admin_user_id"))
})

test('zero transaction/membership counts and ten memberships are accepted without fixed totals', async t => {
  for (const users of [0, 10]) await t.test(`${users} memberships`, async t => {
    const db = await starting0017(t, { users, empty: true })
    await preceding(db)
    const before = await snapshot(db)
    await apply(db, target)
    await verifyOriginals(db, before)
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM location_members'))[0].n, users)
  })
})

test('optional non-2026 records and memberships remain unchanged and unmapped', async t => {
  const db = await starting0017(t)
  await preceding(db)
  await db.script(`INSERT INTO business_seasons(id,code,label) VALUES('season-2031','2031','Other season');
    INSERT INTO categories(slug,label,season_id) VALUES('other','Other','season-2031');
    INSERT INTO products(id,category_slug,name,season_id) VALUES('other-product','other','Unmapped product','season-2031');
    INSERT INTO private_rates(product_id,unit_rate_paise,effective_from,season_id) VALUES('other-product',1234,'2031-01-01','season-2031');
    INSERT INTO customer_requests(id,status,source,season_id) VALUES('other-request','received','web','season-2031');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2031','user-0','owner');`)
  const before = await snapshot(db)
  await apply(db, target)
  await verifyOriginals(db, before)
  assert.deepEqual(await db.query("SELECT location_id FROM products WHERE id='other-product'"), [{ location_id: null }])
  assert.equal((await db.query("SELECT COUNT(*) AS n FROM location_members WHERE season_id='season-2031'"))[0].n, 0)
})

test('invalid season, schema, history, relationships and data corruption abort atomically', async t => {
  const cases = {
    'invalid 2026 season': "UPDATE business_seasons SET status='archived' WHERE id='season-2026'",
    'unapproved original column': 'ALTER TABLE products ADD COLUMN unapproved TEXT',
    'unexpected migration history': "INSERT INTO d1_migrations(name) VALUES('unapproved.sql')",
    'existing foundation identity': 'CREATE TABLE businesses(id TEXT PRIMARY KEY)',
    'foreign-key violation': "PRAGMA foreign_keys=OFF;UPDATE products SET category_slug='missing' WHERE id='review-p1';PRAGMA foreign_keys=ON;",
    'cross-season parent': "INSERT INTO business_seasons(id,code,label) VALUES('season-2031','2031','Other');UPDATE products SET season_id='season-2031' WHERE id='review-p1';",
    'same-count original-value corruption': "CREATE TRIGGER review_corruption AFTER UPDATE OF location_id ON products BEGIN UPDATE products SET name='Corrupted' WHERE id=NEW.id; END;",
  }
  for (const [name, sql] of Object.entries(cases)) await t.test(name, async t => {
    const db = await starting0017(t)
    await preceding(db)
    await db.script(sql)
    const before = digest(await snapshot(db))
    await assert.rejects(apply(db, target), /migration_0020_assertion_failed/)
    assert.equal(digest(await snapshot(db)), before, 'Failed migration leaves schema/data/history unchanged')
  })
})

test('already-migrated 0020 snapshot is skipped; forced replay and history-write failure roll back', async t => {
  const db = await starting0017(t)
  await preceding(db)
  const before = digest(await snapshot(db))
  await assert.rejects(db.batch([...parsed[target].map(sql => ({ sql, values: [] })),
    { sql: 'INSERT INTO d1_migrations(name) VALUES(?)', values: ['0019_platform_admins.sql'] }]), /UNIQUE/)
  assert.equal(digest(await snapshot(db)), before)
  await apply(db, target)
  const migrated = digest(await snapshot(db))
  assert.equal(await apply(db, target), false, 'Already-applied exact filename never executes again')
  assert.equal(digest(await snapshot(db)), migrated)
  await assert.rejects(db.batch(parsed[target].map(sql => ({ sql, values: [] }))), /migration_0020_assertion_failed/)
  assert.equal(digest(await snapshot(db)), migrated, 'Even a forced replay cannot change the migrated state')
})

test('native in-memory D1 accepts actual 0017→0018→0019→0020 at the configured runtime date', async t => {
  const source = await starting0017(t), state = await snapshot(source)
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated")}}',
    compatibilityDate: '2025-04-01', host: '127.0.0.1', port: 0, d1Databases: ['DB'],
    d1Persist: false, cachePersist: false, kvPersist: false, r2Persist: false, durableObjectsPersist: false })
  try {
    const native = await runtime.getD1Database('DB')
    for (const item of state.schema.filter(item => item.type === 'table' && !item.name.startsWith('sqlite_'))) await native.prepare(item.sql).run()
    await native.batch([native.prepare('PRAGMA defer_foreign_keys=ON'), ...state.tables.filter(table => !table.name.startsWith('sqlite_')).flatMap(table =>
      table.rows.map(row => native.prepare(`INSERT INTO "${table.name}" (${table.columns.map(c => `"${c}"`).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`).bind(...table.columns.map(c => row[c]))))])
    for (const item of state.schema.filter(item => item.type !== 'table' && item.sql)) await native.prepare(item.sql).run()
    const db = {
      query: async (sql, ...values) => (await native.prepare(sql).bind(...values).all()).results,
      batch: statements => native.batch(statements.map(({ sql, values }) => native.prepare(sql).bind(...values))),
    }
    await preceding(db)
    const before = await snapshot(db)
    await assert.rejects(db.batch([...parsed[target].map(sql => ({ sql, values: [] })),
      { sql: 'INSERT INTO d1_migrations(name) VALUES(?)', values: ['0019_platform_admins.sql'] }]), /UNIQUE/)
    assert.equal(digest(await snapshot(db)), digest(before), 'Native D1 rolls back SQL and schema when final history insertion fails')
    await apply(db, target)
    await verifyOriginals(db, state)
    await verifyOriginals(db, before)
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM d1_migrations'))[0].n, 21)
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM location_members'))[0].n, 5)
    assert.equal(await apply(db, target), false)
  } finally { await runtime.dispose() }
})
