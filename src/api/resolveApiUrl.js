import { readApiBaseUrl } from './adminApiMode.js'

/**
 * Resolve API paths for the Worker (admin + public clients).
 *
 * - VITE_API_BASE_URL set → absolute URL `{base}{path}` (Vercel production, or local `.env.local` → deployed Worker).
 * - VITE_API_BASE_URL empty → relative `{path}` (e.g. `/api/admin/session`), same origin as the page.
 *   On Vite dev (`localhost:5173`), the dev server proxies `/api/admin` and `/api/public` to wrangler dev (see vite.config.js).
 *
 * @param {string} path
 * @param {{ VITE_API_BASE_URL?: string }} [env] test override
 */
export function resolveApiUrl(path, env = import.meta.env) {
  const base = readApiBaseUrl(env)
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}
