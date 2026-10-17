import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(ROOT, 'src', 'data', 'familyPackImages.js'), 'utf8')
const re = /['"](\/images\/family-packs\/[^'"]+)['"]/g
/** @type {string[]} */
const paths = []
let m
while ((m = re.exec(src))) paths.push(m[1])

let ok = true
for (const webPath of paths) {
  const disk = path.join(ROOT, 'public', webPath.replace(/^\//, '').replace(/\//g, path.sep))
  const exists = fs.existsSync(disk)
  console.log(`${exists ? 'OK' : 'MISSING'}\t${webPath}`)
  if (!exists) ok = false
}
process.exit(ok ? 0 : 1)
