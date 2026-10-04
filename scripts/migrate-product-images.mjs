import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.join(__dirname, '..', 'src', 'data', 'products.js')

function normalizePath(raw) {
  if (!raw?.trim()) return ''
  let s = String(raw).trim().replace(/\\/g, '/')
  s = s.replace(/^\/public\//i, '/')
  s = s.replace(/^public\//i, '')
  if (s.startsWith('/images/')) return s
  if (s.startsWith('images/')) return `/${s}`
  if (s.startsWith('/')) return s
  return `/images/products/${s.replace(/^\.?\//, '')}`
}

const text = fs.readFileSync(outPath, 'utf8')
const match = text.match(/export const products = (\[[\s\S]*\])\s*$/)
if (!match) throw new Error('Could not parse products.js')

// eslint-disable-next-line no-eval
const products = eval(match[1])

const migrated = products.map((p) => {
  const images = []
  if (Array.isArray(p.images)) {
    for (const entry of p.images) {
      const url = normalizePath(entry)
      if (url) images.push(url)
    }
  } else if (p.image != null && String(p.image).trim()) {
    const url = normalizePath(p.image)
    if (url) images.push(url)
  }

  const { image, ...rest } = p
  return { ...rest, images }
})

const p001 = migrated.find((p) => p.id === 'P001')
if (p001) {
  const a = '/images/products/EMERALD-GIFT-BOX-1.jpeg'
  const b = '/images/products/EMERALD-GIFT-BOX-2.jpeg'
  const seen = new Set(p001.images)
  seen.add(a)
  seen.add(b)
  p001.images = [a, b].filter((u) => seen.has(u))
  if (!p001.images.includes(b)) p001.images.push(b)
}

const header = text.split('export const products')[0]
fs.writeFileSync(outPath, `${header}export const products = ${JSON.stringify(migrated, null, 2)}\n`)

console.log('Migrated', migrated.length, 'products')
console.log('P001 images:', p001?.images)
