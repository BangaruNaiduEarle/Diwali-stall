import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const BUDGET_XLSX = 'c:\\Users\\naidu\\Downloads\\Diwali_Budget_and_Combination_Packs.xlsx'
const DETAIL_XLSX = 'c:\\Users\\naidu\\Downloads\\Diwali_Family_Pack_Detailed_Item_List.xlsx'

const PACKS = [
  { id: 'pocket-budget', displayName: 'Pocket Budget Pack', price: 299, file: 'budget', sheet: 'Pocket Budget Pack' },
  { id: 'budget-mix', displayName: 'Budget Mix Pack', price: 499, file: 'budget', sheet: 'Budget Mix Pack' },
  { id: 'budget-family', displayName: 'Budget Family Pack', price: 899, file: 'budget', sheet: 'Budget Pack' },
  { id: 'mini-starter', displayName: 'Mini Starter Pack', price: 999, file: 'detail', sheet: 'Mini Pack' },
  { id: 'mini-family', displayName: 'Mini Family Pack', price: 1499, file: 'budget', sheet: 'Mini Pack' },
  { id: 'happy-family', displayName: 'Happy Family Pack', price: 2299, file: 'budget', sheet: 'Happy Pack' },
  { id: 'premium-family', displayName: 'Premium Family Pack', price: 3999, file: 'budget', sheet: 'Premium Pack' },
]

function loadWorkbook(fileKey) {
  const p = fileKey === 'budget' ? BUDGET_XLSX : DETAIL_XLSX
  return XLSX.readFile(p, { cellDates: true })
}

function sheetToRows(wb, sheetName) {
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`Missing sheet: ${sheetName}`)
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parsePackRows(rows) {
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (String(row[0]).trim() === 'Company' && String(row[1]).trim().toLowerCase().includes('item')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) throw new Error('Header row not found')

  const items = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const company = String(row[0] ?? '').trim()
    const itemName = String(row[1] ?? '').trim()
    if (!company && !itemName) continue
    if (!itemName) continue
    if (!company || company.toUpperCase() === 'TOTAL') break
    if (itemName.toUpperCase() === 'TOTAL') break
    if (/^company and item variants/i.test(company)) continue

    const qty = num(row[2]) ?? 1
    const unit = String(row[3] ?? '').trim()
    const billRate = num(row[4])
    const x4Unit = num(row[5])
    const x4Line = num(row[6])

    items.push({
      company,
      itemName,
      quantity: qty,
      unit,
      billRate,
      x4UnitPrice: x4Unit,
      x4LineTotal: x4Line,
    })
  }
  return items
}

function parseSuggestedPrice(rows) {
  const line = String(rows[1]?.[0] ?? '')
  const m = line.match(/(?:Suggested price|Pack price):\s*₹?\s*([\d,]+)/i)
  if (m) return Number(m[1].replace(/,/g, ''))
  return null
}

const workbooks = {
  budget: loadWorkbook('budget'),
  detail: loadWorkbook('detail'),
}

const out = { generatedAt: new Date().toISOString(), packs: [] }

for (const pack of PACKS) {
  const rows = sheetToRows(workbooks[pack.file], pack.sheet)
  const items = parsePackRows(rows)
  const sheetPrice = parseSuggestedPrice(rows)
  if (sheetPrice != null && sheetPrice !== pack.price) {
    console.warn(`Price mismatch ${pack.id}: config ${pack.price} sheet ${sheetPrice}`)
  }
  const billUnits = items.reduce((s, it) => s + it.quantity, 0)
  out.packs.push({
    id: pack.id,
    displayName: pack.displayName,
    price: pack.price,
    sourceFile: pack.file === 'budget' ? 'Diwali_Budget_and_Combination_Packs.xlsx' : 'Diwali_Family_Pack_Detailed_Item_List.xlsx',
    sourceSheet: pack.sheet,
    distinctItemTypes: items.length,
    totalBillUnits: billUnits,
    items,
  })
}

const outPath = path.join(ROOT, 'src', 'data', 'familyPacks.json')
fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log('Wrote', outPath, 'packs:', out.packs.length)
for (const p of out.packs) {
  console.log(`  ${p.id}: ${p.items.length} types, ${p.totalBillUnits} bill units`)
}

const { spawnSync } = await import('node:child_process')
const match = spawnSync(process.execPath, [path.join(__dirname, 'match-pack-products.mjs')], {
  stdio: 'inherit',
  cwd: ROOT,
})
if (match.status !== 0) process.exit(match.status ?? 1)
