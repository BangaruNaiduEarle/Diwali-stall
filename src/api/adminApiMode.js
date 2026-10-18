/**
 * Admin/public API routing mode (Vite dev vs production build).
 * Pass a plain env object in tests; runtime callers omit it to use import.meta.env.
 *
 * @param {{ DEV?: boolean, VITE_API_BASE_URL?: string }} [env]
 */
export function readApiBaseUrl(env = import.meta.env) {
  return String(env?.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
}

/**
 * Browser calls the Worker on a different origin (e.g. Vercel → workers.dev).
 * @param {{ DEV?: boolean, VITE_API_BASE_URL?: string }} [env]
 */
export function isCrossOriginApi(env = import.meta.env) {
  return Boolean(readApiBaseUrl(env))
}

/**
 * Vite dev with empty VITE_API_BASE_URL: same-origin /api/* proxied to wrangler dev.
 * @param {{ DEV?: boolean, VITE_API_BASE_URL?: string }} [env]
 */
export function isLocalViteProxyMode(env = import.meta.env) {
  return Boolean(env?.DEV) && !isCrossOriginApi(env)
}
