import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { excelCellKey, findDuplicateApprovedIds, normalizeApprovedRow, parseCsv } from '../src/lib/x4PrivateRatesDryRun.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const APPROVED = path.join(REPO_ROOT, 'reports', 'x4_implemented.csv')

const TWINKLING = [
  { id: 'P084', sheet: 'Bill 20261049', row: 15, comp: 'AJN', x4: '252' },
  { id: 'P083', sheet: 'Bill 20261040', row: 48, comp: 'VEL', x4: '80' },
  { id: 'P011', sheet: 'Bill 20261040', row: 49, comp: 'VEL', x4: '252' },
  { id: 'P085', sheet: 'Bill 20261040', row: 50, comp: 'MAR', x4: '216' },
]

describe('x4_implemented.csv approved mappings', () => {
  it('has unique product_id and coordinate keys', () => {
    const rows = parseCsv(fs.readFileSync(APPROVED, 'utf8'))
      .map(normalizeApprovedRow)
      .filter(Boolean)
    assert.equal(rows.length, 161)
    assert.deepEqual(findDuplicateApprovedIds(rows), [])

    const coordKeys = new Set()
    for (const row of rows) {
      const key = excelCellKey(row.matched_workbook, row.worksheet, row.excel_row_number)
      assert.ok(!coordKeys.has(key), `duplicate coordinate ${key}`)
      coordKeys.add(key)
    }
  })

  it('maps four twinkling catalogue SKUs to distinct Excel coordinates', () => {
    const rows = parseCsv(fs.readFileSync(APPROVED, 'utf8'))
      .map(normalizeApprovedRow)
      .filter(Boolean)
    const byId = new Map(rows.map((r) => [r.product_id, r]))
    for (const spec of TWINKLING) {
      const row = byId.get(spec.id)
      assert.ok(row, spec.id)
      assert.equal(row.worksheet, spec.sheet)
      assert.equal(row.excel_row_number, spec.row)
      assert.equal(row.company_comp, spec.comp)
      assert.equal(row.x4_value_csv, spec.x4)
    }
    const twinklingIds = TWINKLING.map((t) => t.id)
    assert.equal(new Set(twinklingIds).size, 4)
  })

  it('excludes P119 and keeps P142 only as blocked catalogue gap', () => {
    const rows = parseCsv(fs.readFileSync(APPROVED, 'utf8'))
      .map(normalizeApprovedRow)
      .filter(Boolean)
    const ids = new Set(rows.map((r) => r.product_id))
    assert.equal(ids.has('P119'), false)
    assert.equal(ids.has('P142'), true)
  })
})
