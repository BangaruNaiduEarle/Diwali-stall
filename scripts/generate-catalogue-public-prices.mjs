/**
 * Build admin-only catalogue price map from src/data/products.js (id -> INR price, no x4).
 * Output: server/data/catalogue-public-prices.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const productsModule = path.join(root, 'src', 'data', 'products.js')
const outFile = path.join(root, 'server', 'data', 'catalogue-public-prices.json')

const mod = await import(pathToFileURL(productsModule).href)
const products = mod.products ?? []
/** @type {Record<string, number>} */
const prices = {}
for (const p of products) {
  const id = String(p.id ?? '').trim()
  const price = Number(p.price)
  if (id && Number.isFinite(price) && price >= 0) {
    prices[id] = price
  }
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(
  outFile,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), prices }, null, 2)}\n`,
  'utf8',
)
console.error(`Wrote ${Object.keys(prices).length} catalogue prices to ${outFile}`)
