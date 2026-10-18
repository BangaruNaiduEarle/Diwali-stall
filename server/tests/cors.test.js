import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyCorsToResponse,
  corsHeadersForRequest,
  handleCorsPreflight,
  isOriginAllowed,
  normalizeOrigin,
  parseCorsAllowedOrigins,
} from '../src/lib/cors.js'
import worker from '../src/index.js'

const ALLOWED = 'https://diwali-stall.example.com'
const OTHER = 'https://preview-diwali-stall.example.com'

function corsEnv(extra = {}) {
  return {
    DB: createLocalDbStub(),
    CORS_ALLOWED_ORIGINS: `${ALLOWED},${OTHER}`,
    ...extra,
  }
}

describe('CORS policy parsing', () => {
  it('normalizes and dedupes allowed origins', () => {
    const allowed = parseCorsAllowedOrigins({
      CORS_ALLOWED_ORIGINS: ` ${ALLOWED}/ , ${OTHER} ,invalid, javascript:alert(1) `,
    })
    assert.ok(allowed)
    assert.equal(allowed.size, 2)
    assert.ok(isOriginAllowed(ALLOWED, allowed))
  })

  it('returns null when CORS is not configured', () => {
    assert.equal(parseCorsAllowedOrigins({}), null)
    assert.equal(parseCorsAllowedOrigins({ CORS_ALLOWED_ORIGINS: '  , ' }), null)
  })

  it('normalizeOrigin rejects path/query credentials', () => {
    assert.equal(normalizeOrigin('https://evil.com/path'), null)
    assert.equal(normalizeOrigin('https://user:pass@evil.com'), null)
    assert.equal(normalizeOrigin(ALLOWED), ALLOWED)
  })
})

describe('CORS preflight and response headers', () => {
  it('allows OPTIONS preflight for configured origin and methods/headers', () => {
    const allowed = parseCorsAllowedOrigins({ CORS_ALLOWED_ORIGINS: ALLOWED })
    const req = new Request(`${ALLOWED}/api/public/customer-requests`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, idempotency-key',
      },
    })
    const res = handleCorsPreflight(req, allowed)
    assert.ok(res)
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ALLOWED)
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true')
    assert.match(res.headers.get('Access-Control-Allow-Methods') ?? '', /POST/)
    assert.match(res.headers.get('Access-Control-Allow-Headers') ?? '', /Idempotency-Key/)
    assert.match(res.headers.get('Access-Control-Allow-Headers') ?? '', /Cf-Access-Jwt-Assertion/)
  })

  it('rejects preflight from disallowed origins', () => {
    const allowed = parseCorsAllowedOrigins({ CORS_ALLOWED_ORIGINS: ALLOWED })
    const req = new Request(`${ALLOWED}/api/public/products`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    })
    const res = handleCorsPreflight(req, allowed)
    assert.ok(res)
    assert.equal(res.status, 403)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null)
  })

  it('applyCorsToResponse adds headers on error responses for allowed origins', () => {
    const allowed = parseCorsAllowedOrigins({ CORS_ALLOWED_ORIGINS: ALLOWED })
    const req = new Request(`${ALLOWED}/api/admin/session`, {
      headers: { Origin: ALLOWED },
    })
    const base = Response.json({ error: 'unauthorized' }, { status: 401 })
    const out = applyCorsToResponse(base, req, allowed)
    assert.equal(out.status, 401)
    assert.equal(out.headers.get('Access-Control-Allow-Origin'), ALLOWED)
    assert.equal(out.headers.get('Access-Control-Allow-Credentials'), 'true')
  })

  it('does not reflect disallowed origins on responses', () => {
    const allowed = parseCorsAllowedOrigins({ CORS_ALLOWED_ORIGINS: ALLOWED })
    const req = new Request('https://api.example.com/api/public/products', {
      headers: { Origin: 'https://evil.example.com' },
    })
    assert.equal(corsHeadersForRequest(req, allowed), null)
  })
})

describe('Worker CORS integration', () => {
  it('does not add CORS headers when CORS_ALLOWED_ORIGINS is unset', async () => {
    const res = await worker.fetch(
      new Request('https://api.example.com/api/public/products', {
        headers: { Origin: ALLOWED },
      }),
      { DB: createLocalDbStub() },
      {},
    )
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null)
  })

  it('adds CORS headers on public API responses for allowed origins', async () => {
    const res = await worker.fetch(
      new Request('https://api.example.com/api/public/products', {
        headers: { Origin: ALLOWED },
      }),
      corsEnv(),
      {},
    )
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ALLOWED)
    assert.notEqual(res.status, 401)
  })

  it('OPTIONS preflight via worker fetch succeeds for allowed origin', async () => {
    const res = await worker.fetch(
      new Request('https://api.example.com/api/public/customer-requests', {
        method: 'OPTIONS',
        headers: {
          Origin: ALLOWED,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, idempotency-key',
        },
      }),
      corsEnv(),
      {},
    )
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ALLOWED)
  })

  it('allows credentials and Cookie header on admin login preflight', async () => {
    const res = await worker.fetch(
      new Request('https://api.example.com/api/admin/auth/login', {
        method: 'OPTIONS',
        headers: {
          Origin: ALLOWED,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      }),
      corsEnv(),
      {},
    )
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ALLOWED)
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true')
    const allowHeaders = res.headers.get('Access-Control-Allow-Headers') ?? ''
    assert.ok(allowHeaders.toLowerCase().includes('content-type'))
  })

  it('still requires admin auth when CORS is enabled', async () => {
    const res = await worker.fetch(
      new Request('https://api.example.com/api/admin/session', {
        method: 'GET',
        headers: { Origin: ALLOWED },
      }),
      corsEnv(),
      {},
    )
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.error, 'unauthorized')
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ALLOWED)
  })

  it('does not widen admin access for disallowed browser origins', async () => {
    const res = await worker.fetch(
      new Request('https://api.example.com/api/admin/session', {
        method: 'GET',
        headers: { Origin: 'https://evil.example.com' },
      }),
      corsEnv(),
      {},
    )
    assert.equal(res.status, 401)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null)
  })
})

function createLocalDbStub() {
  return {
    prepare() {
      return {
        bind() {
          return this
        },
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }
    },
    batch: async () => [],
  }
}
