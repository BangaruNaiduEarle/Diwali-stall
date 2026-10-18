import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Production Worker origin (must match vercel.json external rewrite). */
export const PRODUCTION_WORKER_ORIGIN = 'https://diwali-api.naiduearle2662.workers.dev'

/**
 * @param {string} browserPath e.g. `/api/admin/auth/login`
 */
export function expectedWorkerProxyUrl(browserPath) {
  const p = browserPath.startsWith('/') ? browserPath : `/${browserPath}`
  if (!p.startsWith('/api/')) {
    throw new Error(`expected /api path, got ${p}`)
  }
  return `${PRODUCTION_WORKER_ORIGIN}${p}`
}

function loadVercelConfig() {
  const raw = readFileSync(join(repoRoot, 'vercel.json'), 'utf8')
  return JSON.parse(raw)
}

describe('vercel.json API proxy', () => {
  it('rewrites /api/* to the production Worker before the SPA fallback', () => {
    const config = loadVercelConfig()
    const rewrites = config.rewrites ?? []
    assert.ok(rewrites.length >= 2, 'expected API rewrite plus SPA fallback')

    const apiRewrite = rewrites[0]
    assert.equal(apiRewrite.source, '/api/:path*')
    assert.equal(
      apiRewrite.destination,
      `${PRODUCTION_WORKER_ORIGIN}/api/:path*`,
      'destination must proxy to Worker with /api prefix preserved',
    )

    const spaFallback = rewrites[rewrites.length - 1]
    assert.equal(spaFallback.source, '/(.*)')
    assert.equal(spaFallback.destination, '/index.html')
  })

  it('orders rewrites so POST /api/admin/auth/login is proxied, not served as index.html', () => {
    const config = loadVercelConfig()
    const rewrites = config.rewrites ?? []
    const apiIndex = rewrites.findIndex((r) => String(r.source).includes('/api'))
    const spaIndex = rewrites.findIndex((r) => r.destination === '/index.html')
    assert.ok(apiIndex >= 0, 'missing /api rewrite')
    assert.ok(spaIndex >= 0, 'missing SPA fallback')
    assert.ok(apiIndex < spaIndex, 'API rewrite must appear before SPA fallback')

    const loginPath = '/api/admin/auth/login'
    const mapped = expectedWorkerProxyUrl(loginPath)
    assert.equal(mapped, `${PRODUCTION_WORKER_ORIGIN}${loginPath}`)
  })

  it('does not define Vercel functions or legacy routes that could intercept /api', () => {
    const config = loadVercelConfig()
    assert.equal(config.functions, undefined)
    assert.equal(config.routes, undefined)
    assert.equal(config.middleware, undefined)
    assert.equal(config.proxy, undefined)
  })
})

describe('vercel.json SPA-only misconfiguration (production 405 symptom)', () => {
  it('would send POST /api/* to static index.html when the API rewrite is absent', () => {
    const spaOnly = {
      rewrites: [{ source: '/(.*)', destination: '/index.html' }],
    }
    const hasApiRewrite = spaOnly.rewrites.some((r) => String(r.source).includes('/api'))
    assert.equal(hasApiRewrite, false)
    // Vercel serves index.html for GET /api/* (200 HTML) and POST /api/* (405 Method Not Allowed).
  })
})
