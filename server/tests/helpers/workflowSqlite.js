import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationDirectory = fileURLToPath(new URL('../../database/migrations/', import.meta.url))
export const workflowMigration = readFileSync(join(migrationDirectory, '0021_request_workflow_history.sql'), 'utf8')
export const paymentMigration = readFileSync(join(migrationDirectory, '0022_request_payment_ledger.sql'), 'utf8')
export const purchaseCostMigration = readFileSync(join(migrationDirectory, '0025_bill_purchase_cost_snapshots.sql'), 'utf8')

export async function workflowDb(t, { migrate = true, payments = true, purchaseCosts = true } = {}) {
  const installed = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python314', 'python.exe')
  const python = process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' && existsSync(installed) ? installed : 'python3')
  const child = spawn(python, ['-u', fileURLToPath(new URL('./workflowSqliteBridge.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const pending = []
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  child.on('error', error => { while (pending.length) pending.shift().reject(error) })
  child.on('exit', code => { while (pending.length) pending.shift().reject(Error(`SQLite bridge exited ${code}: ${stderr}`)) })
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line), next = pending.shift()
    if (message.error) next.reject(Error(message.error)); else next.resolve(message.result)
  })
  t.after(() => child.stdin.end())
  const send = input => new Promise((resolve, reject) => { pending.push({ resolve, reject }); child.stdin.write(JSON.stringify(input) + '\n') })
  const db = {
    script: sql => send({ op: 'script', sql }),
    prepare(sql) {
      return { bind(...values) {
        const statement = { sql, values }
        return { ...statement, all: () => send({ op: 'query', ...statement }),
          first: async () => (await send({ op: 'query', ...statement })).results[0] ?? null,
          run: () => send({ op: 'query', ...statement }) }
      } }
    },
    batch: statements => send({ op: 'batch', statements: statements.map(({ sql, values }) => ({ sql, values })) }),
  }
  for (const file of readdirSync(migrationDirectory).filter(file => /^00(?:0\d|1\d)_.*\.sql$/.test(file)).sort()) await db.script(readFileSync(join(migrationDirectory, file), 'utf8'))
  // Minimal post-0020 fixture: avoid its production-specific inventory assertions.
  // All pre-0021 request/quotation columns come from the real earlier migrations.
  await db.script(`
    CREATE TABLE businesses(id TEXT PRIMARY KEY, slug TEXT, name TEXT, business_type TEXT, status TEXT);
    CREATE TABLE business_locations(id TEXT PRIMARY KEY, business_id TEXT REFERENCES businesses(id), slug TEXT, name TEXT, status TEXT);
    CREATE TABLE location_seasons(location_id TEXT, season_id TEXT, operating_year INTEGER, status TEXT);
    CREATE TABLE location_members(location_id TEXT, season_id TEXT, admin_user_id TEXT, role TEXT, disabled_at TEXT);
    ${['categories', 'products', 'family_packs', 'private_rates', 'product_purchase_rates', 'customer_requests', 'quotations'].map(table => `ALTER TABLE ${table} ADD COLUMN location_id TEXT;`).join('\n')}
    INSERT INTO businesses VALUES('shop','shop','Shop','permanent','active');
    INSERT INTO business_locations VALUES('loc-a','shop','a','A','active'),('loc-b','shop','b','B','active');
    INSERT INTO location_seasons VALUES('loc-a','season-2026',2026,'active'),('loc-b','season-2026',2026,'active');
    INSERT INTO admin_users(id,email,display_name,role) VALUES('owner','owner@test.com','Original Owner','owner'),('admin','admin@test.com','Original Admin','admin'),('super','super@test.com','Original Super','super_admin');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2026','owner','owner'),('season-2026','admin','admin'),('season-2026','super','super_admin');
    INSERT INTO location_members VALUES('loc-a','season-2026','owner','owner',NULL),('loc-a','season-2026','admin','admin',NULL),('loc-a','season-2026','super','super_admin',NULL);
    INSERT INTO categories(slug,label,season_id,location_id) VALUES('cat-a','A','season-2026','loc-a'),('cat-b','B','season-2026','loc-b');
    INSERT INTO products(id,category_slug,name,pack,company,selling_price_paise,final_price_paise,pieces_per_pack,allow_loose_sale,season_id,location_id)
      VALUES('P001','cat-a','Product A','10 pieces','Maker',10000,8000,10,1,'season-2026','loc-a'),('P002','cat-b','Product B','Box','Maker',90000,70000,10,0,'season-2026','loc-b');
  `)
  if (migrate) {
    await db.script(workflowMigration)
    if (payments) {
      await db.script(paymentMigration)
      if (purchaseCosts) await db.script(purchaseCostMigration)
    }
    await db.script(readFileSync(join(migrationDirectory, '0030_request_payment_preferences.sql'), 'utf8'))
  }
  return db
}
