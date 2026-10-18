/**
 * Phase 3D: Cloudinary migration upload runner (dry-run default).
 * Does not write to D1. Requires --execute for real uploads.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMigrationManifest } from '../src/lib/cloudinaryMigrationManifest.js'
import { loadUploadMap } from '../src/lib/cloudinaryUploadMapStore.js'
import { runCloudinaryMigrationUpload } from '../src/lib/cloudinaryMigrationUpload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(SERVER_ROOT, '..')

const DEFAULT_MANIFEST = path.join(SERVER_ROOT, 'reports', 'cloudinary-migration-manifest.json')
const DEFAULT_MAP = path.join(SERVER_ROOT, 'data', 'generated', 'cloudinary-upload-mapping.json')
const DEFAULT_REPORT = path.join(SERVER_ROOT, 'reports', 'cloudinary-migration-upload-report.json')

/** @param {string} serverRoot */
export function loadWranglerDevVars(serverRoot) {
  const filePath = path.join(serverRoot, '.dev.vars')
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
  const args = argv.slice(2)
  /** @type {Record<string, string | boolean>} */
  const out = {
    dryRun: true,
    execute: false,
    force: false,
    manifest: DEFAULT_MANIFEST,
    map: DEFAULT_MAP,
    report: DEFAULT_REPORT,
    help: false,
  }
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--execute' || arg === '--upload') {
      out.execute = true
      out.dryRun = false
    } else if (arg === '--dry-run') {
      out.execute = false
      out.dryRun = true
    } else if (arg === '--force') out.force = true
    else if (arg.startsWith('--manifest=')) out.manifest = arg.slice('--manifest='.length)
    else if (arg.startsWith('--map=')) out.map = arg.slice('--map='.length)
    else if (arg.startsWith('--report=')) out.report = arg.slice('--report='.length)
  }
  return out
}

async function main() {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    console.log(`Usage: node scripts/cloudinary-migration-upload.mjs [options]

  Default: dry-run (no network, no mapping writes).

  --execute, --upload   Perform real Cloudinary uploads (requires server/.dev.vars).
  --dry-run             Explicit dry-run (default).
  --force               Re-upload even when catalogue path is already mapped.
  --manifest=PATH       Manifest JSON (default: reports/cloudinary-migration-manifest.json).
  --map=PATH            Durable upload map (default: data/generated/cloudinary-upload-mapping.json).
  --report=PATH         Run report JSON (default: reports/cloudinary-migration-upload-report.json).

  See server/docs/PHASE3D_CLOUDINARY_UPLOAD.md`)
    process.exit(0)
  }

  const loaded = loadMigrationManifest(String(opts.manifest), REPO_ROOT)
  if (!loaded.ok) {
    console.error('Invalid manifest:')
    for (const e of loaded.errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  const { map, mapPath } = loadUploadMap(String(opts.map))
  const env = { ...loadWranglerDevVars(SERVER_ROOT), ...process.env }

  const result = await runCloudinaryMigrationUpload({
    manifest: loaded.manifest,
    repoRoot: REPO_ROOT,
    map,
    mapPath,
    execute: Boolean(opts.execute),
    force: Boolean(opts.force),
    env,
  })

  fs.mkdirSync(path.dirname(String(opts.report)), { recursive: true })
  fs.writeFileSync(String(opts.report), `${JSON.stringify(result.report, null, 2)}\n`, 'utf8')

  if (!result.ok && result.error) {
    console.error(result.message ?? result.error)
    process.exit(1)
  }

  const s = result.report.summary
  console.log(result.report.dryRun ? 'Cloudinary migration upload (dry-run)' : 'Cloudinary migration upload (execute)')
  console.log(`  Upload tasks in manifest: ${s.uploadTasksInManifest}`)
  console.log(`  Would upload: ${s.wouldUpload}`)
  console.log(`  Uploaded: ${s.uploaded}`)
  console.log(`  Skipped (already mapped): ${s.skippedAlreadyMapped}`)
  console.log(`  Skipped (missing local file): ${s.skippedMissingLocalFile}`)
  console.log(`  Failed: ${s.failed}`)
  console.log(`  Product slots in map: ${s.productSlotsMapped ?? 0}`)
  console.log(`Wrote ${path.relative(SERVER_ROOT, String(opts.report))}`)
  if (!result.report.dryRun && s.uploaded > 0) {
    console.log(`Updated ${path.relative(SERVER_ROOT, mapPath)}`)
  }

  process.exit(result.report.summary.failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
