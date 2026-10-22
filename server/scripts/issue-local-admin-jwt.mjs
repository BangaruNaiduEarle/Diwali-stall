/**
 * Mint a short-lived local admin JWT for wrangler dev (loopback only).
 * Never prints ADMIN_LOCAL_DEV_SECRET.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_LOCAL_JWT_TTL_SECONDS, signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const DEV_VARS = path.join(SERVER_ROOT, '.dev.vars')

function loadDevVars(filePath) {
  /** @type {Record<string, string>} */
  const out = {}
  if (!fs.existsSync(filePath)) return out
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

function parseArgs(argv) {
  /** @type {{ email?: string, ttlSeconds?: number, help: boolean }} */
  const out = { help: false }
  for (const arg of argv.slice(2)) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg.startsWith('--email=')) out.email = arg.slice('--email='.length)
    else if (arg.startsWith('--ttl=')) out.ttlSeconds = Number(arg.slice('--ttl='.length))
  }
  return out
}

async function main() {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    console.log(`Usage: node scripts/issue-local-admin-jwt.mjs [--email=you@example.com] [--ttl=seconds]

Reads server/.dev.vars for ADMIN_LOCAL_DEV_SECRET and ADMIN_LOCAL_DEV_EMAIL.
Prints a JWT to stdout (for Cf-Access-Jwt-Assertion or ADMIN_LOCAL_DEV_JWT in .env.local).
Does not print secrets.`)
    process.exit(0)
  }

  const env = { ...loadDevVars(DEV_VARS), ...process.env }
  if (String(env.ADMIN_LOCAL_DEV_AUTH ?? '').trim() !== '1') {
    console.error('Set ADMIN_LOCAL_DEV_AUTH=1 in server/.dev.vars to enable local admin JWT issuance.')
    process.exit(1)
  }

  const email = opts.email ?? env.ADMIN_LOCAL_DEV_EMAIL
  const ttlSeconds = Number.isFinite(opts.ttlSeconds) ? opts.ttlSeconds : DEFAULT_LOCAL_JWT_TTL_SECONDS
  const token = await signLocalDevAdminJwt(env, { email, ttlSeconds })
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  process.stdout.write(`${token}\n`)
  console.error(`Local admin JWT issued for ${String(email).trim()} (expires ~${expiresAt}).`)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
