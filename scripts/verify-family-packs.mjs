import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'familyPacks.json'), 'utf8'))

let ok = true
for (const pack of data.packs) {
  const unmapped = pack.items.filter((i) => !i.productId)
  if (unmapped.length) {
    ok = false
    console.error(pack.id, 'unmapped', unmapped.length)
  }
  const units = pack.items.reduce((s, i) => s + i.quantity, 0)
  if (units !== pack.totalBillUnits) {
    ok = false
    console.error(pack.id, 'bill units mismatch', units, pack.totalBillUnits)
  }
  if (pack.items.length !== pack.distinctItemTypes) {
    ok = false
    console.error(pack.id, 'distinct types mismatch')
  }
}

console.log(ok ? 'verify-family-packs: OK' : 'verify-family-packs: FAILED')
process.exit(ok ? 0 : 1)
