import { createRemoteJWKSet, jwtVerify } from 'jose'

/** @type {Map<string, ReturnType<typeof createRemoteJWKSet>>} */
const jwksCache = new Map()

/**
 * @param {string} teamDomain Hostname prefix (subdomain before .cloudflareaccess.com)
 */
function getJwks(teamDomain) {
  const key = teamDomain.trim().toLowerCase()
  if (!jwksCache.has(key)) {
    const issuer = `https://${key}.cloudflareaccess.com`
    jwksCache.set(key, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)))
  }
  return jwksCache.get(key)
}

/**
 * Extract Cloudflare Access JWT from request.
 * @param {Request} request
 */
export function readAccessJwtFromRequest(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion')
  if (header) return header
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * @param {string} token
 * @param {{ CF_ACCESS_TEAM_DOMAIN?: string, CF_ACCESS_AUD?: string }} env
 * @returns {Promise<{ email: string, sub?: string } | { error: 'auth_not_configured' | 'invalid_token' }>}
 */
export async function verifyCloudflareAccessToken(token, env) {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim()
  const aud = env.CF_ACCESS_AUD?.trim()
  if (!team || !aud) {
    return { error: 'auth_not_configured' }
  }
  if (!token) {
    return { error: 'invalid_token' }
  }

  const issuer = `https://${team}.cloudflareaccess.com`
  try {
    const { payload } = await jwtVerify(token, getJwks(team), {
      issuer,
      audience: aud,
    })
    const email = typeof payload.email === 'string' ? payload.email : ''
    if (!email) {
      return { error: 'invalid_token' }
    }
    return { email, sub: typeof payload.sub === 'string' ? payload.sub : undefined }
  } catch {
    return { error: 'invalid_token' }
  }
}
