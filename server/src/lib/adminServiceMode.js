// Mode belongs to the trusted Worker DB binding, never to a caller's optional
// location context. No request-specific location is stored on a shared binding.
const modes = new WeakMap()

/** OFF by default only when trusted configuration explicitly initializes a DB. */
export function adminLocationMode(env = {}) {
  const value = String(env.ADMIN_LOCATION_MODE ?? '').trim().toLowerCase()
  if (['', 'false', '0'].includes(value)) return false
  if (['true', '1'].includes(value)) return true
  return null
}

export function serviceScopeError(message = 'Validated service location context is required.', status = 403) {
  return Object.assign(new Error(message), { status, code: status === 503 ? 'location_context_unavailable' : 'forbidden' })
}

/** Trusted server entry/direct callers must explicitly configure the binding.
 * Return the identical DB: OFF adds no SQL, proxy or schema dependencies. */
export function bindAdminServiceMode(db, env) {
  if (!db || typeof db.prepare !== 'function' || !env || typeof env !== 'object') throw serviceScopeError('A trusted DB binding and Worker configuration are required.', 503)
  const mode = adminLocationMode(env)
  if (modes.has(db) && modes.get(db) !== mode) throw serviceScopeError('A DB binding cannot switch service location modes.', 503)
  modes.set(db, mode)
  return db
}

export function adminServiceMode(db) {
  return modes.get(db)
}

/** Only internal ownership wrappers inherit a configured binding's policy. */
export function inheritAdminServiceMode(wrapper, db) {
  if (!modes.has(db)) throw serviceScopeError('Service DB mode has not been configured.', 503)
  modes.set(wrapper, modes.get(db))
}

export function requireLegacyServiceMode(db) {
  if (adminServiceMode(db) !== false) throw serviceScopeError()
}
