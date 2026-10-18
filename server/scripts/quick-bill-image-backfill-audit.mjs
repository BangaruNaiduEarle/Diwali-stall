/**
 * Phase 1 — Quick Bill Cloudinary image backfill audit (read-only).
 * Reads D1 products.images_json and matches against Cloudinary mapping artefacts.
 * Does not modify D1, upload images, or change application code paths.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { d1QueryLocal } from '../tests/helpers/d1Local.js'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  auditQuickBillImageBackfill,
  buildCloudinaryPathLookup,
  findDuplicateCloudinaryMappings,
} from '../src/lib/quickBillImageBackfillAudit.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(SERVER_ROOT, '..')
const DB_NAME = 'diwali-quotation'

const UPLOAD_MAPPING = path.join(SERVER_ROOT, 'data', 'generated', 'cloudinary-upload-mapping.json')
const CATALOGUE_MODULE = path.join(REPO_ROOT, 'src', 'data', 'catalogueCloudinaryByPath.js')
const OUT_JSON = path.join(SERVER_ROOT, 'reports', 'quick-bill-image-backfill-audit.json')
const OUT_MD = path.join(SERVER_ROOT, 'reports', 'quick-bill-image-backfill-audit.md')

function parseArgs(argv) {
  const args = new Set(argv.slice(2))
  if (args.has('--help') || args.has('-h')) {
    return { help: true }
  }
  const targets = []
  if (args.has('--remote')) targets.push('remote')
  if (args.has('--local') || targets.length === 0) targets.push('local')
  if (args.has('--both')) return { help: false, targets: ['local', 'remote'] }
  return { help: false, targets: [...new Set(targets)] }
}

function parseWranglerJsonStdout(out) {
  const jsonStart = out.indexOf('[')
  if (jsonStart < 0) {
    throw new Error('Wrangler D1 JSON output not found.')
  }
  const parsed = JSON.parse(out.slice(jsonStart))
  const block = Array.isArray(parsed) ? parsed[0] : parsed
  const rows = block?.results ?? []
  if (rows.length && rows[0]['Total queries executed'] != null) {
    throw new Error('Wrangler returned meta-only results; aborting to avoid a false audit.')
  }
  return rows
}

function d1QueryProducts({ remote }) {
  const sql = 'SELECT id, images_json FROM products ORDER BY id ASC;'
  if (!remote) {
    return d1QueryLocal(sql)
  }
  const escaped = sql.replace(/"/g, '""')
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --command "${escaped}" --json`
  const out = execSync(cmd, {
    cwd: SERVER_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })
  return parseWranglerJsonStdout(out)
}

async function loadMappingSources() {
  if (!fs.existsSync(UPLOAD_MAPPING)) {
    throw new Error(`Missing ${UPLOAD_MAPPING}`)
  }
  const uploadMapping = JSON.parse(fs.readFileSync(UPLOAD_MAPPING, 'utf8'))
  let catalogueByPath = {}
  if (fs.existsSync(CATALOGUE_MODULE)) {
    catalogueByPath = /** @type {{ catalogueCloudinaryByPath: Record<string, string> }} */ (
      await import(pathToFileURL(CATALOGUE_MODULE).href)
    ).catalogueCloudinaryByPath
  }
  const lookup = buildCloudinaryPathLookup(uploadMapping, catalogueByPath)
  const mappingIssues = findDuplicateCloudinaryMappings(lookup)
  return {
    uploadMappingMeta: {
      version: uploadMapping.version,
      updatedAt: uploadMapping.updatedAt,
      pathCount: Object.keys(uploadMapping.byCataloguePath ?? {}).length,
    },
    catalogueModulePathCount: Object.keys(catalogueByPath).length,
    lookup,
    mappingIssues,
  }
}

function renderMarkdown(report) {
  const lines = [
    '# Quick Bill Cloudinary image backfill — Phase 1 audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'Read-only. No D1 writes, uploads, or runtime mapping changes.',
    '',
    '## Mapping sources',
    '',
    `- \`cloudinary-upload-mapping.json\`: ${report.mapping.uploadMappingMeta.pathCount} paths (updated ${report.mapping.uploadMappingMeta.updatedAt ?? 'unknown'})`,
    `- \`catalogueCloudinaryByPath.js\`: ${report.mapping.catalogueModulePathCount} paths`,
    `- Duplicate Cloudinary URLs (multiple local paths → same URL): ${report.mapping.duplicateUrlCount}`,
    `- Upload vs catalogue URL mismatches: ${report.mapping.pathMismatchCount}`,
    '',
  ]

  for (const target of report.d1Targets) {
    const s = target.audit.summary
    lines.push(`## D1 target: ${target.name}`, '')
    lines.push('| Metric | Count |')
    lines.push('|--------|------:|')
    lines.push(`| Products | ${s.productCount} |`)
    lines.push(`| Image slots | ${s.totalImageSlots} |`)
    lines.push(`| Slots already Cloudinary HTTPS | ${s.slotsAlreadyCloudinary} |`)
    lines.push(`| Slots that would map local → Cloudinary | ${s.slotsWouldReplace} |`)
    lines.push(`| Slots missing mapping | ${s.slotsMissingMapping} |`)
    lines.push(`| Products mappable (full or partial) | ${s.productsFullyOrPartiallyMappable} |`)
    lines.push(`| Products unmatched | ${s.productsUnmatched} |`)
    lines.push(`| Products already all Cloudinary | ${s.productsAlreadyCloudinary} |`)
    lines.push(`| Products with empty images | ${s.productsEmptyImages} |`)
    lines.push(`| Path changes (before → after) | ${s.pathChangesCount} |`)
    lines.push('')

    if (target.audit.unmatchedProductIds.length) {
      lines.push('### Unmatched product IDs', '')
      lines.push(target.audit.unmatchedProductIds.join(', '))
      lines.push('')
    }

    const sampleChanges = target.audit.pathChanges.slice(0, 15)
    if (sampleChanges.length) {
      lines.push('### Sample path changes (first 15)', '')
      for (const c of sampleChanges) {
        lines.push(`- **${c.productId}** [${c.slotIndex}]: \`${c.before}\` → \`${c.after}\``)
      }
      if (target.audit.pathChanges.length > sampleChanges.length) {
        lines.push(`- … and ${target.audit.pathChanges.length - sampleChanges.length} more (see JSON).`)
      }
      lines.push('')
    }
  }

  lines.push('## Next step', '')
  lines.push('Await approval before applying `images_json` updates to local or production D1.')
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const { help, targets } = parseArgs(process.argv)
  if (help) {
    console.log(`Usage: node scripts/quick-bill-image-backfill-audit.mjs [--local] [--remote] [--both]

  Read-only audit for Quick Bill Phase 1 image backfill.
  Writes:
    reports/quick-bill-image-backfill-audit.json
    reports/quick-bill-image-backfill-audit.md

  Default: --local only. Use --remote or --both to include production D1 (SELECT only).`)
    process.exit(0)
  }

  const mapping = await loadMappingSources()
  /** @type {{ name: string, audit: ReturnType<typeof auditQuickBillImageBackfill> }[]} */
  const d1Targets = []

  for (const name of targets) {
    const remote = name === 'remote'
    console.log(`Querying D1 (${name})…`)
    const rows = d1QueryProducts({ remote })
    const audit = auditQuickBillImageBackfill(rows, mapping.lookup)
    d1Targets.push({ name, audit })
  }

  const report = {
    generatedAt: new Date().toISOString(),
    phase: '1-audit-only',
    mapping: {
      uploadMappingMeta: mapping.uploadMappingMeta,
      catalogueModulePathCount: mapping.catalogueModulePathCount,
      duplicateUrlCount: mapping.mappingIssues.duplicateUrls.length,
      pathMismatchCount: mapping.mappingIssues.pathMismatches.length,
      duplicateUrls: mapping.mappingIssues.duplicateUrls,
      pathMismatches: mapping.mappingIssues.pathMismatches,
    },
    d1Targets,
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  fs.writeFileSync(OUT_MD, renderMarkdown(report), 'utf8')

  console.log(`Wrote ${path.relative(SERVER_ROOT, OUT_JSON)}`)
  console.log(`Wrote ${path.relative(SERVER_ROOT, OUT_MD)}`)
  for (const t of d1Targets) {
    const s = t.audit.summary
    console.log(
      `[${t.name}] products=${s.productCount} wouldReplace=${s.slotsWouldReplace} missing=${s.slotsMissingMapping} unmatchedProducts=${s.productsUnmatched}`,
    )
  }
}

main().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})
