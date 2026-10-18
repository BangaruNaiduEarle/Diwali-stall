/**
 * Phase 3C: human review report for Cloudinary migration (read-only).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  buildCloudinaryMigrationReview,
  formatCloudinaryMigrationReviewMarkdown,
} from '../src/lib/cloudinaryMigrationReview.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(SERVER_ROOT, '..')
const SOURCE_MODULE = path.join(REPO_ROOT, 'src', 'data', 'products.js')
const OUT_JSON = path.join(SERVER_ROOT, 'reports', 'cloudinary-migration-review.json')
const OUT_MD = path.join(SERVER_ROOT, 'reports', 'cloudinary-migration-review.md')

async function main() {
  const products = await import(pathToFileURL(SOURCE_MODULE).href).then((m) => m.products ?? [])
  const review = buildCloudinaryMigrationReview(products, {
    publicRoot: path.join(REPO_ROOT, 'public'),
    repoRoot: REPO_ROOT,
  })

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(review, null, 2)}\n`, 'utf8')
  fs.writeFileSync(OUT_MD, formatCloudinaryMigrationReviewMarkdown(review), 'utf8')

  console.log('Cloudinary migration review (read-only)')
  console.log(`  Missing paths: ${review.summary.missingReferencedFiles}`)
  console.log(`  Shared across products: ${review.summary.intentionalSharedPathCount}`)
  console.log(`  Empty images: ${review.summary.emptyImageProductIds}`)
  console.log(`Wrote ${path.relative(SERVER_ROOT, OUT_JSON)}`)
  console.log(`Wrote ${path.relative(SERVER_ROOT, OUT_MD)}`)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
