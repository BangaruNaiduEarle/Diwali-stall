/** Crockford-style uppercase alphabet without 0/O, 1/I/L. */
export const PUBLIC_REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const PUBLIC_REFERENCE_PREFIX = 'DWL-'
export const PUBLIC_REFERENCE_SUFFIX_LENGTH = 8
export const PUBLIC_REFERENCE_MAX_GENERATION_ATTEMPTS = 8

const PUBLIC_REFERENCE_RE = new RegExp(
  `^${PUBLIC_REFERENCE_PREFIX}[${PUBLIC_REFERENCE_ALPHABET}]{${PUBLIC_REFERENCE_SUFFIX_LENGTH}}$`,
)

/**
 * @param {unknown} value
 */
export function isValidPublicReference(value) {
  return PUBLIC_REFERENCE_RE.test(String(value ?? '').trim())
}

/**
 * @param {Uint8Array} bytes
 * @param {string} [alphabet]
 */
export function publicReferenceSuffixFromBytes(bytes, alphabet = PUBLIC_REFERENCE_ALPHABET) {
  const len = alphabet.length
  let out = ''
  for (let i = 0; i < PUBLIC_REFERENCE_SUFFIX_LENGTH; i += 1) {
    out += alphabet[bytes[i] % len]
  }
  return out
}

/**
 * @param {() => Uint8Array | Promise<Uint8Array>} [randomBytes]
 */
export async function generatePublicReferenceSuffix(randomBytes = defaultRandomBytes) {
  const bytes = await randomBytes()
  if (bytes.length < PUBLIC_REFERENCE_SUFFIX_LENGTH) {
    throw new Error('Insufficient random bytes for public reference suffix.')
  }
  return publicReferenceSuffixFromBytes(bytes)
}

function defaultRandomBytes() {
  return crypto.getRandomValues(new Uint8Array(PUBLIC_REFERENCE_SUFFIX_LENGTH))
}

/**
 * @param {string} suffix
 */
export function formatPublicReference(suffix) {
  return `${PUBLIC_REFERENCE_PREFIX}${suffix}`
}

/**
 * @param {() => Uint8Array | Promise<Uint8Array>} [randomBytes]
 */
export async function generatePublicReference(randomBytes) {
  const suffix = await generatePublicReferenceSuffix(randomBytes)
  const reference = formatPublicReference(suffix)
  if (!isValidPublicReference(reference)) {
    throw new Error('Generated public reference failed validation.')
  }
  return reference
}

/**
 * @param {unknown} message
 */
export function isPublicReferenceUniqueConstraintError(message) {
  const text = String(message ?? '')
  return text.includes('UNIQUE constraint failed') && text.includes('public_reference')
}

/**
 * @param {unknown} message
 */
export function isCustomerRequestIdUniqueConstraintError(message) {
  const text = String(message ?? '')
  return text.includes('UNIQUE constraint failed') && text.includes('customer_requests')
}
