import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hashPassword,
  hashPasswordWithIterations,
  LEGACY_PBKDF2_ITERATIONS,
  needsPasswordRehash,
  parseStoredPasswordHash,
  PBKDF2_ITERATIONS,
  verifyPassword,
  WEB_CRYPTO_MAX_PBKDF2_ITERATIONS,
} from '../src/lib/passwordHash.js'

describe('passwordHash Workers PBKDF2', () => {
  it('new hashes use Web Crypto max iterations (100000)', async () => {
    assert.equal(PBKDF2_ITERATIONS, WEB_CRYPTO_MAX_PBKDF2_ITERATIONS)
    assert.equal(WEB_CRYPTO_MAX_PBKDF2_ITERATIONS, 100_000)
    const stored = await hashPassword('twelve-char-pw')
    const parsed = parseStoredPasswordHash(stored)
    assert.ok(parsed)
    assert.equal(parsed.iterations, 100_000)
    assert.equal(await verifyPassword('twelve-char-pw', stored), true)
    assert.equal(await verifyPassword('wrong-password', stored), false)
    assert.equal(needsPasswordRehash(stored), false)
  })

  it('verifies legacy 210000-iteration hashes and marks them for rehash', async () => {
    const password = 'legacy-twelve-chars'
    const stored = await hashPasswordWithIterations(password, LEGACY_PBKDF2_ITERATIONS)
    const parsed = parseStoredPasswordHash(stored)
    assert.ok(parsed)
    assert.equal(parsed.iterations, 210_000)
    assert.equal(await verifyPassword(password, stored), true)
    assert.equal(await verifyPassword('legacy-twelve-wrong', stored), false)
    assert.equal(needsPasswordRehash(stored), true)
  })

  it('rejects malformed stored hashes', async () => {
    assert.equal(await verifyPassword('pw', ''), false)
    assert.equal(await verifyPassword('pw', 'bcrypt$12$salt$hash'), false)
    assert.equal(await verifyPassword('pw', 'pbkdf2_sha256$100000$!!!$!!!'), false)
    assert.equal(parseStoredPasswordHash('pbkdf2_sha256$9999$abc$def'), null)
    assert.equal(parseStoredPasswordHash('pbkdf2_sha256$999999$abc$def'), null)
  })

  it('encode parameters in stored string for verification', async () => {
    const a = await hashPassword('same-password12')
    const b = await hashPassword('same-password12')
    assert.notEqual(a, b)
    assert.equal(await verifyPassword('same-password12', a), true)
    assert.equal(await verifyPassword('same-password12', b), true)
  })
})
