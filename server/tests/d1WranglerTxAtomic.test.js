/**
 * Wrangler 4.x local D1: verifies `d1 execute --local --file` uses one db.batch()
 * and rolls back all statements on failure. Uses fixture DB only — never diwali-quotation.
 *
 * Skip: SKIP_WRANGLER_D1_PROBE=1
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/d1-wrangler-tx')
const PERSIST = path.join(FIXTURE, '.persist')
const DB = 'wrangler-tx-isolated-test'
const WRANGLER = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const skip = process.env.SKIP_WRANGLER_D1_PROBE === '1'

function wrangler(args) {
  return execFileSync(WRANGLER, ['wrangler', 'd1', 'execute', DB, '--local', '--persist-to', PERSIST, '--config', 'wrangler.toml', ...args, '-y'], {
    cwd: FIXTURE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

function wranglerJson(args) {
  const out = wrangler([...args, '--json'])
  return JSON.parse(out)
}

function resetPersist() {
  if (fs.existsSync(PERSIST)) {
    fs.rmSync(PERSIST, { recursive: true, force: true })
  }
}

describe('wrangler d1 execute --local --file batch atomicity (isolated)', { skip }, () => {
  it('rolls back earlier INSERTs when a later statement in the same file fails', () => {
    resetPersist()
    wrangler(['--file', '01-schema.sql'])

    let failed = false
    try {
      wrangler(['--file', '02-fail-mid-transaction.sql'])
    } catch (err) {
      failed = true
      const msg = String(err.stderr ?? err.stdout ?? err.message)
      assert.match(msg, /UNIQUE constraint failed|SQLITE_CONSTRAINT/i)
    }
    assert.equal(failed, true, 'expected wrangler exit non-zero on constraint error')

    const count = wranglerJson(['--file', '03-count.sql'])
    assert.equal(Number(count[0]?.results?.[0]?.n), 0)
  })

  it('commits all INSERTs when the batch succeeds', () => {
    resetPersist()
    wrangler(['--file', '01-schema.sql'])
    wrangler(['--file', '04-success-transaction.sql'])
    const count = wranglerJson(['--file', '03-count.sql'])
    assert.equal(Number(count[0]?.results?.[0]?.n), 3)
  })

  it('does not remove prior committed rows when a later batch fails', () => {
    resetPersist()
    wrangler(['--file', '01-schema.sql'])
    wrangler(['--file', '04-success-transaction.sql'])
    try {
      wrangler(['--file', '02-fail-mid-transaction.sql'])
    } catch {
      /* expected */
    }
    const count = wranglerJson(['--file', '03-count.sql'])
    assert.equal(Number(count[0]?.results?.[0]?.n), 3)
  })
})
