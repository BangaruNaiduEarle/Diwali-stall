#!/usr/bin/env node
/**
 * Sync product catalogue rows (and current purchase rates) from local D1 → remote D1.
 * Does NOT delete production-only products. Does NOT modify private_rates (X4), requests, quotations, family packs, or admin tables.
 *
 * Default: --dry-run (read-only remote SELECT + write plan SQL/reports).
 * --apply: requires --backup (or runs remote export first), then executes generated SQL on remote.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { validateImageRef } from '../src/lib/validation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const DB_NAME = 'diwali-quotation'
const DB_ID = 'c2ae3b00-7356-4e54-97ba-e7b92ca79346'
const GENERATED_DIR = path.join(SERVER_ROOT, 'data', 'generated')
const BACKUP_DIR = path.join(SERVER_ROOT, 'data', 'backups')
const REPORT_PATH = path.join(SERVER_ROOT, 'reports', 'products-sync-local-to-remote-plan.json')
const SQL_OUT = path.join(GENERATED_DIR, 'products-sync-to-remote.sql')

const PRODUCT_SELECT = `
SELECT
  id,
  category_slug,
  name,
  company,
  pack,
  description,
  featured,
  stock_status,
  active,
  sort_order,
  images_json,
  selling_price_paise,
  created_at,
  updated_at
FROM products
ORDER BY id
`.trim()

const PURCHASE_SELECT = `
SELECT product_id, unit_rate_paise
FROM product_purchase_rates
WHERE effective_to IS NULL
ORDER BY product_id
`.trim()

const COMPARE_FIELDS = [
  'category_slug',
  'name',
  'company',
  'pack',
  'description',
  'featured',
  'stock_status',
  'active',
  'sort_order',
  'images_json',
  'selling_price_paise',
  'purchase_rate_paise',
]

function parseArgs(argv) {
  const args = new Set(argv.slice(2))
  if (args.has('--help') || args.has('-h')) {
    return { help: true }
  }
  return {
    help: false,
    dryRun: !args.has('--apply'),
    apply: args.has('--apply'),
    skipBackup: args.has('--skip-backup'),
  }
}

function timestampUtcCompact() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

function parseWranglerJson(stdout) {
  const start = stdout.indexOf('[')
  if (start < 0) throw new Error('No JSON array in wrangler stdout')
  return JSON.parse(stdout.slice(start))
}

/** @param {'local' | 'remote'} target */
function d1Query(target, sql) {
  const trimmed = String(sql).trim()
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error('Only SELECT queries allowed')
  }
  const filePath = path.join(
    os.tmpdir(),
    `diwali-sync-${target}-${process.pid}-${Date.now()}.sql`,
  )
  fs.writeFileSync(filePath, trimmed, 'utf8')
  try {
    const out = execFileSync(
      'npx',
      [
        'wrangler',
        'd1',
        'execute',
        DB_NAME,
        target === 'remote' ? '--remote' : '--local',
        '--json',
        '--file',
        filePath,
      ],
      {
        cwd: SERVER_ROOT,
        encoding: 'utf8',
        maxBuffer: 80 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      },
    )
    const parsed = parseWranglerJson(out)
    const results = parsed[0]?.results ?? []
    if (!Array.isArray(results)) {
      throw new Error(`Unexpected wrangler JSON shape for ${target}`)
    }
    return results
  } catch (err) {
    const detail = String(err.stderr ?? err.stdout ?? err.message ?? err)
    throw new Error(`wrangler ${target} query failed: ${detail.slice(0, 2500)}`)
  } finally {
    try {
      fs.unlinkSync(filePath)
    } catch {
      /* ignore */
    }
  }
}

const PRODUCT_ID_RE = /^P\d+$/

/** @param {Record<string, unknown>[]} rows */
function normalizeProductRows(rows, label) {
  const valid = []
  /** @type {unknown[]} */
  const rejected = []
  for (const row of rows) {
    const id = String(row?.id ?? '').trim()
    if (!PRODUCT_ID_RE.test(id)) {
      rejected.push(row)
      continue
    }
    valid.push({ ...row, id })
  }
  if (rejected.length) {
    console.warn(
      `Warning: ${label} returned ${rejected.length} row(s) without a valid product id (ignored).`,
    )
  }
  return valid
}

function parseImages(imagesJson) {
  try {
    const parsed = JSON.parse(String(imagesJson ?? '[]'))
    return Array.isArray(parsed) ? parsed.map((x) => String(x ?? '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function normCompareValue(field, row) {
  const v = row[field]
  if (field === 'images_json') return JSON.stringify(parseImages(v))
  if (v === null || v === undefined || v === '') return null
  if (['featured', 'active'].includes(field)) return Number(v) ? 1 : 0
  if (['sort_order', 'selling_price_paise', 'purchase_rate_paise'].includes(field)) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return String(v).trim()
}

function diffFields(localRow, remoteRow) {
  /** @type {string[]} */
  const changed = []
  for (const f of COMPARE_FIELDS) {
    if (normCompareValue(f, localRow) !== normCompareValue(f, remoteRow)) changed.push(f)
  }
  return changed
}

function auditImages(rows) {
  /** @type {{ id: string, issues: string[] }[]} */
  const problems = []
  let localPathOnly = 0
  let cloudinary = 0
  let emptyImages = 0
  for (const row of rows) {
    const urls = parseImages(row.images_json)
    if (!urls.length) emptyImages += 1
    /** @type {string[]} */
    const issues = []
    let hasLocal = false
    let hasCloudinary = false
    for (const u of urls) {
      const r = validateImageRef(u)
      if (!r.ok) issues.push(`${u}: ${r.error}`)
      if (u.startsWith('/images/')) hasLocal = true
      if (/cloudinary\.com/i.test(u)) hasCloudinary = true
    }
    if (hasLocal && !hasCloudinary) localPathOnly += 1
    if (hasCloudinary) cloudinary += 1
    if (issues.length) problems.push({ id: String(row.id), issues })
  }
  return { problems, localPathOnly, cloudinary, emptyImages }
}

function buildUpsertSql(localRows) {
  const lines = [
    'PRAGMA foreign_keys = ON;',
    'BEGIN TRANSACTION;',
    `-- Product upserts from local D1 (${localRows.length} rows). No DELETE of production-only IDs.`,
  ]

  for (const r of localRows) {
    const selling =
      r.selling_price_paise === null || r.selling_price_paise === undefined
        ? 'NULL'
        : Number(r.selling_price_paise)
    lines.push(`
INSERT INTO products (
  id, category_slug, name, pack, description, featured, stock_status,
  active, sort_order, images_json, company, selling_price_paise, created_at
) VALUES (
  ${sqlString(r.id)},
  ${sqlString(r.category_slug)},
  ${sqlString(r.name)},
  ${sqlString(r.pack ?? '')},
  ${sqlString(r.description ?? '')},
  ${Number(r.featured) ? 1 : 0},
  ${sqlString(r.stock_status)},
  ${Number(r.active) ? 1 : 0},
  ${Number(r.sort_order) || 0},
  ${sqlString(r.images_json ?? '[]')},
  ${r.company ? sqlString(r.company) : 'NULL'},
  ${selling},
  ${sqlString(r.created_at ?? new Date().toISOString())}
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
  selling_price_paise = excluded.selling_price_paise,
  updated_at = datetime('now');
`.trim())
  }

  lines.push('-- Current purchase rates (Excel Rate) from local; does not touch private_rates / X4.')
  for (const r of localRows) {
    const paise = r.purchase_rate_paise
    if (paise === null || paise === undefined || !Number.isFinite(Number(paise))) continue
    const pid = sqlString(r.id)
    lines.push(`
UPDATE product_purchase_rates
SET effective_to = datetime('now'), updated_at = datetime('now')
WHERE product_id = ${pid} AND effective_to IS NULL
  AND unit_rate_paise != ${Number(paise)};
INSERT INTO product_purchase_rates (product_id, unit_rate_paise, effective_from, notes)
SELECT ${pid}, ${Number(paise)}, datetime('now'), 'sync_from_local_d1'
WHERE NOT EXISTS (
  SELECT 1 FROM product_purchase_rates
  WHERE product_id = ${pid} AND effective_to IS NULL AND unit_rate_paise = ${Number(paise)}
);
`.trim())
  }

  lines.push('COMMIT;')
  return `${lines.join('\n\n')}\n`
}

function exportRemoteBackup(outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'export', DB_NAME, '--remote', '--output', outPath, '-y'],
    {
      cwd: SERVER_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    },
  )
}

function applyRemoteSql(sqlPath) {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--file', sqlPath],
    {
      cwd: SERVER_ROOT,
      encoding: 'utf8',
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  )
}

/** @param {Record<string, unknown>[]} productRows @param {Record<string, unknown>[]} purchaseRows */
function attachPurchaseRates(productRows, purchaseRows) {
  const byProduct = new Map(
    purchaseRows.map((r) => [String(r.product_id ?? '').trim(), r.unit_rate_paise]),
  )
  return productRows.map((row) => ({
    ...row,
    purchase_rate_paise: byProduct.get(String(row.id)) ?? null,
  }))
}

function main() {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    console.log(`Usage:
  node scripts/sync-products-local-to-remote.mjs              Dry-run (default)
  node scripts/sync-products-local-to-remote.mjs --apply     Backup + apply to remote D1

Local source:  wrangler d1 execute ${DB_NAME} --local  (Miniflare under server/.wrangler/state/v3/d1/)
Remote target: wrangler d1 execute ${DB_NAME} --remote (database_id ${DB_ID})

Writes:
  ${path.relative(SERVER_ROOT, REPORT_PATH)}
  ${path.relative(SERVER_ROOT, SQL_OUT)}
Remote backup (apply only): server/data/backups/d1-remote-pre-products-sync-<timestamp>.sql

Does NOT delete production-only products. Does NOT sync private_rates (X4).`)
    process.exit(0)
  }

  console.log('Loading local products…')
  const localRows = attachPurchaseRates(
    normalizeProductRows(d1Query('local', PRODUCT_SELECT), 'local'),
    d1Query('local', PURCHASE_SELECT),
  )
  console.log('Loading remote products…')
  const remoteCountRaw = d1Query('remote', 'SELECT COUNT(*) AS n FROM products')
  const remoteProductCount = Number(remoteCountRaw[0]?.n)
  const remoteRows = attachPurchaseRates(
    normalizeProductRows(d1Query('remote', PRODUCT_SELECT), 'remote'),
    d1Query('remote', PURCHASE_SELECT),
  )
  if (Number.isFinite(remoteProductCount) && remoteProductCount > 0 && remoteRows.length === 0) {
    throw new Error(
      `Remote reports ${remoteProductCount} products but export returned 0 valid rows. ` +
        'Check wrangler auth, database_id in wrangler.toml, and re-run dry-run.',
    )
  }

  const localMap = new Map(localRows.map((r) => [String(r.id), r]))
  const remoteMap = new Map(remoteRows.map((r) => [String(r.id), r]))

  const localIds = [...localMap.keys()].sort()
  const remoteIds = [...remoteMap.keys()].sort()
  const onlyLocal = localIds.filter((id) => !remoteMap.has(id))
  const onlyRemote = remoteIds.filter((id) => !localMap.has(id))

  /** @type {{ id: string, action: 'insert' | 'update', fields: string[] }[]} */
  const plan = []
  for (const id of localIds) {
    if (!remoteMap.has(id)) {
      plan.push({ id, action: 'insert', fields: COMPARE_FIELDS })
      continue
    }
    const fields = diffFields(localMap.get(id), remoteMap.get(id))
    if (fields.length) plan.push({ id, action: 'update', fields })
  }

  const fieldCounts = {}
  for (const p of plan.filter((x) => x.action === 'update')) {
    for (const f of p.fields) fieldCounts[f] = (fieldCounts[f] ?? 0) + 1
  }

  const localCategories = new Set(localRows.map((r) => String(r.category_slug)))
  const remoteCategories = new Set(
    d1Query('remote', 'SELECT slug FROM categories ORDER BY slug').map((r) => String(r.slug)),
  )
  const missingCategories = [...localCategories].filter((s) => !remoteCategories.has(s))

  const imageAudit = auditImages(localRows)

  const sellingLocal = localRows.filter(
    (r) => r.selling_price_paise != null && Number(r.selling_price_paise) > 0,
  ).length
  const sellingRemote = remoteRows.filter(
    (r) => r.selling_price_paise != null && Number(r.selling_price_paise) > 0,
  ).length

  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(SQL_OUT, buildUpsertSql(localRows), 'utf8')

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      local: `wrangler d1 → ${DB_NAME} (--local), Miniflare state server/.wrangler/state/v3/d1/`,
      remote: `wrangler d1 → ${DB_NAME} (--remote), database_id ${DB_ID}, Worker binding DB`,
    },
    counts: {
      localProducts: localRows.length,
      remoteProducts: remoteRows.length,
      remoteProductsReportedByCount: Number.isFinite(remoteProductCount) ? remoteProductCount : null,
      inserts: onlyLocal.length,
      updates: plan.filter((p) => p.action === 'update').length,
      unchanged: localRows.length - onlyLocal.length - plan.filter((p) => p.action === 'update').length,
      productionOnlyUnchanged: onlyRemote.length,
      localWithSellingPricePaise: sellingLocal,
      remoteWithSellingPricePaise: sellingRemote,
    },
    onlyLocalIds: onlyLocal,
    productionOnlyIds: onlyRemote,
    fieldChangeCounts: fieldCounts,
    planSample: plan.slice(0, 30),
    plan,
    categoryCheck: { missingOnRemote: missingCategories },
    imageAudit: {
      ...imageAudit,
      note:
        '/images/… paths work in production when the same files exist in the Vercel static public/ tree. Cloudinary https URLs work independently.',
    },
    sellingPriceRule: 'Only products.selling_price_paise is written; private_rates (X4) are not synced.',
    generatedSql: path.relative(SERVER_ROOT, SQL_OUT),
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')

  console.log('\n=== Products sync plan (dry-run) ===')
  console.log(JSON.stringify(report.counts, null, 2))
  if (missingCategories.length) {
    console.warn('\nWARNING: categories missing on remote:', missingCategories)
  }
  if (imageAudit.problems.length) {
    console.warn(`\nWARNING: ${imageAudit.problems.length} product(s) have invalid image refs (see report).`)
  }
  console.log(`\nReport: ${REPORT_PATH}`)
  console.log(`SQL plan: ${SQL_OUT}`)

  if (opts.dryRun) {
    console.log('\nNo remote writes (dry-run). To apply after review:')
    console.log('  cd server && node scripts/sync-products-local-to-remote.mjs --apply')
    return
  }

  if (missingCategories.length) {
    console.error('Aborting apply: fix missing categories on remote first.')
    process.exit(2)
  }
  if (imageAudit.problems.length) {
    console.error('Aborting apply: fix invalid image paths first.')
    process.exit(2)
  }

  const ts = timestampUtcCompact()
  const backupPath = path.join(BACKUP_DIR, `d1-remote-pre-products-sync-${ts}.sql`)
  if (!opts.skipBackup) {
    console.log(`\nExporting remote D1 backup → ${backupPath}`)
    exportRemoteBackup(backupPath)
  }

  console.log('\nApplying product sync SQL to remote D1…')
  applyRemoteSql(SQL_OUT)

  const verify = d1Query('remote', 'SELECT COUNT(*) AS n FROM products')
  console.log('Remote product count after apply:', verify[0]?.n)
  console.log('Done. Keep backup SQL for rollback if needed.')
}

main()
