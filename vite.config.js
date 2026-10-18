import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

/**
 * Dev-only: remind when proxied admin auth JWT is missing (never log the token).
 * @param {Record<string, string>} env
 */
function localAdminProxyHintPlugin(env) {
  return {
    name: 'diwali-local-admin-proxy-hint',
    configureServer() {
      const apiBase = String(env.VITE_API_BASE_URL ?? '').trim()
      if (apiBase) return
      const jwt = String(env.ADMIN_LOCAL_DEV_JWT ?? '').trim()
      if (jwt) return
      console.warn(
        '[diwali] ADMIN_LOCAL_DEV_JWT is empty in .env.local — proxied /api/admin/* will return 401 until you run `npm run admin:local-jwt` in server/ and restart Vite.',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Non-VITE_ vars (e.g. ADMIN_LOCAL_DEV_JWT) live in repo root .env.local for the dev proxy only.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), localAdminProxyHintPlugin(env)],
    server: {
      // Local dev: proxy admin API to wrangler dev (default http://127.0.0.1:8787).
      // Production: serve the SPA and Worker on one Access-protected origin; set VITE_API_BASE_URL only if split.
      proxy: {
        '/api/admin': {
          target: env.VITE_DEV_API_PROXY || 'http://127.0.0.1:8787',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const jwt = String(env.ADMIN_LOCAL_DEV_JWT ?? '').trim()
              if (jwt) {
                proxyReq.setHeader('Cf-Access-Jwt-Assertion', jwt)
              }
            })
          },
        },
        '/api/public': {
          target: env.VITE_DEV_API_PROXY || 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  }
})
