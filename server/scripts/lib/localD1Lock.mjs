import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LOCK_FILE = path.join(os.tmpdir(), 'diwali-d1-local-test.lock')
const STALE_LOCK_MS = 5 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 120_000

function sleepMs(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* sync wait — matches d1Local retry style */
  }
}

function parseLockPid(raw) {
  const line = String(raw).trim().split(/\r?\n/)[0] ?? ''
  if (!/^\d+$/.test(line)) return null
  const pid = Number(line)
  if (!Number.isInteger(pid) || pid <= 0) return null
  return pid
}

/** @returns {boolean | null} true = alive, false = definitely dead, null = unknown */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if (err?.code === 'ESRCH') return false
    if (err?.code === 'EPERM') return true
    return null
  }
}

export function localD1LockFilePath() {
  return LOCK_FILE
}

export function tryRemoveStaleLock() {
  try {
    const stat = fs.statSync(LOCK_FILE)
    const ageStale = Date.now() - stat.mtimeMs > STALE_LOCK_MS

    let content
    try {
      content = fs.readFileSync(LOCK_FILE, 'utf8')
    } catch {
      if (ageStale) fs.unlinkSync(LOCK_FILE)
      return
    }

    const pid = parseLockPid(content)
    if (pid !== null) {
      const alive = isProcessAlive(pid)
      if (alive === false) {
        fs.unlinkSync(LOCK_FILE)
        return
      }
      if (alive === true) return
    }

    if (ageStale) {
      fs.unlinkSync(LOCK_FILE)
    }
  } catch {
    /* no lock */
  }
}

/**
 * Exclusive lock for local Wrangler D1 CLI (shared DB file across test + import processes).
 * @template T
 * @param {() => T} fn
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {T}
 */
export function withLocalD1Lock(fn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const started = Date.now()

  while (true) {
    try {
      tryRemoveStaleLock()
      const fd = fs.openSync(LOCK_FILE, 'wx')
      try {
        fs.writeFileSync(fd, `${process.pid}\n`, 'utf8')
        return fn()
      } finally {
        try {
          fs.closeSync(fd)
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(LOCK_FILE)
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      const code = err?.code
      if (code !== 'EEXIST' && code !== 'EPERM') throw err
      if (code === 'EPERM') {
        tryRemoveStaleLock()
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for local D1 lock (${LOCK_FILE}).`)
      }
      sleepMs(100)
    }
  }
}

export function isRetryableLocalD1Error(err) {
  const msg = String(err?.message ?? err)
  return /SQLITE_BUSY|database is locked|NOSENTRY database is locked/i.test(msg)
}

/**
 * @template T
 * @param {() => T} fn
 * @param {{ attempts?: number }} [opts]
 * @returns {T}
 */
export function withLocalD1LockAndRetry(fn, opts = {}) {
  const attempts = opts.attempts ?? 5
  let lastErr
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return withLocalD1Lock(fn)
    } catch (err) {
      lastErr = err
      if (attempt < attempts && isRetryableLocalD1Error(err)) {
        sleepMs(150 * attempt)
        continue
      }
      throw err
    }
  }
  throw lastErr
}
