import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'

export const DB_NAME = 'diwali-quotation'

/** Wrangler 4.x remote `--file` JSON returns execution stats, not SELECT rows. */
const WRANGLER_SUMMARY_KEYS = new Set([
  'Total queries executed',
  'Rows read',
  'Rows written',
  'Database size (MB)',
])

/**
 * @param {unknown} row
 */
export function isWranglerFileSummaryRow(row) {
  if (!row || typeof row !== 'object') return false
  const keys = Object.keys(row)
  if (!keys.length) return false
  return keys.every((k) => WRANGLER_SUMMARY_KEYS.has(k) || k === 'success')
}

/**
 * @param {unknown} stdout
 * @returns {unknown[]}
 */
export function parseWranglerExecuteJson(stdout) {
  const text = String(stdout ?? '')
  const start = text.indexOf('[')
  if (start < 0) {
    throw new Error('d1WranglerQuery: no JSON array in wrangler output')
  }
  let parsed
  try {
    parsed = JSON.parse(text.slice(start))
  } catch (err) {
    throw new Error(`d1WranglerQuery: invalid JSON in wrangler output: ${err?.message ?? err}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error('d1WranglerQuery: expected top-level JSON array from wrangler --json')
  }
  return parsed
}

/**
 * @param {unknown[]} wranglerJson
 * @param {{ allowSummaryOnly?: boolean }} [opts]
 */
export function extractWranglerResultRows(wranglerJson, opts = {}) {
  /** @type {Record<string, unknown>[]} */
  const rows = []
  let sawSummary = false
  for (const chunk of wranglerJson) {
    if (!chunk || typeof chunk !== 'object') continue
    const results = /** @type {{ results?: unknown[] }} */ (chunk).results
    if (!Array.isArray(results)) continue
    for (const row of results) {
      if (isWranglerFileSummaryRow(row)) {
        sawSummary = true
        continue
      }
      if (row && typeof row === 'object') {
        rows.push(/** @type {Record<string, unknown>} */ (row))
      }
    }
  }
  if (!opts.allowSummaryOnly && rows.length === 0 && sawSummary) {
    throw new Error(
      'd1WranglerQuery: wrangler returned only file-execution summary rows (no query data). ' +
        'On remote D1, use --command instead of --file for SELECT.',
    )
  }
  return rows
}

/**
 * @param {string} serverRoot
 * @param {'local' | 'remote'} target
 * @param {string} sql
 */
function runWranglerSelect(serverRoot, target, sql) {
  const trimmed = String(sql ?? '').trim().replace(/;\s*$/, '')
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error('d1Query: only SELECT/WITH allowed')
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH)\b/i.test(trimmed)) {
    throw new Error('d1Query: mutating SQL is not allowed')
  }

  let stdout = ''
  let stderr = ''

  if (target === 'remote') {
    // Remote `--command` must be one line (Windows cmd + wrangler API); `--file` returns stats only.
    const oneLine = trimmed.replace(/\s+/g, ' ').trim()
    const quoted = oneLine.replace(/"/g, '""')
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --json --command "${quoted}"`
    try {
      stdout = execSync(cmd, {
        cwd: serverRoot,
        encoding: 'utf8',
        maxBuffer: 80 * 1024 * 1024,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      stderr = String(err.stderr ?? '')
      stdout = String(err.stdout ?? '')
      const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      throw new Error(`d1Query remote failed: ${detail.slice(0, 2500)}`)
    }
  } else {
    const filePath = path.join(
      os.tmpdir(),
      `diwali-d1-local-${process.pid}-${Date.now()}.sql`,
    )
    fs.writeFileSync(filePath, `${trimmed};\n`, 'utf8')
    try {
      stdout = execFileSync(
        'npx',
        ['wrangler', 'd1', 'execute', DB_NAME, '--local', '--json', '--file', filePath, '-y'],
        {
          cwd: serverRoot,
          encoding: 'utf8',
          maxBuffer: 80 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        },
      )
    } catch (err) {
      stderr = String(err.stderr ?? '')
      stdout = String(err.stdout ?? '')
      const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      throw new Error(`d1Query local failed: ${detail.slice(0, 2500)}`)
    } finally {
      try {
        fs.unlinkSync(filePath)
      } catch {
        /* ignore */
      }
    }
  }

  const parsed = parseWranglerExecuteJson(stdout)
  return extractWranglerResultRows(parsed)
}

/** @param {string} serverRoot @param {'local' | 'remote'} target @param {string} sql */
export function d1Query(serverRoot, target, sql) {
  return runWranglerSelect(serverRoot, target, sql)
}

/**
 * Fail closed when remote catalogue reads look empty/unverified.
 * @param {{
 *   remoteProductCount: number | null,
 *   remoteProducts: unknown[],
 *   remoteCategorySlugs: string[],
 *   localProductCount: number,
 * }} input
 */
export function assertRemoteCatalogueVerified(input) {
  const { remoteProductCount, remoteProducts, remoteCategorySlugs, localProductCount } = input
  if (remoteProductCount === null || !Number.isFinite(remoteProductCount)) {
    throw new Error(
      'Remote product COUNT could not be verified. Aborting plan (fail closed).',
    )
  }
  if (remoteProductCount > 0 && remoteProducts.length === 0) {
    throw new Error(
      `Remote COUNT is ${remoteProductCount} but product export returned 0 rows. Aborting plan (fail closed).`,
    )
  }
  if (localProductCount > 0 && remoteCategorySlugs.length === 0) {
    throw new Error(
      'Remote categories export is empty. Aborting plan (fail closed).',
    )
  }
}

export function sqlString(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

export function timestampUtcCompact() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

const PRODUCT_ID_RE = /^P\d+$/

/** @param {Record<string, unknown>[]} rows @param {string} label */
export function normalizeProductIds(rows, label) {
  const valid = []
  let rejected = 0
  for (const row of rows) {
    const id = String(row?.id ?? '').trim()
    if (!PRODUCT_ID_RE.test(id)) {
      rejected += 1
      continue
    }
    valid.push({ ...row, id })
  }
  if (rejected) {
    throw new Error(
      `${label}: ${rejected} row(s) missing a valid P### id (remote read may be corrupt).`,
    )
  }
  return valid
}
