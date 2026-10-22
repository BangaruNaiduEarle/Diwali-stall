import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { describe, it } from 'node:test'
import {
  localD1LockFilePath,
  tryRemoveStaleLock,
  withLocalD1Lock,
} from '../scripts/lib/localD1Lock.mjs'

function writeLock(contents) {
  fs.writeFileSync(localD1LockFilePath(), contents, 'utf8')
}

function removeLockIfPresent() {
  try {
    fs.unlinkSync(localD1LockFilePath())
  } catch {
    /* absent */
  }
}

describe('local D1 exclusive lock', () => {
  it('runs exclusive sections sequentially in one process', () => {
    const order = []
    withLocalD1Lock(() => {
      order.push('a')
    })
    withLocalD1Lock(() => {
      order.push('b')
    })
    assert.deepEqual(order, ['a', 'b'])
  })
})

describe('local D1 stale lock cleanup', () => {
  it('removes lock immediately when recorded PID is not running', () => {
    removeLockIfPresent()
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
      encoding: 'utf8',
    })
    assert.equal(child.status, 0)
    const deadPid = child.stdout.trim()
    writeLock(`${deadPid}\n`)
    assert.ok(fs.existsSync(localD1LockFilePath()))
    tryRemoveStaleLock()
    assert.ok(!fs.existsSync(localD1LockFilePath()))
  })

  it('keeps lock when recorded PID is the current process', () => {
    removeLockIfPresent()
    writeLock(`${process.pid}\n`)
    tryRemoveStaleLock()
    assert.ok(fs.existsSync(localD1LockFilePath()))
    removeLockIfPresent()
  })

  it('does not remove recent lock with malformed contents', () => {
    removeLockIfPresent()
    writeLock('not-a-pid\n')
    tryRemoveStaleLock()
    assert.ok(fs.existsSync(localD1LockFilePath()))
    removeLockIfPresent()
  })
})
