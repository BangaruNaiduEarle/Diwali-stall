import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const BUDGET_XLSX = 'c:\\Users\\naidu\\Downloads\\Diwali_Budget_and_Combination_Packs.xlsx'
const DETAIL_XLSX = 'c:\\Users\\naidu\\Downloads\\Diwali_Family_Pack_Detailed_Item_List.xlsx'

const PACKS = [
  { id: 'pocket-budget', displayName: 'Pocket Budget Pack', price: 299, file: 'budget', sheet: 'Pocket Budget Pack' },
  { id: 'budget-mix', displayName: 'Budget Mix Pack', price: 499, file: 'budget', sheet: 'Budget Mix Pack' },
  { id: 'budget-family', displayName: 'Budget Family Pack', price: 899, file: 'budget', sheet: 'Budget Pack' },
  { id: 'mini-starter', displayName: 'Mini Starter Pack', price: 999, file: 'detail', sheet: 'Mini Pack' },
  { id: 'mini-family', displayName: 'Mini Family Pack', price: 1499, file: 'budget', sheet: 'Mini Pack' },
  { id: 'premium-family', displayName: 'Premium Family Pack', price: 3999, file: 'budget', sheet: 'Premium Pack' },
  { id: 'happy-family', displayName: 'Happy Family Pack', price: 2299, file: 'budget', sheet: 'Happy Pack' },
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

function dumpSheetPreview(fileKey, sheetName, maxRows = 25) {
  const wb = loadWorkbook(fileKey)
  const rows = sheetToRows(wb, sheetName)
  console.log('\n===', fileKey, sheetName, 'rows:', rows.length, '===')
  for (let i = 0; i < Math.min(maxRows, rows.length); i++) {
    console.log(i, JSON.stringify(rows[i]))
  }
}

for (const pack of PACKS) {
  dumpSheetPreview(pack.file, pack.sheet, 30)
}
