/**
 * Build catalogue list-price map from src/data/products.js (id -> INR price).
 * Prices may be active "price" fields or commented //"price" lines (hidden from storefront UI).
 * Outputs:
 *   - src/data/catalogue-public-prices.json (Vite / Vercel — must be committable)
 *   - server/data/catalogue-public-prices.json (local Worker dev; gitignored)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const productsModule = path.join(root, 'src', 'data', 'products.js')
const storefrontOut = path.join(root, 'src', 'data', 'catalogue-public-prices.json')
const serverOut = path.join(root, 'server', 'data', 'catalogue-public-prices.json')

/** @param {string} source */
function pricesFromProductsSource(source) {
  /** @type {Record<string, number>} */
  const prices = {}
  /** @type {string | null} */
  let currentId = null
  for (const line of source.split('\n')) {
    const idMatch = line.match(/^\s*"id":\s*"([^"]+)"/)
    if (idMatch) {
      currentId = idMatch[1].trim()
      continue
    }
    const priceMatch =
      line.match(/^\s*\/\/\s*"price":\s*([\d.]+)/) ?? line.match(/^\s*"price":\s*([\d.]+)/)
    if (!priceMatch || !currentId) continue
    const price = Number(priceMatch[1])
    if (Number.isFinite(price) && price >= 0) {
      prices[currentId] = price
    }
  }
  return prices
}

const mod = await import(pathToFileURL(productsModule).href)
const products = mod.products ?? []
/** @type {Record<string, number>} */
const fromModule = {}
for (const p of products) {
  const id = String(p.id ?? '').trim()
  const price = Number(p.price)
  if (id && Number.isFinite(price) && price >= 0) {
    fromModule[id] = price
  }
}

const fromSource = pricesFromProductsSource(fs.readFileSync(productsModule, 'utf8'))
/** @type {Record<string, number>} */
const prices = { ...fromSource, ...fromModule }

const doc = { generatedAt: new Date().toISOString(), prices }
const json = `${JSON.stringify(doc, null, 2)}\n`

for (const outFile of [storefrontOut, serverOut]) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, json, 'utf8')
}

console.error(`Wrote ${Object.keys(prices).length} catalogue prices to ${storefrontOut}`)
