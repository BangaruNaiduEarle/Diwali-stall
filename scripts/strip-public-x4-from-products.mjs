import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'src', 'data', 'products.js')
const text = fs.readFileSync(file, 'utf8')
const cleaned = text.replace(/\r?\n\s*"x4":\s*[\d.]+,?\s*/g, '\n')
const countBefore = (text.match(/"x4":/g) ?? []).length
const countAfter = (cleaned.match(/"x4":/g) ?? []).length
fs.writeFileSync(file, cleaned, 'utf8')
console.error(`Removed ${countBefore - countAfter} x4 fields from products.js (${countAfter} remaining)`)
