/**
 * PBKDF2-SHA256 password hashing for Cloudflare Workers.
 * Stored format: pbkdf2_sha256$<iterations>$<saltB64>$<hashB64>
 *
 * Workers Web Crypto limits PBKDF2 iterations to 100_000. New hashes use that maximum.
 * Legacy hashes (e.g. 210_000 from earlier deploys) verify via a JS PBKDF2 fallback, then
 * rehash to 100_000 on successful login (see adminPasswordAuth.js).
 */

/** Strongest iteration count supported by Workers `crypto.subtle` PBKDF2. */
export const WEB_CRYPTO_MAX_PBKDF2_ITERATIONS = 100_000

/** Default for newly generated password hashes. */
export const PBKDF2_ITERATIONS = WEB_CRYPTO_MAX_PBKDF2_ITERATIONS

/** Previously deployed default (verify-only via legacy path). */
export const LEGACY_PBKDF2_ITERATIONS = 210_000

export const MIN_PBKDF2_ITERATIONS = 10_000
export const MAX_PBKDF2_ITERATIONS = LEGACY_PBKDF2_ITERATIONS

export const SALT_BYTES = 16
export const KEY_BYTES = 32

/**
 * @param {number} length
 */
export function randomBytesHex(length) {
  const buf = new Uint8Array(length)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(b64) {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * @param {string} stored
 */
export function parseStoredPasswordHash(stored) {
  const parts = String(stored ?? '').split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return null
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
    return null
  }
  try {
    return {
      iterations,
      salt: fromBase64(parts[2]),
      expected: fromBase64(parts[3]),
    }
  } catch {
    return null
  }
}

/**
 * @param {string} stored
 */
export function needsPasswordRehash(stored) {
  const parsed = parseStoredPasswordHash(stored)
  if (!parsed) return false
  return parsed.iterations !== PBKDF2_ITERATIONS
}

/**
 * @param {string} password
 * @param {Uint8Array} salt
 * @param {number} iterations
 */
async function deriveKeyWebCrypto(password, salt, iterations) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

/**
 * @param {Uint8Array} key
 * @param {Uint8Array} data
 */
async function hmacSha256(key, data) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data)
  return new Uint8Array(sig)
}

/**
 * PBKDF2-HMAC-SHA256 (RFC 2898) for iteration counts above the Workers Web Crypto cap.
 * @param {string} password
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @param {number} dkLen
 */
async function deriveKeyLegacyPbkdf2(password, salt, iterations, dkLen) {
  const passwordBytes = new TextEncoder().encode(password)
  const blocks = Math.ceil(dkLen / 32)
  const derived = new Uint8Array(blocks * 32)
  for (let blockIndex = 1; blockIndex <= blocks; blockIndex += 1) {
    const block = await pbkdf2Block(passwordBytes, salt, iterations, blockIndex)
    derived.set(block, (blockIndex - 1) * 32)
  }
  return derived.slice(0, dkLen)
}

/**
 * @param {Uint8Array} passwordBytes
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @param {number} blockIndex
 */
async function pbkdf2Block(passwordBytes, salt, iterations, blockIndex) {
  const idx = new Uint8Array(4)
  idx[0] = (blockIndex >>> 24) & 0xff
  idx[1] = (blockIndex >>> 16) & 0xff
  idx[2] = (blockIndex >>> 8) & 0xff
  idx[3] = blockIndex & 0xff
  const saltBlock = new Uint8Array(salt.length + 4)
  saltBlock.set(salt, 0)
  saltBlock.set(idx, salt.length)

  let u = await hmacSha256(passwordBytes, saltBlock)
  const out = new Uint8Array(u)
  for (let i = 1; i < iterations; i += 1) {
    u = await hmacSha256(passwordBytes, u)
    for (let j = 0; j < out.length; j += 1) out[j] ^= u[j]
  }
  return out
}

/**
 * @param {string} password
 * @param {Uint8Array} salt
 * @param {number} iterations
 */
async function deriveKey(password, salt, iterations) {
  if (iterations <= WEB_CRYPTO_MAX_PBKDF2_ITERATIONS) {
    return deriveKeyWebCrypto(password, salt, iterations)
  }
  return deriveKeyLegacyPbkdf2(password, salt, iterations, KEY_BYTES)
}

/**
 * @param {Uint8Array} derived
 * @param {Uint8Array} expected
 */
function constantTimeEqual(derived, expected) {
  if (derived.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < derived.length; i += 1) diff |= derived[i] ^ expected[i]
  return diff === 0
}

/**
 * @param {string} password
 */
export async function hashPassword(password) {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  const derived = await deriveKeyWebCrypto(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`
}

/**
 * @param {string} password
 * @param {string} stored
 */
export async function verifyPassword(password, stored) {
  const parsed = parseStoredPasswordHash(stored)
  if (!parsed) return false
  let derived
  try {
    derived = await deriveKey(password, parsed.salt, parsed.iterations)
  } catch {
    return false
  }
  return constantTimeEqual(derived, parsed.expected)
}

/**
 * Build a stored hash string (used in tests for legacy compatibility vectors).
 * @param {string} password
 * @param {number} iterations
 */
export async function hashPasswordWithIterations(password, iterations) {
  if (iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error('iterations_out_of_range')
  }
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  const derived = await deriveKey(password, salt, iterations)
  return `pbkdf2_sha256$${iterations}$${toBase64(salt)}$${toBase64(derived)}`
}

/**
 * @param {string} password
 */
export function validatePasswordPolicy(password) {
  const s = String(password ?? '')
  if (s.length < 12) return 'Password must be at least 12 characters.'
  if (s.length > 128) return 'Password is too long.'
  return null
}
