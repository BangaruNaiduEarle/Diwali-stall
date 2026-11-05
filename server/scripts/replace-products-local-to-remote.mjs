#!/usr/bin/env node
/**
 * Replace production catalogue products with local D1 (local = source of truth).
 * - Upserts every local product row (full column set including selling_price_paise).
 * - Removes production-only product rows only when unreferenced (FK-safe).
 * - Syncs current purchase rates from local (close + insert; does not touch private_rates / X4).
 * - Upserts local D1 categories before products (label/sort_order from local; remote-only slugs preserved).
 *
 * Default: dry-run (plan + SQL files only). --apply: targeted backup then remote execute.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateImageRef } from '../src/lib/validation.js'
import {
  assertRemoteCatalogueVerified,
  DB_NAME,
  d1Query,
  normalizeProductIds,
  sqlString,
  timestampUtcCompact,
} from './lib/d1WranglerQuery.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const DB_ID = 'c2ae3b00-7356-4e54-97ba-e7b92ca79346'
const GENERATED_DIR = path.join(SERVER_ROOT, 'data', 'generated')
const BACKUP_DIR = path.join(SERVER_ROOT, 'data', 'backups')
const REPORT_PATH = path.join(SERVER_ROOT, 'reports', 'products-replace-local-to-remote-plan.json')
const APPLY_SQL = path.join(GENERATED_DIR, 'products-replace-remote.sql')
const APPLY_CATEGORIES_SQL = path.join(GENERATED_DIR, 'products-replace-remote-categories.sql')
const APPLY_PRODUCTS_SQL = path.join(GENERATED_DIR, 'products-replace-remote-products.sql')
const APPLY_RATES_SQL = path.join(GENERATED_DIR, 'products-replace-remote-purchase-rates.sql')
const APPLY_DELETES_SQL = path.join(GENERATED_DIR, 'products-replace-remote-deletes.sql')

const CATEGORY_SELECT = `
SELECT slug, label, sort_order, created_at, updated_at
FROM categories
ORDER BY sort_order ASC, slug ASC
`.trim()

const PRODUCT_SELECT = `
SELECT
  id, category_slug, name, company, pack, description,
  featured, stock_status, active, sort_order, images_json,
  selling_price_paise, final_price_paise, pieces_per_pack, allow_loose_sale,
  created_at, updated_at
FROM products
ORDER BY id
`.trim()

const PURCHASE_CURRENT_SELECT = `
SELECT product_id, unit_rate_paise, effective_from, notes
FROM product_purchase_rates
WHERE effective_to IS NULL
ORDER BY product_id
`.trim()

const PURCHASE_ALL_FOR_PRODUCTS = `
SELECT id, product_id, unit_rate_paise, effective_from, effective_to, notes, created_at, updated_at
FROM product_purchase_rates
ORDER BY product_id, id
`.trim()

function parseArgs(argv) {
  const args = new Set(argv.slice(2))
  if (args.has('--help') || args.has('-h')) return { help: true }
  return { help: false, apply: args.has('--apply') }
}

function parseImages(imagesJson) {
  try {
    const parsed = JSON.parse(String(imagesJson ?? '[]'))
    return Array.isArray(parsed) ? parsed.map((x) => String(x ?? '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function auditImages(rows) {
  /** @type {{ id: string, issues: string[] }[]} */
  const problems = []
  for (const row of rows) {
    const issues = []
    for (const u of parseImages(row.images_json)) {
      const r = validateImageRef(u)
      if (!r.ok) issues.push(`${u}: ${r.error}`)
    }
    if (issues.length) problems.push({ id: String(row.id), issues })
  }
  return problems
}

/** @param {Record<string, unknown>[]} remoteProducts @param {Set<string>} localIds */
function referenceSummary(remoteProducts, localIds) {
  /** @type {Record<string, { request: number, quotation: number, familyPack: number, total: number }>} */
  const byId = {}
  for (const row of remoteProducts) {
    const id = String(row.id)
    if (localIds.has(id)) continue
    byId[id] = { request: 0, quotation: 0, familyPack: 0, total: 0 }
  }
  const ids = Object.keys(byId)
  if (!ids.length) return { productionOnly: [], deletable: [], retainedDueToReferences: [] }

  const inList = ids.map((id) => sqlString(id)).join(', ')
  const refRows = d1Query(
    SERVER_ROOT,
    'remote',
    `
SELECT p.id,
  (SELECT COUNT(*) FROM customer_request_items c WHERE c.product_id = p.id) AS request_refs,
  (SELECT COUNT(*) FROM quotation_items q WHERE q.product_id = p.id) AS quotation_refs,
  (SELECT COUNT(*) FROM family_pack_items f WHERE f.product_id = p.id) AS family_pack_refs
FROM products p
WHERE p.id IN (${inList})
ORDER BY p.id
`.trim(),
  )

  /** @type {{ id: string, name: string, refs: typeof byId[string], action: 'delete' | 'retain' }[]} */
  const productionOnly = []
  for (const r of refRows) {
    const id = String(r.id)
    const refs = {
      request: Number(r.request_refs ?? 0),
      quotation: Number(r.quotation_refs ?? 0),
      familyPack: Number(r.family_pack_refs ?? 0),
      total: 0,
    }
    refs.total = refs.request + refs.quotation + refs.familyPack
    const remote = remoteProducts.find((p) => String(p.id) === id)
    const action = refs.total > 0 ? 'retain' : 'delete'
    productionOnly.push({
      id,
      name: String(remote?.name ?? ''),
      refs,
      action,
    })
  }

  return {
    productionOnly,
    deletable: productionOnly.filter((p) => p.action === 'delete').map((p) => p.id),
    retainedDueToReferences: productionOnly.filter((p) => p.action === 'retain'),
  }
}

/**
 * @param {Record<string, unknown>[]} categories
 * @param {{ restoreSnapshot?: boolean }} [opts]
 */
export function buildCategoryUpsertSql(categories, opts = {}) {
  const restore = opts.restoreSnapshot === true
  const lines = []
  for (const r of categories) {
    const slug = String(r.slug ?? '').trim()
    if (!slug) continue
    const onConflictCreated = restore ? '\n  created_at = excluded.created_at,' : ''
    lines.push(`
INSERT INTO categories (slug, label, sort_order, created_at, updated_at)
VALUES (
  ${sqlString(slug)},
  ${sqlString(r.label)},
  ${Number(r.sort_order) || 0},
  ${sqlString(r.created_at ?? new Date().toISOString())},
  ${sqlString(r.updated_at ?? new Date().toISOString())}
)
ON CONFLICT(slug) DO UPDATE SET
  label = excluded.label,
  sort_order = excluded.sort_order,${onConflictCreated}
  updated_at = excluded.updated_at;
`.trim())
  }
  return lines
}

/**
 * @param {Record<string, unknown>[]} localCategories
 * @param {Record<string, unknown>[]} remoteCategories
 */
export function planCategorySync(localCategories, remoteCategories) {
  const remoteBySlug = new Map(remoteCategories.map((c) => [String(c.slug), c]))
  const localSlugs = new Set(localCategories.map((c) => String(c.slug)))
  /** @type {{ slug: string, label: string, sort_order: number }[]} */
  const insertOnRemote = []
  /** @type {{ slug: string, remote: { label: string, sort_order: number }, local: { label: string, sort_order: number } }[]} */
  const updateFromLocal = []

  for (const row of localCategories) {
    const slug = String(row.slug)
    const local = {
      label: String(row.label ?? ''),
      sort_order: Number(row.sort_order) || 0,
    }
    const remote = remoteBySlug.get(slug)
    if (!remote) {
      insertOnRemote.push({ slug, ...local })
      continue
    }
    const remoteLabel = String(remote.label ?? '')
    const remoteSort = Number(remote.sort_order) || 0
    if (remoteLabel !== local.label || remoteSort !== local.sort_order) {
      updateFromLocal.push({
        slug,
        remote: { label: remoteLabel, sort_order: remoteSort },
        local,
      })
    }
  }

  const preservedRemoteOnly = remoteCategories
    .map((c) => String(c.slug))
    .filter((slug) => slug && !localSlugs.has(slug))

  return {
    upsertCount: localCategories.length,
    insertOnRemote,
    updateFromLocal,
    preservedRemoteOnly,
  }
}

/**
 * Local D1: allow_loose_sale is NOT NULL (0/1). NULL/missing → 0 for SQL.
 *
 * @param {unknown} value
 * @param {string} productId
 * @returns {0 | 1}
 */
function allowLooseSaleForSql(value, productId) {
  if (value === null || value === undefined) return 0
  if (value === 0 || value === 1) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '0') return 0
    if (trimmed === '1') return 1
  }
  const n = Number(value)
  if (Number.isInteger(n) && (n === 0 || n === 1)) return /** @type {0 | 1} */ (n)
  throw new Error(
    `Product ${productId}: allow_loose_sale must be 0 or 1, got ${JSON.stringify(value)}`,
  )
}

/**
 * @param {Record<string, unknown>[]} products
 * @param {{ restoreSnapshot?: boolean }} [opts]
 */
function buildProductUpsertSql(products, opts = {}) {
  const restore = opts.restoreSnapshot === true
  const lines = []
  for (const r of products) {
    const selling =
      r.selling_price_paise === null || r.selling_price_paise === undefined
        ? 'NULL'
        : Number(r.selling_price_paise)
    const finalPrice =
      r.final_price_paise === null || r.final_price_paise === undefined
        ? 'NULL'
        : Number(r.final_price_paise)
    const piecesPerPack =
      r.pieces_per_pack === null || r.pieces_per_pack === undefined
        ? 'NULL'
        : Number(r.pieces_per_pack)
    const allowLooseSale = allowLooseSaleForSql(r.allow_loose_sale, String(r.id))
    const onConflictCreated = restore ? '\n  created_at = excluded.created_at,' : ''
    lines.push(`
INSERT INTO products (
  id, category_slug, name, pack, description, featured, stock_status,
  active, sort_order, images_json, company, selling_price_paise, final_price_paise,
  pieces_per_pack, allow_loose_sale, created_at, updated_at
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
  ${finalPrice},
  ${piecesPerPack},
  ${allowLooseSale},
  ${sqlString(r.created_at ?? new Date().toISOString())},
  ${sqlString(r.updated_at ?? new Date().toISOString())}
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
  final_price_paise = excluded.final_price_paise,
  pieces_per_pack = excluded.pieces_per_pack,
  allow_loose_sale = excluded.allow_loose_sale,${onConflictCreated}
  updated_at = excluded.updated_at;
`.trim())
  }
  return lines
}

/**
 * @param {Map<string, { unit_rate_paise: number, notes?: string }>} localRates
 * @param {string[]} localProductIds
 */
function buildPurchaseRateSyncSql(localRates, localProductIds) {
  const lines = [
    '-- Sync current purchase rates from local (Excel Rate). Does not modify private_rates.',
  ]
  for (const productId of localProductIds) {
    const pid = sqlString(productId)
    const local = localRates.get(productId)
    lines.push(`
UPDATE product_purchase_rates
SET effective_to = datetime('now'), updated_at = datetime('now')
WHERE product_id = ${pid} AND effective_to IS NULL;
`.trim())
    if (local && Number.isFinite(Number(local.unit_rate_paise))) {
      const paise = Number(local.unit_rate_paise)
      const notes = sqlString(local.notes ?? 'replace_sync_from_local_d1')
      lines.push(`
INSERT INTO product_purchase_rates (product_id, unit_rate_paise, effective_from, notes)
VALUES (${pid}, ${paise}, datetime('now'), ${notes});
`.trim())
    }
  }
  return lines
}

/** @param {string[]} deletableIds */
function buildDeleteSql(deletableIds) {
  if (!deletableIds.length) return ['-- No unreferenced production-only products to delete.']
  const inList = deletableIds.map((id) => sqlString(id)).join(', ')
  return [
    `-- Remove ${deletableIds.length} production-only product(s) with no request/quotation/family-pack references.`,
    `DELETE FROM products WHERE id IN (${inList});`,
  ]
}

/**
 * Targeted rollback: restore products + rates + categories from pre-replace snapshot,
 * then remove category slugs that were inserted by the replace (not in snapshot).
 *
 * @param {Record<string, unknown>[]} categoryRows
 * @param {Record<string, unknown>[]} productRows
 * @param {Record<string, unknown>[]} purchaseRows
 * @param {string[]} categorySlugsInsertedByApply slugs planned as inserts (from dry-run plan)
 * @param {string[]} productIdsInsertedByApply product ids planned as inserts (from dry-run plan)
 */
export function buildRollbackSql(
  categoryRows,
  productRows,
  purchaseRows,
  categorySlugsInsertedByApply = [],
  productIdsInsertedByApply = [],
) {
  const restoreOpts = { restoreSnapshot: true }
  const lines = [
    '-- Targeted rollback for products-replace (categories + products + product_purchase_rates).',
    '-- Remote wrangler d1 execute does not support SQL BEGIN TRANSACTION; statements run sequentially.',
    '-- Rollback is best-effort, not atomic — verify remote state after running.',
    '-- Order: products → remove apply-inserted products/rates → restore rates → categories → safe category deletes.',
  ]
  lines.push('-- Restore products snapshot (includes created_at / updated_at from backup)')
  for (const r of productRows) {
    lines.push(...buildProductUpsertSql([r], restoreOpts))
  }
  const backupProductIds = new Set(productRows.map((p) => String(p.id)))
  const insertedProductIds = productIdsInsertedByApply
    .map((id) => String(id).trim())
    .filter((id) => id && !backupProductIds.has(id))
  if (insertedProductIds.length) {
    const inList = [...new Set(insertedProductIds)].map((id) => sqlString(id)).join(', ')
    lines.push(
      `-- Remove ${insertedProductIds.length} product(s) inserted during replace (absent from pre-apply snapshot).`,
      `DELETE FROM product_purchase_rates WHERE product_id IN (${inList});`,
      `DELETE FROM products WHERE id IN (${inList});`,
    )
  }
  const rateProductIds = [...new Set(purchaseRows.map((r) => String(r.product_id)))]
  if (rateProductIds.length) {
    const inList = rateProductIds.map((id) => sqlString(id)).join(', ')
    lines.push(`DELETE FROM product_purchase_rates WHERE product_id IN (${inList});`)
  }
  for (const r of purchaseRows) {
    lines.push(`
INSERT INTO product_purchase_rates (id, product_id, unit_rate_paise, effective_from, effective_to, notes, created_at, updated_at)
VALUES (
  ${Number(r.id)},
  ${sqlString(r.product_id)},
  ${Number(r.unit_rate_paise)},
  ${sqlString(r.effective_from)},
  ${r.effective_to ? sqlString(r.effective_to) : 'NULL'},
  ${r.notes ? sqlString(r.notes) : 'NULL'},
  ${sqlString(r.created_at)},
  ${sqlString(r.updated_at)}
);
`.trim())
  }
  if (categoryRows.length) {
    lines.push('-- Restore categories snapshot (label/sort/created_at/updated_at from pre-apply)')
    lines.push(...buildCategoryUpsertSql(categoryRows, restoreOpts))
  }
  const backupSlugs = new Set(categoryRows.map((c) => String(c.slug)))
  const slugsToRemove = categorySlugsInsertedByApply
    .map((s) => String(s).trim())
    .filter((slug) => slug && !backupSlugs.has(slug))
  if (slugsToRemove.length) {
    const inList = [...new Set(slugsToRemove)].map((slug) => sqlString(slug)).join(', ')
    lines.push(
      `-- Remove categor(ies) inserted during replace only when no products reference them (FK-safe).`,
      `DELETE FROM categories WHERE slug IN (${inList}) AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_slug = categories.slug);`,
    )
  }
  return `${lines.join('\n\n')}\n`
}

/** @param {unknown} value @param {string} [field] */
function compareScalar(value, field) {
  if (value === null || value === undefined) return null
  if (
    field === 'selling_price_paise' ||
    field === 'final_price_paise' ||
    field === 'pieces_per_pack' ||
    field === 'sort_order'
  ) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = String(value).trim()
  return s === '' ? null : s
}

const PRODUCT_VERIFY_FIELDS = [
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
  'final_price_paise',
  'pieces_per_pack',
  'allow_loose_sale',
]

/**
 * Post-apply verification against local source of truth (pure; no remote I/O).
 *
 * @param {{
 *   localCategories: Record<string, unknown>[],
 *   localProducts: Record<string, unknown>[],
 *   localRateMap: Map<string, { unit_rate_paise: number }>,
 *   preservedRemoteOnlySlugs: string[],
 *   retainedProductIds: string[],
 *   remoteCategories: Record<string, unknown>[],
 *   remoteProducts: Record<string, unknown>[],
 *   remoteCurrentRates: Map<string, number>,
 * }} input
 */
export function verifyReplaceAgainstLocal(input) {
  const {
    localCategories,
    localProducts,
    localRateMap,
    preservedRemoteOnlySlugs,
    retainedProductIds,
    remoteCategories,
    remoteProducts,
    remoteCurrentRates,
  } = input

  /** @type {string[]} */
  const problems = []
  const remoteCatBySlug = new Map(remoteCategories.map((c) => [String(c.slug), c]))
  const remoteProdById = new Map(remoteProducts.map((p) => [String(p.id), p]))

  const expectedCategoryCount = localCategories.length + preservedRemoteOnlySlugs.length

  if (remoteCategories.length !== expectedCategoryCount) {
    problems.push(
      `category COUNT is ${remoteCategories.length}, expected ${expectedCategoryCount} (local ${localCategories.length} + remote-only preserved ${preservedRemoteOnlySlugs.length})`,
    )
  }

  for (const row of localCategories) {
    const slug = String(row.slug)
    const remote = remoteCatBySlug.get(slug)
    if (!remote) {
      problems.push(`missing local category slug on remote: ${slug}`)
      continue
    }
    if (String(remote.label ?? '') !== String(row.label ?? '')) {
      problems.push(`category ${slug} label mismatch (remote "${remote.label}" vs local "${row.label}")`)
    }
    if ((Number(remote.sort_order) || 0) !== (Number(row.sort_order) || 0)) {
      problems.push(
        `category ${slug} sort_order mismatch (remote ${remote.sort_order} vs local ${row.sort_order})`,
      )
    }
  }

  for (const slug of preservedRemoteOnlySlugs) {
    if (!remoteCatBySlug.has(slug)) {
      problems.push(`preserved remote-only category missing after apply: ${slug}`)
    }
  }

  const expectedProductCount = localProducts.length + retainedProductIds.length
  if (remoteProducts.length !== expectedProductCount) {
    problems.push(
      `product COUNT is ${remoteProducts.length}, expected ${expectedProductCount} (local ${localProducts.length} + retained production-only ${retainedProductIds.length})`,
    )
  }

  for (const local of localProducts) {
    const id = String(local.id)
    const remote = remoteProdById.get(id)
    if (!remote) {
      problems.push(`missing local product on remote: ${id}`)
      continue
    }
    for (const field of PRODUCT_VERIFY_FIELDS) {
      const a = compareScalar(local[field], field)
      const b = compareScalar(remote[field], field)
      if (field === 'featured' || field === 'active' || field === 'allow_loose_sale') {
        const la = Number(local[field]) ? 1 : 0
        const rb = Number(remote[field]) ? 1 : 0
        if (la !== rb) {
          problems.push(`product ${id} field ${field} mismatch (remote ${rb} vs local ${la})`)
        }
        continue
      }
      if (a !== b && !(a === null && b === null)) {
        problems.push(`product ${id} field ${field} mismatch`)
      }
    }
    const expectedRate = localRateMap.get(id)
    if (expectedRate && Number.isFinite(Number(expectedRate.unit_rate_paise))) {
      const remoteRate = remoteCurrentRates.get(id)
      if (remoteRate !== Number(expectedRate.unit_rate_paise)) {
        problems.push(
          `product ${id} current purchase rate mismatch (remote ${remoteRate ?? 'none'} vs local ${expectedRate.unit_rate_paise})`,
        )
      }
    }
  }

  for (const id of retainedProductIds) {
    if (!remoteProdById.has(id)) {
      problems.push(`retained production-only product missing on remote: ${id}`)
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    expected: {
      categoryCount: expectedCategoryCount,
      productCount: expectedProductCount,
    },
  }
}

/**
 * @param {number} exportedLength
 * @param {number | null} countFromQuery
 * @param {string} label
 */
function assertBackupRowCount(exportedLength, countFromQuery, label) {
  if (countFromQuery === null || !Number.isFinite(countFromQuery)) {
    throw new Error(`Backup ${label}: remote COUNT(*) could not be verified. Aborting apply.`)
  }
  if (exportedLength !== countFromQuery) {
    throw new Error(
      `Backup ${label}: exported ${exportedLength} row(s) but COUNT(*) is ${countFromQuery}. Aborting apply.`,
    )
  }
}

/**
 * @param {Record<string, unknown>[]} localCategories
 * @param {Record<string, unknown>[]} localProducts
 * @param {Map<string, { unit_rate_paise: number, notes?: string }>} localRates
 * @param {string[]} deletableIds
 */
export function buildApplyPhaseSql(localCategories, localProducts, localRates, deletableIds) {
  const localIds = localProducts.map((p) => String(p.id)).sort()
  const header =
    '-- Remote D1 via wrangler: no SQL BEGIN/COMMIT (use phased files + verification; not atomic).\n'
  const categoriesBody = buildCategoryUpsertSql(localCategories).join('\n\n')
  const productsBody = buildProductUpsertSql(localProducts).join('\n\n')
  const ratesBody = buildPurchaseRateSyncSql(localRates, localIds).join('\n\n')
  const deletesBody = buildDeleteSql(deletableIds).join('\n\n')
  return {
    combined: `${header}\n-- Phase 1: categories\n${categoriesBody}\n\n-- Phase 2: products\n${productsBody}\n\n-- Phase 3: purchase rates\n${ratesBody}\n\n-- Phase 4: deletes\n${deletesBody}\n`,
    categories: `${header}-- Phase 1: category upserts (${localCategories.length})\n${categoriesBody}\n`,
    products: `${header}-- Phase 2: product upserts (${localProducts.length})\n${productsBody}\n`,
    purchaseRates: `${header}-- Phase 3: current purchase rates from local\n${ratesBody}\n`,
    deletes: `${header}-- Phase 4: remove unreferenced production-only products\n${deletesBody}\n`,
  }
}

function applyRemoteSqlFile(sqlPath, phaseName) {
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--file', sqlPath], {
      cwd: SERVER_ROOT,
      encoding: 'utf8',
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
  } catch (err) {
    const detail = String(err.stderr ?? err.stdout ?? err.message ?? err)
    throw new Error(`Remote apply phase "${phaseName}" failed: ${detail.slice(0, 2000)}`)
  }
}

function readRemotePostApplyState() {
  const categoryCount = Number(d1Query(SERVER_ROOT, 'remote', 'SELECT COUNT(*) AS n FROM categories')[0]?.n)
  const productCount = Number(d1Query(SERVER_ROOT, 'remote', 'SELECT COUNT(*) AS n FROM products')[0]?.n)
  const remoteCategories = d1Query(SERVER_ROOT, 'remote', CATEGORY_SELECT)
  const remoteProducts = normalizeProductIds(
    d1Query(SERVER_ROOT, 'remote', PRODUCT_SELECT),
    'remote-verify',
  )
  const remoteRateRows = d1Query(SERVER_ROOT, 'remote', PURCHASE_CURRENT_SELECT)
  const remoteCurrentRates = new Map(
    remoteRateRows.map((r) => [String(r.product_id), Number(r.unit_rate_paise)]),
  )
  return {
    categoryCount: Number.isFinite(categoryCount) ? categoryCount : null,
    productCount: Number.isFinite(productCount) ? productCount : null,
    remoteCategories,
    remoteProducts,
    remoteCurrentRates,
  }
}

/**
 * @param {{
 *   localCategories: Record<string, unknown>[],
 *   localProducts: Record<string, unknown>[],
 *   localRateMap: Map<string, { unit_rate_paise: number }>,
 *   preservedRemoteOnlySlugs: string[],
 *   retainedProductIds: string[],
 * }} expected
 */
function verifyRemoteReplaceComplete(expected) {
  const snap = readRemotePostApplyState()
  const result = verifyReplaceAgainstLocal({
    ...expected,
    remoteCategories: snap.remoteCategories,
    remoteProducts: snap.remoteProducts,
    remoteCurrentRates: snap.remoteCurrentRates,
  })
  if (snap.categoryCount !== null && snap.remoteCategories.length !== snap.categoryCount) {
    result.problems.push(
      `remote category export incomplete (${snap.remoteCategories.length} rows vs COUNT ${snap.categoryCount})`,
    )
    result.ok = false
  }
  if (snap.productCount !== null && snap.remoteProducts.length !== snap.productCount) {
    result.problems.push(
      `remote product export incomplete (${snap.remoteProducts.length} rows vs COUNT ${snap.productCount})`,
    )
    result.ok = false
  }
  return { ...result, snap }
}

/**
 * @param {string[]} phaseFilesExecuted
 * @param {ReturnType<typeof readRemotePostApplyState>} snap
 * @param {{ rollbackSqlPath?: string | null, backupJsonPath?: string | null }} [paths]
 */
function reportPartialApplyFailure(phaseFilesExecuted, snap, paths = {}) {
  const wroteRemote = phaseFilesExecuted.length > 0
  console.error('\nApply did not finish. Remote D1 is NOT guaranteed consistent.')
  console.error('Phases completed before failure:', phaseFilesExecuted.join(' → ') || '(none)')
  console.error(`Rollback required: ${wroteRemote ? 'YES — remote was modified' : 'NO — no apply phases completed'}`)
  if (paths.rollbackSqlPath) {
    console.error(`Rollback SQL: ${paths.rollbackSqlPath}`)
  }
  if (paths.backupJsonPath) {
    console.error(`Pre-apply backup JSON: ${paths.backupJsonPath}`)
  }
  console.error(
    'Current remote snapshot:',
    JSON.stringify(
      {
        categoryCount: snap.categoryCount,
        productCount: snap.productCount,
        categorySlugs: snap.remoteCategories?.map((c) => String(c.slug)) ?? [],
        productIdsSample: snap.remoteProducts?.slice(0, 5).map((p) => String(p.id)) ?? [],
      },
      null,
      2,
    ),
  )
  if (wroteRemote) {
    console.error(
      'Run the rollback SQL from this apply attempt, then verify remote state (best-effort, not atomic).',
    )
  }
}

function main() {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    console.log(`Replace production products with local D1 catalogue (local = source of truth).

  node scripts/replace-products-local-to-remote.mjs           Dry-run plan
  node scripts/replace-products-local-to-remote.mjs --apply   Backup + apply (remote)

Local:  wrangler d1 ${DB_NAME} --local
Remote: wrangler d1 ${DB_NAME} --remote (${DB_ID})

Outputs:
  ${path.relative(SERVER_ROOT, REPORT_PATH)}
  ${path.relative(SERVER_ROOT, APPLY_SQL)}
  ${path.relative(SERVER_ROOT, BACKUP_DIR)}/products-replace-remote-backup-<ts>.json
  ${path.relative(SERVER_ROOT, BACKUP_DIR)}/products-replace-remote-rollback-<ts>.sql

Upserts categories from local D1 before products (remote-only category slugs are preserved).
Does NOT modify private_rates, requests, quotations, family packs, or admin tables.`)
    process.exit(0)
  }

  console.log('Reading local categories (source of truth)…')
  const localCategories = d1Query(SERVER_ROOT, 'local', CATEGORY_SELECT)

  console.log('Reading local products (source of truth)…')
  const localProducts = normalizeProductIds(d1Query(SERVER_ROOT, 'local', PRODUCT_SELECT), 'local')
  const localPurchaseRows = d1Query(SERVER_ROOT, 'local', PURCHASE_CURRENT_SELECT)
  const localRateMap = new Map(
    localPurchaseRows.map((r) => [
      String(r.product_id),
      { unit_rate_paise: Number(r.unit_rate_paise), notes: r.notes },
    ]),
  )

  console.log('Reading remote products (for plan)…')
  const remoteCountRow = d1Query(SERVER_ROOT, 'remote', 'SELECT COUNT(*) AS n FROM products')
  const remoteCountReported = Number(remoteCountRow[0]?.n)
  const remoteProducts = normalizeProductIds(d1Query(SERVER_ROOT, 'remote', PRODUCT_SELECT), 'remote')
  const remotePurchaseAll = d1Query(SERVER_ROOT, 'remote', PURCHASE_ALL_FOR_PRODUCTS)
  const remoteCategories = d1Query(SERVER_ROOT, 'remote', CATEGORY_SELECT)
  const remoteCategorySlugs = remoteCategories.map((r) => String(r.slug)).filter(Boolean)
  const categoryPlan = planCategorySync(localCategories, remoteCategories)

  assertRemoteCatalogueVerified({
    remoteProductCount: Number.isFinite(remoteCountReported) ? remoteCountReported : null,
    remoteProducts,
    remoteCategorySlugs,
    localProductCount: localProducts.length,
  })

  const localIds = new Set(localProducts.map((p) => String(p.id)))
  const remoteIds = new Set(remoteProducts.map((p) => String(p.id)))

  const inserts = localProducts.filter((p) => !remoteIds.has(String(p.id))).map((p) => String(p.id))
  const replaces = localProducts.filter((p) => remoteIds.has(String(p.id))).map((p) => String(p.id))

  const refPlan = referenceSummary(remoteProducts, localIds)

  const localCategorySlugs = new Set(localCategories.map((c) => String(c.slug)))
  const productCategorySlugsMissingLocally = [
    ...new Set(localProducts.map((p) => String(p.category_slug))),
  ].filter((s) => !localCategorySlugs.has(s))

  const imageProblems = auditImages(localProducts)

  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  const applySql = buildApplyPhaseSql(
    localCategories,
    localProducts,
    localRateMap,
    refPlan.deletable,
  )
  fs.writeFileSync(APPLY_SQL, applySql.combined, 'utf8')
  fs.writeFileSync(APPLY_CATEGORIES_SQL, applySql.categories, 'utf8')
  fs.writeFileSync(APPLY_PRODUCTS_SQL, applySql.products, 'utf8')
  fs.writeFileSync(APPLY_RATES_SQL, applySql.purchaseRates, 'utf8')
  fs.writeFileSync(APPLY_DELETES_SQL, applySql.deletes, 'utf8')

  let backupJsonPath = null
  let rollbackSqlPath = null

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'replace-local-as-source-of-truth',
    source: {
      local: `wrangler d1 ${DB_NAME} --local (Miniflare under server/.wrangler/state/v3/d1/)`,
      remote: `wrangler d1 ${DB_NAME} --remote, database_id ${DB_ID}`,
    },
    counts: {
      localCategories: localCategories.length,
      remoteCategoriesBefore: remoteCategories.length,
      categoryUpsertsFromLocal: categoryPlan.upsertCount,
      categoryInsertsOnRemote: categoryPlan.insertOnRemote.length,
      categoryUpdatesFromLocal: categoryPlan.updateFromLocal.length,
      categoryPreservedRemoteOnly: categoryPlan.preservedRemoteOnly.length,
      localProducts: localProducts.length,
      remoteProductsBefore: remoteProducts.length,
      remoteProductsReportedByCount: Number.isFinite(remoteCountReported) ? remoteCountReported : null,
      upsertFromLocal: localProducts.length,
      insertNewOnRemote: inserts.length,
      replaceExistingOnRemote: replaces.length,
      deleteProductionOnlyUnreferenced: refPlan.deletable.length,
      retainProductionOnlyReferenced: refPlan.retainedDueToReferences.length,
      localWithSellingPricePaise: localProducts.filter(
        (p) => p.selling_price_paise != null && Number(p.selling_price_paise) > 0,
      ).length,
      localWithCurrentPurchaseRate: localRateMap.size,
    },
    actions: {
      upsertAllLocalProductIds: localProducts.map((p) => String(p.id)),
      insertIds: inserts,
      replaceIds: replaces,
      deleteIds: refPlan.deletable,
      retainedProductionOnly: refPlan.retainedDueToReferences.map((p) => ({
        id: p.id,
        name: p.name,
        references: p.refs,
        impact:
          'Row stays in D1 after sync (not in local catalogue). Still referenced by requests, quotations, or family packs; deleting would break FK integrity.',
      })),
    },
    categories: {
      upsertSlugs: localCategories.map((c) => String(c.slug)),
      insertOnRemote: categoryPlan.insertOnRemote,
      updateFromLocal: categoryPlan.updateFromLocal,
      preservedRemoteOnly: categoryPlan.preservedRemoteOnly,
      productCategorySlugsMissingLocally,
    },
    imageValidation: { invalidProducts: imageProblems },
    sellingPriceRule: 'Writes only products.selling_price_paise. private_rates (X4) unchanged.',
    files: {
      applySql: path.relative(SERVER_ROOT, APPLY_SQL),
      preReplaceBackupJson: null,
      targetedRollbackSql: null,
    },
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')

  console.log('\n=== Replace catalogue plan (local → remote) ===')
  console.log(JSON.stringify(report.counts, null, 2))
  if (categoryPlan.insertOnRemote.length) {
    console.log(
      `\nCategories to insert on remote: ${categoryPlan.insertOnRemote.map((c) => c.slug).join(', ')}`,
    )
  }
  if (productCategorySlugsMissingLocally.length) {
    console.warn(
      '\nBLOCKER: product category_slug(s) missing from local categories table:',
      productCategorySlugsMissingLocally,
    )
  }
  if (imageProblems.length) {
    console.warn(`\nBLOCKER: ${imageProblems.length} product(s) have invalid image refs.`)
  }
  if (refPlan.retainedDueToReferences.length) {
    console.warn(
      `\nNote: ${refPlan.retainedDueToReferences.length} production-only product(s) will REMAIN (referenced). See report actions.retainedProductionOnly.`,
    )
  }
  console.log(`\nReport: ${REPORT_PATH}`)
  console.log(`Apply SQL: ${APPLY_SQL}`)
  if (backupJsonPath) {
    console.log(`Pre-replace backup (JSON): ${backupJsonPath}`)
    console.log(`Targeted rollback SQL: ${rollbackSqlPath}`)
  } else {
    console.log('Backup/rollback files are written only when you run --apply (from a fresh remote snapshot).')
  }

  if (!opts.apply) {
    console.log('\nDry-run only — no remote writes.')
    console.log('After reviewing the report, apply with:')
    console.log('  cd server && node scripts/replace-products-local-to-remote.mjs --apply')
    return
  }

  if (productCategorySlugsMissingLocally.length || imageProblems.length) {
    console.error('\nApply aborted due to blockers above.')
    process.exit(2)
  }

  if (localProducts.length > 0 && remoteProducts.length === 0) {
    console.error(
      '\nApply aborted: remote product export is empty. Re-run when wrangler remote reads succeed.',
    )
    process.exit(2)
  }

  const ts = timestampUtcCompact()
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  backupJsonPath = path.join(BACKUP_DIR, `products-replace-remote-backup-${ts}.json`)
  rollbackSqlPath = path.join(BACKUP_DIR, `products-replace-remote-rollback-${ts}.sql`)
  console.log(
    '\nCapturing targeted remote backup (categories + products + product_purchase_rates)…',
  )
  const remoteCategoryCount = Number(
    d1Query(SERVER_ROOT, 'remote', 'SELECT COUNT(*) AS n FROM categories')[0]?.n,
  )
  const remoteCategoriesFresh = d1Query(SERVER_ROOT, 'remote', CATEGORY_SELECT)
  const remoteProductCountFresh = Number(
    d1Query(SERVER_ROOT, 'remote', 'SELECT COUNT(*) AS n FROM products')[0]?.n,
  )
  const remoteProductsFresh = normalizeProductIds(
    d1Query(SERVER_ROOT, 'remote', PRODUCT_SELECT),
    'remote-backup',
  )
  const remotePurchaseCount = Number(
    d1Query(SERVER_ROOT, 'remote', 'SELECT COUNT(*) AS n FROM product_purchase_rates')[0]?.n,
  )
  const remotePurchaseFresh = d1Query(SERVER_ROOT, 'remote', PURCHASE_ALL_FOR_PRODUCTS)

  try {
    assertBackupRowCount(remoteCategoriesFresh.length, remoteCategoryCount, 'categories')
    assertBackupRowCount(remoteProductsFresh.length, remoteProductCountFresh, 'products')
    assertBackupRowCount(remotePurchaseFresh.length, remotePurchaseCount, 'product_purchase_rates')
  } catch (err) {
    console.error(String(err.message ?? err))
    process.exit(2)
  }

  const categorySlugsInsertedByApply = categoryPlan.insertOnRemote.map((c) => c.slug)
  const productIdsInsertedByApply = inserts

  fs.writeFileSync(
    backupJsonPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        categories: remoteCategoriesFresh,
        products: remoteProductsFresh,
        product_purchase_rates: remotePurchaseFresh,
      },
      null,
      2,
    ),
    'utf8',
  )
  fs.writeFileSync(
    rollbackSqlPath,
    buildRollbackSql(
      remoteCategoriesFresh,
      remoteProductsFresh,
      remotePurchaseFresh,
      categorySlugsInsertedByApply,
      productIdsInsertedByApply,
    ),
    'utf8',
  )
  console.log(`Backup: ${backupJsonPath}`)
  console.log(`Rollback: ${rollbackSqlPath}`)

  const verifyInput = {
    localCategories,
    localProducts,
    localRateMap,
    preservedRemoteOnlySlugs: categoryPlan.preservedRemoteOnly,
    retainedProductIds: refPlan.retainedDueToReferences.map((p) => p.id),
  }
  /** @type {string[]} */
  const phasesDone = []
  try {
    console.log('\nPhase 1/4: category upserts…')
    applyRemoteSqlFile(APPLY_CATEGORIES_SQL, 'categories')
    phasesDone.push('categories')

    console.log('\nPhase 2/4: product upserts…')
    applyRemoteSqlFile(APPLY_PRODUCTS_SQL, 'products')
    phasesDone.push('products')

    console.log('\nPhase 3/4: purchase rates…')
    applyRemoteSqlFile(APPLY_RATES_SQL, 'purchase-rates')
    phasesDone.push('purchase-rates')

    if (refPlan.deletable.length) {
      console.log('\nPhase 4/4: production-only deletes…')
      applyRemoteSqlFile(APPLY_DELETES_SQL, 'deletes')
      phasesDone.push('deletes')
    } else {
      console.log('\nPhase 4/4: skipped (no deletable production-only products).')
    }

    const verify = verifyRemoteReplaceComplete(verifyInput)
    if (!verify.ok) {
      console.error('\nApply phases ran but verification failed:')
      for (const p of verify.problems) console.error(`  - ${p}`)
      reportPartialApplyFailure(phasesDone, verify.snap, { rollbackSqlPath, backupJsonPath })
      process.exit(1)
    }
  } catch (err) {
    console.error(String(err.message ?? err))
    let snap
    try {
      snap = readRemotePostApplyState()
    } catch {
      snap = { categoryCount: null, productCount: null, remoteCategories: [], remoteProducts: [] }
    }
    reportPartialApplyFailure(phasesDone, snap, { rollbackSqlPath, backupJsonPath })
    process.exit(1)
  }

  console.log('\nApply finished and verification passed (remote is not atomic; rollback SQL is best-effort).')
  console.log('If rollback is needed, use the targeted rollback SQL from this run’s backup step.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
