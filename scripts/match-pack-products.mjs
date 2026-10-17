import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const productsPath = path.join(ROOT, 'src', 'data', 'products.js')
const productsCode = fs.readFileSync(productsPath, 'utf8')
const products = []
const re = /\{\s*"id":\s*"([^"]+)",\s*"name":\s*"([^"]+)"/g
let m
while ((m = re.exec(productsCode))) {
  products.push({ id: m[1], name: m[2] })
}

function norm(s) {
  return String(s)
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const byNorm = new Map()
for (const p of products) {
  const n = norm(p.name)
  if (!byNorm.has(n)) byNorm.set(n, [])
  byNorm.get(n).push(p)
}

const ALIASES = [
  ['COLOURKOTI DLX 5PC', 'COLOUR KOTI DLX 5PC'],
  ['28 GAINT', '28 GAINT'],
  ['GC BIG 10p', 'GC BIG 10P'],
  ['GC BIG 10P', 'GC BIG 10P'],
]

function findProduct(company, itemName) {
  const n = norm(itemName)
  let hits = byNorm.get(n) ?? []
  if (!hits.length) {
    for (const p of products) {
      if (norm(p.name) === n) hits.push(p)
    }
  }
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) {
    return hits[0]
  }
  const partial = products.filter((p) => norm(p.name).includes(n) || n.includes(norm(p.name)))
  if (partial.length === 1) return partial[0]
  return null
}

const packData = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'familyPacks.json'), 'utf8'))
const report = { mapped: 0, unmapped: [] }

for (const pack of packData.packs) {
  for (const item of pack.items) {
    const product = findProduct(item.company, item.itemName)
    if (product) {
      item.productId = product.id
      report.mapped++
    } else {
      report.unmapped.push({ pack: pack.id, company: item.company, itemName: item.itemName })
    }
  }
}

fs.writeFileSync(path.join(ROOT, 'src', 'data', 'familyPacks.json'), JSON.stringify(packData, null, 2))
console.log('Mapped:', report.mapped, 'Unmapped:', report.unmapped.length)
if (report.unmapped.length) {
  console.log(JSON.stringify(report.unmapped, null, 2))
}
