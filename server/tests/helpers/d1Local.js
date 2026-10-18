import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DB_NAME = 'diwali-quotation'

function runWranglerD1File(filePath, json) {
  const args = ['wrangler', 'd1', 'execute', DB_NAME, '--local', '--file', filePath]
  if (json) args.push('--json')
  try {
    return execFileSync('npx', args, {
      cwd: SERVER_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
  } catch (err) {
    const stderr = String(err.stderr ?? '')
    const stdout = String(err.stdout ?? '')
    const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
    const wrapped = new Error(`wrangler d1 execute failed: ${detail || err.message}`)
    wrapped.cause = err
    throw wrapped
  }
}

/**
 * Run SQL against local D1 via Wrangler CLI (no remote credentials).
 * DML defaults to no --json (avoids treating constraint errors as opaque CLI failures).
 * @param {string} sql
 * @param {{ json?: boolean }} [opts]
 */
export function d1ExecLocal(sql, opts = {}) {
  const json = opts.json === true
  const filePath = path.join(
    os.tmpdir(),
    `diwali-d1-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
  )
  fs.writeFileSync(filePath, sql, 'utf8')
  try {
    const out = runWranglerD1File(filePath, json)
    if (!json) return out ?? ''
    try {
      return JSON.parse(out)
    } catch {
      return out
    }
  } finally {
    try {
      fs.unlinkSync(filePath)
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} sql
 * @returns {Record<string, unknown>[]}
 */
export function d1QueryLocal(sql) {
  const parsed = d1ExecLocal(sql, { json: true })
  if (Array.isArray(parsed) && parsed[0]?.results) {
    return parsed[0].results
  }
  if (parsed?.results) {
    return parsed.results
  }
  return []
}

export function applyLocalMigrations() {
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', DB_NAME, '--local'], {
    cwd: SERVER_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
}

export { SERVER_ROOT, DB_NAME }
