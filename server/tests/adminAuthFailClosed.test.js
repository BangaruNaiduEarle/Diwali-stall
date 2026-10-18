import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authenticateAdmin } from '../src/middleware/adminAuth.js'
import { verifyCloudflareAccessToken } from '../src/middleware/accessJwt.js'

describe('admin auth fail-closed', () => {
  it('returns 401 when no session and Cloudflare Access is not configured', async () => {
    const request = new Request('https://example.com/api/admin/session')
    const result = await authenticateAdmin(request, { DB: {} })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 401)
      assert.equal(result.code, 'unauthorized')
    }
  })

  it('verifyCloudflareAccessToken rejects empty token when configured', async () => {
    const out = await verifyCloudflareAccessToken('', {
      CF_ACCESS_TEAM_DOMAIN: 'example',
      CF_ACCESS_AUD: 'test-aud',
    })
    assert.equal('error' in out && out.error, 'invalid_token')
  })

  it('returns 401 for garbage JWT when Access is configured', async () => {
    const request = new Request('https://example.com/api/admin/session', {
      headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' },
    })
    const result = await authenticateAdmin(request, {
      CF_ACCESS_TEAM_DOMAIN: 'example',
      CF_ACCESS_AUD: 'test-aud',
      DB: {},
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 401)
    }
  })
})
