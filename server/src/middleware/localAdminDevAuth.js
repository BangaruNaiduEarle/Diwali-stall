/**
 * Local development admin JWT (HS256). Never enabled on non-loopback hostnames.
 * Secrets live only in server/.dev.vars — not in wrangler.toml [vars].
 */
import { SignJWT, jwtVerify } from 'jose'

export const LOCAL_ADMIN_JWT_ISSUER = 'diwali-local-admin'
export const LOCAL_ADMIN_JWT_AUDIENCE = 'diwali-local-admin'
export const MIN_LOCAL_DEV_SECRET_LENGTH = 32
export const DEFAULT_LOCAL_JWT_TTL_SECONDS = 8 * 60 * 60

/**
 * @param {{ CF_ACCESS_TEAM_DOMAIN?: string, CF_ACCESS_AUD?: string }} env
 */
export function isCloudflareAccessConfigured(env) {
  const team = String(env?.CF_ACCESS_TEAM_DOMAIN ?? '').trim()
  const aud = String(env?.CF_ACCESS_AUD ?? '').trim()
  return Boolean(team && aud)
}

/**
 * @param {Request} request
 */
export function isLoopbackRequestHostname(request) {
  let hostname
  try {
    hostname = new URL(request.url).hostname.toLowerCase()
  } catch {
    return false
  }
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/**
 * @param {Record<string, unknown>} env
 */
export function readLocalAdminDevSecret(env) {
  const secret = String(env?.ADMIN_LOCAL_DEV_SECRET ?? '').trim()
  if (secret.length < MIN_LOCAL_DEV_SECRET_LENGTH) return null
  return secret
}

/**
 * Explicit opt-in local dev auth — loopback hostname only.
 * @param {Record<string, unknown>} env
 * @param {Request} request
 */
export function isLocalAdminDevAuthEnabled(env, request) {
  if (String(env?.ADMIN_LOCAL_DEV_AUTH ?? '').trim() !== '1') return false
  if (!readLocalAdminDevSecret(env)) return false
  return isLoopbackRequestHostname(request)
}

/**
 * @param {string} token
 * @param {Record<string, unknown>} env
 * @returns {Promise<{ email: string, sub?: string } | { error: 'invalid_token' | 'local_dev_not_configured' }>}
 */
export async function verifyLocalDevAdminJwt(token, env) {
  const secret = readLocalAdminDevSecret(env)
  if (!secret) {
    return { error: 'local_dev_not_configured' }
  }
  const raw = String(token ?? '').trim()
  if (!raw) {
    return { error: 'invalid_token' }
  }

  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(raw, key, {
      issuer: LOCAL_ADMIN_JWT_ISSUER,
      audience: LOCAL_ADMIN_JWT_AUDIENCE,
      algorithms: ['HS256'],
    })
    const email = typeof payload.email === 'string' ? payload.email.trim() : ''
    if (!email) {
      return { error: 'invalid_token' }
    }
    return {
      email,
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
    }
  } catch {
    return { error: 'invalid_token' }
  }
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ email: string, ttlSeconds?: number, now?: () => number }} opts
 */
export async function signLocalDevAdminJwt(env, opts) {
  const secret = readLocalAdminDevSecret(env)
  if (!secret) {
    throw new Error('ADMIN_LOCAL_DEV_SECRET must be at least 32 characters when local dev auth is enabled.')
  }
  const email = String(opts.email ?? env.ADMIN_LOCAL_DEV_EMAIL ?? '').trim()
  if (!email) {
    throw new Error('ADMIN_LOCAL_DEV_EMAIL or --email is required.')
  }
  const ttl = Number(opts.ttlSeconds ?? DEFAULT_LOCAL_JWT_TTL_SECONDS)
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  const iat = now()
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(LOCAL_ADMIN_JWT_ISSUER)
    .setAudience(LOCAL_ADMIN_JWT_AUDIENCE)
    .setSubject('local-dev-admin')
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttl)
    .sign(key)
}
