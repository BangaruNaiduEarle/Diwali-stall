import { isCrossOriginApi, isLocalViteProxyMode } from '../../api/adminApiMode.js'

/**
 * @param {{ errorCode?: string | null, httpStatus?: number | null }} opts
 * @param {{ DEV?: boolean, VITE_API_BASE_URL?: string }} [env]
 */
export function adminAuthHint(opts, env = import.meta.env) {
  const { errorCode, httpStatus } = opts
  const localProxy = isLocalViteProxyMode(env)
  const crossOrigin = isCrossOriginApi(env)

  if (httpStatus === 0 || errorCode === 'network_error') {
    if (localProxy) {
      return 'Start the Worker (npm run dev in server/) on port 8787. The Vite dev server proxies /api/* to it.'
    }
    return 'Could not reach the admin API. Check VITE_API_BASE_URL and that the Worker is running.'
  }

  if (httpStatus === 401 || errorCode === 'unauthorized') {
    if (localProxy) {
      return (
        'Local dev: open /admin/products after setting ADMIN_LOCAL_DEV_JWT in root .env.local ' +
        '(run npm run admin:local-jwt in server/, then restart Vite). ' +
        'Password sign-in requires a separate local owner bootstrap (see server/docs/LOCAL_ADMIN_DEV.md). ' +
        'Production passwords do not apply to local D1.'
      )
    }
    return 'Sign in with your admin email and password.'
  }

  if (httpStatus === 403 || errorCode === 'forbidden') {
    if (localProxy) {
      return 'This email is not in the local admin_users allowlist, or the account is disabled.'
    }
    return 'This account is disabled or not authorized.'
  }

  if (errorCode === 'auth_not_configured' || httpStatus === 503) {
    return 'The API database or auth configuration is unavailable.'
  }

  if (crossOrigin && !localProxy) {
    return 'Admin access could not be verified against the configured Worker API.'
  }

  return 'Admin access could not be verified.'
}
