/**
 * Idempotent UPSERT of catalogue-import.json into local D1 (no remote).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isRetryableLocalD1Error, withLocalD1LockAndRetry } from './lib/localD1Lock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const IMPORT_JSON = path.join(SERVER_ROOT, 'data', 'catalogue-import.json')
const GENERATED_SQL = path.join(SERVER_ROOT, 'data', 'generated', 'catalogue-upsert.sql')
const DB_NAME = 'diwali-quotation'

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

function runSqlFile(filePath) {
  withLocalD1LockAndRetry(() => {
    execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', DB_NAME, '--local', '--file', filePath],
      {
        cwd: SERVER_ROOT,
        stdio: 'pipe',
        shell: process.platform === 'win32',
      },
    )
  })
}

if (!fs.existsSync(IMPORT_JSON)) {
  console.error('Missing catalogue-import.json — run npm run catalogue:generate first.')
  process.exit(1)
}

const payload = JSON.parse(fs.readFileSync(IMPORT_JSON, 'utf8'))
const records = payload.records ?? []

const lines = [
  'PRAGMA foreign_keys = ON;',
  'BEGIN TRANSACTION;',
  "DELETE FROM products WHERE id GLOB 'TEST-*';",
  "DELETE FROM products WHERE id = 'P900';",
  "DELETE FROM products WHERE id = 'P901';",
  "DELETE FROM products WHERE id = 'P902';",
  "DELETE FROM products WHERE id = 'P903';",
  "DELETE FROM products WHERE id = 'P905';",
  "DELETE FROM products WHERE id = 'P906';",
]

for (const r of records) {
  lines.push(`
INSERT INTO products (
  id, category_slug, name, pack, description, featured, stock_status,
  active, sort_order, images_json, company
) VALUES (
  ${sqlString(r.id)},
  ${sqlString(r.category_slug)},
  ${sqlString(r.name)},
  ${sqlString(r.pack)},
  ${sqlString(r.description)},
  ${Number(r.featured) ? 1 : 0},
  ${sqlString(r.stock_status)},
  ${Number(r.active) ? 1 : 0},
  ${Number(r.sort_order)},
  ${sqlString(r.images_json)},
  ${sqlString(r.company)}
)
ON CONFLICT(id) DO UPDATE SET
  category_slug = excluded.category_slug,
  name = excluded.name,
  pack = excluded.pack,
  description = excluded.description,
  featured = excluded.featured,
  stock_status = excluded.stock_status,
  active = excluded.active,
  sort_order = excluded.sort_order,
  images_json = excluded.images_json,
  company = excluded.company,
  updated_at = datetime('now');
`.trim())
}

if (records.length) {
  const idList = records.map((r) => sqlString(r.id)).join(', ')
  lines.push(`DELETE FROM products WHERE id NOT IN (${idList});`)
}

lines.push('COMMIT;')

fs.mkdirSync(path.dirname(GENERATED_SQL), { recursive: true })
fs.writeFileSync(GENERATED_SQL, `${lines.join('\n\n')}\n`, 'utf8')

console.log(`Applying ${records.length} UPSERT statements to local D1...`)
runSqlFile(GENERATED_SQL)

if (process.env.WRANGLER_LOG === 'debug') {
  /* full JSON output only when debugging */
}

const countFile = path.join(SERVER_ROOT, 'data', 'generated', '_count.sql')
fs.writeFileSync(countFile, 'SELECT COUNT(*) AS n FROM products;\n', 'utf8')
const countOut = withLocalD1LockAndRetry(() =>
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, '--local', '--file', countFile, '--json'],
    { cwd: SERVER_ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
  ),
)

let importedCount = null
try {
  const parsed = JSON.parse(countOut)
  importedCount = parsed?.[0]?.results?.[0]?.n ?? parsed?.results?.[0]?.n
} catch {
  /* ignore parse errors */
}

console.log(`Local D1 products count: ${importedCount ?? 'unknown'}`)
console.log(`Source records: ${records.length}`)

if (importedCount !== null && Number(importedCount) < records.length) {
  console.warn('Warning: D1 count lower than source records (check errors above).')
}
