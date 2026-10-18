import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  EXPECTED_READY_COUNT,
  applyImportPlanInMemory,
  buildImportSqlBatch,
  buildProvenanceNote,
  formatEffectiveFromUtc,
  validateDryRunReportForImport,
  validateReadyAgainstExcel,
  validateReadyAgainstLiveD1,
  validateReportFreshness,
} from '../src/lib/x4PrivateRatesImport.js'
import { PUBLIC_PRODUCT_FIELD_KEYS } from '../src/services/publicProducts.js'
import { inrToPaise } from '../src/services/money.js'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIVE_REPORT = path.join(SERVER_ROOT, 'reports', 'x4-private-rates-dry-run.json')

function loadLiveReport() {
  if (!fs.existsSync(LIVE_REPORT)) {
    return null
  }
  return JSON.parse(fs.readFileSync(LIVE_REPORT, 'utf8'))
}

/** Report on disk after local D1 import has empty ready rows and would_conflict counts. */
function reportHasImportableReadyRows(report) {
  return Array.isArray(report?.ready_for_import) && report.ready_for_import.length > 0
}

describe('X4 import report validation', () => {
  it('accepts the current 160-row dry-run report structure', () => {
    const report = loadLiveReport()
    if (!report) {
      console.warn('skip: no x4-private-rates-dry-run.json on disk')
      return
    }
    if (!reportHasImportableReadyRows(report)) {
      console.warn('skip: dry-run report has no ready rows (local D1 likely already imported)')
      return
    }
    const errors = validateDryRunReportForImport(report)
    assert.deepEqual(errors, [], errors.join('; '))
    assert.equal(report.counts.approved_csv_rows, 161)
    if (Number(report.counts.would_conflict ?? 0) === 0) {
      assert.equal(report.ready_for_import.length, EXPECTED_READY_COUNT)
    } else {
      assert.ok(report.ready_for_import.length > 0)
      assert.equal(
        report.ready_for_import.length +
          (report.counts.catalogue_missing ?? 0) +
          (report.counts.would_conflict ?? 0),
        161,
      )
    }
    const ids = new Set(report.ready_for_import.map((r) => r.product_id))
    assert.equal(ids.size, report.ready_for_import.length)
    assert.equal(ids.has('P142'), false)
    assert.equal(report.blocked_manual.length, report.counts.pending_csv_rows ?? 0)
  })

  it('rejects stale reports by generatedAt', () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const errors = validateReportFreshness(old, 24 * 60 * 60 * 1000)
    assert.ok(errors.some((e) => e.startsWith('report_stale')))
  })

  it('rejects P142 in ready_for_import', () => {
    const report = loadLiveReport()
    if (!report) return
    const tampered = structuredClone(report)
    tampered.ready_for_import.push({
      ...tampered.ready_for_import[0],
      product_id: 'P142',
    })
    tampered.counts.ready_for_import = tampered.ready_for_import.length
    const errors = validateDryRunReportForImport(tampered)
    assert.ok(errors.some((e) => e.includes('P142') || e.includes('ready_count')))
  })

  it('rejects duplicate ready product_id', () => {
    const report = loadLiveReport()
    if (!report) return
    const tampered = structuredClone(report)
    tampered.ready_for_import.push({ ...tampered.ready_for_import[0] })
    tampered.counts.ready_for_import = tampered.ready_for_import.length
    const errors = validateDryRunReportForImport(tampered)
    assert.ok(errors.some((e) => e.includes('duplicate') || e.includes('ready_count')))
  })

  it('rejects existing D1 current rate conflicts', () => {
    const report = {
      ready_for_import: [
        {
          product_id: 'P001',
          d1_name: 'Sample',
          matched_workbook: 'CRACKERS_all.xlsx',
          worksheet: 'Bill',
          excel_row_number: 1,
          x4_inr: 10,
          unit_rate_paise: 1000,
        },
      ],
    }
    const products = new Map([['P001', { id: 'P001', name: 'Sample' }]])
    const rates = new Map([['P001', { id: 1, unit_rate_paise: 100 }]])
    const errors = validateReadyAgainstLiveD1(report, products, rates)
    assert.ok(errors.some((e) => e.includes('P001')))
  })

  it('rejects Excel drift on revalidation', () => {
    const report = loadLiveReport()
    if (!report || !reportHasImportableReadyRows(report)) return
    const row = report.ready_for_import[0]
    const key = `${row.matched_workbook}|${row.worksheet}|${row.excel_row_number}`
    const excelByKey = new Map([[key, { comp: row.company_comp_excel, x4_raw: Number(row.x4_inr) + 99 }]])
    const errors = validateReadyAgainstExcel(report, excelByKey)
    assert.ok(errors.some((e) => e.includes('excel_x4_drift')))
  })
})

describe('X4 import SQL and effective_from', () => {
  it('uses UTC effective_from format YYYY-MM-DD HH:MM:SS', () => {
    const s = formatEffectiveFromUtc(new Date('2026-10-15T16:01:01.332Z'))
    assert.equal(s, '2026-10-15 16:01:01')
  })

  it('builds INSERT-only batch with integer paise and provenance', () => {
    const report = loadLiveReport()
    if (!report || !reportHasImportableReadyRows(report)) return
    const row = report.ready_for_import[0]
    const sql = buildImportSqlBatch([row], '2026-10-15 16:01:01')
    assert.match(sql, /BEGIN TRANSACTION/)
    assert.match(sql, /INSERT INTO private_rates/)
    assert.match(sql, /COMMIT/)
    assert.doesNotMatch(sql, /UPDATE\s+private_rates/i)
    assert.doesNotMatch(sql, /DELETE\s+FROM\s+private_rates/i)
    assert.ok(sql.includes(String(row.unit_rate_paise)))
    const note = buildProvenanceNote(row)
    assert.match(note, /workbook=/)
    assert.match(note, /row=/)
  })

  it('throws when report paise does not match money.js', () => {
    const bad = {
      product_id: 'P001',
      matched_workbook: 'CRACKERS_all.xlsx',
      worksheet: 'Bill 20261049',
      excel_row_number: 5,
      company_comp_excel: 'AJN',
      x4_inr: 10.5,
      unit_rate_paise: 9999,
    }
    assert.throws(() => buildImportSqlBatch([bad], '2026-10-15 16:01:01'), /unit_rate_paise/)
  })
})

describe('X4 import in-memory apply (isolated)', () => {
  it('persists integer paise and effective_from', () => {
    const rates = new Map()
    const products = new Set(['P001'])
    applyImportPlanInMemory({
      readyRows: [{ product_id: 'P001', x4_inr: 1694, unit_rate_paise: inrToPaise(1694) }],
      effectiveFrom: '2026-10-15 16:01:01',
      products,
      rates,
    })
    assert.equal(rates.get('P001').unit_rate_paise, 169400)
    assert.equal(rates.get('P001').effective_from, '2026-10-15 16:01:01')
  })

  it('rolls back on failure (no partial rates)', () => {
    const rates = new Map()
    const products = new Set(['P001', 'P002'])
    assert.throws(() =>
      applyImportPlanInMemory({
        readyRows: [
          { product_id: 'P001', x4_inr: 100, unit_rate_paise: 10000 },
          { product_id: 'P999', x4_inr: 200, unit_rate_paise: 20000 },
        ],
        effectiveFrom: '2026-10-15 16:01:01',
        products,
        rates,
      }),
    )
    assert.equal(rates.size, 0)
  })

  it('second apply attempt fails when rate already exists', () => {
    const rates = new Map()
    const products = new Set(['P001'])
    const row = { product_id: 'P001', x4_inr: 1694, unit_rate_paise: inrToPaise(1694) }
    applyImportPlanInMemory({
      readyRows: [row],
      effectiveFrom: '2026-10-15 16:01:01',
      products,
      rates,
    })
    assert.throws(() =>
      applyImportPlanInMemory({
        readyRows: [row],
        effectiveFrom: '2026-10-15 16:01:01',
        products,
        rates,
      }),
    )
    assert.equal(rates.size, 1)
    assert.equal(rates.get('P001').unit_rate_paise, 169400)
  })
})

describe('X4 import public API separation', () => {
  it('import SQL and plan do not expose public product field names as rates', () => {
    for (const key of PUBLIC_PRODUCT_FIELD_KEYS) {
      assert.ok(!key.toLowerCase().includes('paise'))
      assert.ok(!key.toLowerCase().includes('x4'))
    }
    const sql = buildImportSqlBatch(
      [
        {
          product_id: 'P001',
          matched_workbook: 'CRACKERS_all.xlsx',
          worksheet: 'S',
          excel_row_number: 1,
          company_comp_excel: 'AJN',
          x4_inr: 1,
          unit_rate_paise: 100,
        },
      ],
      '2026-10-15 16:01:01',
    )
    assert.doesNotMatch(sql, /api\/public/)
  })
})
