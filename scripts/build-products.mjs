import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PRODUCT_CATEGORY_LABELS } from '../src/data/categories.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const csvPath = path.join(root, 'diwali_product_master_final.csv')
const outPath = path.join(root, 'src', 'data', 'products.js')

function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (c === '\n' || (c === '\r' && next === '\n')) {
      if (c === '\r') i++
      row.push(field)
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      field = ''
      continue
    }
    field += c
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const VALID = new Set(PRODUCT_CATEGORY_LABELS)
const CATEGORY_ALIASES = {
  'Matches, Pencils & Caps': 'Others',
  Rockets: 'Rockets & Shots',
  'Combo Packs': 'Combo Packs',
}

function mapCategory(raw) {
  const trimmed = raw?.trim() ?? ''
  if (VALID.has(trimmed)) return trimmed
  if (CATEGORY_ALIASES[trimmed]) return CATEGORY_ALIASES[trimmed]
  return 'Others'
}

function roundPrice(n) {
  const num = Number(n)
  if (Number.isNaN(num)) return 0
  return Math.round(num)
}

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

function toBrowserImagePath(fileName) {
  return `/images/products/${fileName.replace(/^public\/images\/products\//i, '').replace(/^\/+/, '')}`
}

function resolveImages(imageFilename, imageStatus, productId) {
  const productsDir = path.join(root, 'public', 'images', 'products')
  const images = []

  const name = imageFilename?.trim()
  const status = imageStatus?.trim() ?? ''
  if (name && status.toLowerCase().includes('mapped')) {
    const base = name.replace(/^public\/images\/products\//i, '').replace(/^\/+/, '')
    const publicPath = path.join(productsDir, base)
    if (fs.existsSync(publicPath)) {
      images.push(toBrowserImagePath(base))
    }
  }

  if (images.length === 0) {
    const id = productId?.trim()
    if (id) {
      for (const suffix of ['-front', '-back', '']) {
        for (const ext of IMAGE_EXTENSIONS) {
          const fileName = `${id}${suffix}.${ext}`
          const publicPath = path.join(productsDir, fileName)
          if (fs.existsSync(publicPath)) {
            images.push(toBrowserImagePath(fileName))
            break
          }
        }
      }
    }
  }

  return images
}

const text = fs.readFileSync(csvPath, 'utf8')
const table = parseCSV(text)
const header = table[0]
const dataRows = table.slice(1)

const idx = Object.fromEntries(header.map((h, i) => [h, i]))
const issues = []

const products = dataRows.map((cells) => {
  const id = cells[idx.product_id]?.trim()
  const name = cells[idx.product_name]?.trim()
  const rawCategory = cells[idx.category]?.trim()
  const category = mapCategory(rawCategory)
  if (rawCategory && category === 'Others' && rawCategory !== 'Others' && !CATEGORY_ALIASES[rawCategory] && !VALID.has(rawCategory)) {
    issues.push({ id, issue: `Category mapped to Others: ${rawCategory}` })
  }
  const price = roundPrice(cells[idx.selling_price_4x])
  const referencePrice = roundPrice(cells[idx.reference_price_5x])
  const discount = Number(cells[idx.discount_percent]) || 20
  const images = resolveImages(cells[idx.image_filename], cells[idx.image_status], id)

  return {
    id,
    name,
    category,
    pack: '',
    price,
    referencePrice,
    discount,
    images,
    description: 'Product details available at the stall.',
    featured: false,
    stockStatus: 'available',
    active: true,
  }
})

const headerComment = `/**
 * Customer-facing catalogue (${products.length} products).
 * Generated from diwali_product_master_final.csv — do not add supplier/internal fields.
 */`

const body = `export const products = ${JSON.stringify(products, null, 2)}
`

fs.writeFileSync(outPath, headerComment + '\n\n' + body, 'utf8')

console.log('Wrote', products.length, 'products to', outPath)
console.log('Categories used:', [...new Set(products.map((p) => p.category))].sort())
console.log('With images:', products.filter((p) => p.images?.length).length)
if (issues.length) {
  console.log('Mapping notes:', issues.length)
  issues.slice(0, 20).forEach((i) => console.log(' ', i))
}
