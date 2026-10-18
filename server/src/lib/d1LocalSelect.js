/**
 * Read-only local D1 queries via Wrangler CLI (SELECT-only guard).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DB_NAME = 'diwali-quotation'

const SELECT_ONLY = /^\s*(SELECT|WITH)\b/i

/**
 * @param {string} sql
 * @returns {Record<string, unknown>[]}
 */
export function d1QueryLocalSelect(sql) {
  const trimmed = String(sql ?? '').trim()
  if (!SELECT_ONLY.test(trimmed)) {
    throw new Error('d1LocalSelect: only SELECT/WITH queries are allowed')
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA)\b/i.test(trimmed)) {
    throw new Error('d1LocalSelect: mutating or schema SQL is not allowed')
  }

  const filePath = path.join(
    os.tmpdir(),
    `diwali-d1-select-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
  )
  fs.writeFileSync(filePath, trimmed, 'utf8')
  try {
    const out = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', DB_NAME, '--local', '--file', filePath, '--json'],
      {
        cwd: SERVER_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      },
    )
    let parsed
    try {
      parsed = JSON.parse(out)
    } catch {
      throw new Error('d1LocalSelect: failed to parse wrangler JSON output')
    }
    if (Array.isArray(parsed) && parsed[0]?.results) {
      return parsed[0].results
    }
    if (parsed?.results) {
      return parsed.results
    }
    return []
  } finally {
    try {
      fs.unlinkSync(filePath)
    } catch {
      /* ignore */
    }
  }
}

/** @returns {Map<string, { id: string, name: string }>} */
export function loadLocalProductsMap() {
  const rows = d1QueryLocalSelect('SELECT id, name FROM products ORDER BY id ASC')
  const map = new Map()
  for (const row of rows) {
    const id = String(row.id ?? '').trim()
    if (!id) continue
    map.set(id, { id, name: String(row.name ?? '').trim() })
  }
  return map
}

/** @returns {Map<string, { id: number, unit_rate_paise: number }>} */
export function loadCurrentPrivateRatesMap() {
  const rows = d1QueryLocalSelect(
    `SELECT id, product_id, unit_rate_paise
     FROM private_rates
     WHERE effective_to IS NULL
     ORDER BY product_id ASC`,
  )
  const map = new Map()
  for (const row of rows) {
    const product_id = String(row.product_id ?? '').trim()
    if (!product_id) continue
    map.set(product_id, {
      id: Number(row.id),
      unit_rate_paise: Number(row.unit_rate_paise),
    })
  }
  return map
}

/** @returns {Map<string, { id: number, unit_rate_paise: number }>} */
export function loadCurrentPurchaseRatesMap() {
  const rows = d1QueryLocalSelect(
    `SELECT id, product_id, unit_rate_paise
     FROM product_purchase_rates
     WHERE effective_to IS NULL
     ORDER BY product_id ASC`,
  )
  const map = new Map()
  for (const row of rows) {
    const product_id = String(row.product_id ?? '').trim()
    if (!product_id) continue
    map.set(product_id, {
      id: Number(row.id),
      unit_rate_paise: Number(row.unit_rate_paise),
    })
  }
  return map
}

export { SERVER_ROOT, DB_NAME }
