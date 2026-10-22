/**
 * @param {unknown} locationState
 * @returns {{ type: 'success' | 'error', message: string } | null}
 */
export function readAdminNavigationFlash(locationState) {
  if (!locationState || typeof locationState !== 'object') return null
  const flash = /** @type {Record<string, unknown>} */ (locationState).adminFlash
  if (!flash || typeof flash !== 'object') return null
  const message = String(/** @type {Record<string, unknown>} */ (flash).message ?? '').trim()
  if (!message) return null
  const typeRaw = String(/** @type {Record<string, unknown>} */ (flash).type ?? 'success')
  const type = typeRaw === 'error' ? 'error' : 'success'
  return { type, message }
}

/**
 * @param {string} message
 * @param {'success' | 'error'} [type]
 */
export function adminNavigationFlashState(message, type = 'success') {
  return { adminFlash: { type, message: String(message).trim() } }
}
