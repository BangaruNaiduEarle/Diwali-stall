import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { inrToPaise } from '../src/services/money.js'
import {
  APPROVED_MAPPING_NOTES,
  APPROVED_MAPPING_STATUS,
  buildPurchaseRatesDryRunPlan,
  parseExcelRateInr,
} from '../src/lib/purchaseRatesDryRun.js'
import { excelCellKey } from '../src/lib/x4PrivateRatesDryRun.js'
import {
  applyPurchaseImportPlanInMemory,
  buildPurchaseImportSqlBatch,
  validatePurchaseDryRunReportForImport,
  validatePurchaseReadyAgainstLiveD1,
} from '../src/lib/purchaseRatesImport.js'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIVE_DRY_RUN = path.join(SERVER_ROOT, 'reports', 'purchase-rates-dry-run.json')

function sampleReadyRow(overrides = {}) {
  return {
    product_id: 'P001',
    product_name: 'Test',
    matched_workbook: 'CRACKERS_all.xlsx',
    worksheet: 'Bill 20261049',
    excel_row_number: 5,
    mapping_status: APPROVED_MAPPING_STATUS,
    mapping_notes: APPROVED_MAPPING_NOTES,
    action: 'insert',
    purchase_rate_inr: 423.5,
    unit_rate_paise: inrToPaise(423.5),
    excel_x4_inr_crosscheck: 1694,
    ...overrides,
  }
}

describe('purchase rate dry-run rules', () => {
  it('uses Excel Rate paise conversion via money.js', () => {
    const parsed = parseExcelRateInr(423.5)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(inrToPaise(parsed.inr), 42350)
  })

  it('excludes review mappings from ready_for_import', () => {
    const rows = [
      {
        product_id: 'P010',
        product_name: 'Review product',
        excel_workbook: 'CRACKERS_all.xlsx',
        excel_sheet: 'Bill 20261049',
        excel_row: 14,
        excel_rate_inr: 250,
        excel_x4_inr: 1000,
        mapping_status: 'review',
        mapping_notes: 'public_catalogue_price_ne_x4',
      },
    ]
    const plan = buildPurchaseRatesDryRunPlan(rows, new Map([['P010', { id: 'P010', name: 'X' }]]), new Map(), new Map())
    assert.equal(plan.ready_for_import.length, 0)
    assert.equal(plan.manual_review.length, 1)
    assert.equal(plan.manual_review[0].reason, 'mapping_status_review')
  })

  it('excludes rows with existing purchase rates', () => {
    const rows = [
      {
        product_id: 'P001',
        product_name: 'Test',
        excel_workbook: 'CRACKERS_all.xlsx',
        excel_sheet: 'Bill 20261049',
        excel_row: 5,
        excel_rate_inr: 423.5,
        excel_x4_inr: 1694,
        mapping_status: APPROVED_MAPPING_STATUS,
        mapping_notes: APPROVED_MAPPING_NOTES,
        stored_purchase_paise: 50000,
      },
    ]
    const excelKey = excelCellKey('CRACKERS_all.xlsx', 'Bill 20261049', 5)
    const excelByKey = new Map([[excelKey, { key: excelKey, rate_raw: 423.5, x4_raw: 1694, error: null }]])
    const plan = buildPurchaseRatesDryRunPlan(
      rows,
      new Map([['P001', { id: 'P001', name: 'Test' }]]),
      new Map([['P001', { unit_rate_paise: 50000 }]]),
      excelByKey,
    )
    assert.equal(plan.ready_for_import.length, 0)
    assert.equal(plan.skipped[0].reason, 'existing_purchase_rate_would_conflict')
  })

  it('promotes verified mapping with live Excel Rate to insert', () => {
    const rows = [
      {
        product_id: 'P001',
        product_name: 'Test',
        excel_workbook: 'CRACKERS_all.xlsx',
        excel_sheet: 'Bill 20261049',
        excel_row: 5,
        excel_rate_inr: 423.5,
        excel_x4_inr: 1694,
        mapping_status: APPROVED_MAPPING_STATUS,
        mapping_notes: APPROVED_MAPPING_NOTES,
      },
    ]
    const excelKey = excelCellKey('CRACKERS_all.xlsx', 'Bill 20261049', 5)
    const excelByKey = new Map([[excelKey, { rate_raw: 423.5, x4_raw: 1694, error: null }]])
    const plan = buildPurchaseRatesDryRunPlan(
      rows,
      new Map([['P001', { id: 'P001', name: 'Test' }]]),
      new Map(),
      excelByKey,
    )
    assert.equal(plan.ready_for_import.length, 1)
    assert.equal(plan.ready_for_import[0].purchase_rate_inr, 423.5)
    assert.notEqual(plan.ready_for_import[0].unit_rate_paise, inrToPaise(1694))
  })
})

describe('purchase rate import validation', () => {
  it('accepts a coherent dry-run report', () => {
    const report = {
      mode: 'dry_run',
      counts: { proposed_insert: 1 },
      ready_for_import: [sampleReadyRow()],
    }
    assert.deepEqual(validatePurchaseDryRunReportForImport(report), [])
  })

  it('rejects duplicate ready product_id', () => {
    const report = {
      mode: 'dry_run',
      counts: { proposed_insert: 2 },
      ready_for_import: [sampleReadyRow(), sampleReadyRow()],
    }
    const errors = validatePurchaseDryRunReportForImport(report)
    assert.ok(errors.some((e) => e.includes('duplicate')))
  })

  it('rejects overwrite when D1 already has purchase rate', () => {
    const report = {
      mode: 'dry_run',
      ready_for_import: [sampleReadyRow()],
    }
    const products = new Map([['P001', { id: 'P001' }]])
    const purchase = new Map([['P001', { unit_rate_paise: 100 }]])
    const errors = validatePurchaseReadyAgainstLiveD1(report, products, purchase)
    assert.ok(errors.some((e) => e.includes('d1_purchase_rate_exists')))
  })

  it('rolls back in-memory apply on injected failure', () => {
    const purchase = new Map([['P002', { unit_rate_paise: 1 }]])
    const ready = [sampleReadyRow({ product_id: 'P001' }), sampleReadyRow({ product_id: 'P003' })]
    const result = applyPurchaseImportPlanInMemory(ready, purchase, { failOnProductId: 'P003' })
    assert.equal(result.ok, false)
    assert.equal(purchase.has('P001'), false)
    assert.equal(purchase.get('P002')?.unit_rate_paise, 1)
  })

  it('generated SQL references product_purchase_rates only', () => {
    const sql = buildPurchaseImportSqlBatch([sampleReadyRow()], '2026-01-01 00:00:00')
    assert.ok(sql.includes('product_purchase_rates'))
    assert.ok(!sql.includes('private_rates'))
    assert.ok(sql.includes('BEGIN TRANSACTION'))
  })

  it('validates live dry-run report when present', () => {
    if (!fs.existsSync(LIVE_DRY_RUN)) {
      console.warn('skip: run dry-run-purchase-rates.mjs first')
      return
    }
    const report = JSON.parse(fs.readFileSync(LIVE_DRY_RUN, 'utf8'))
    const errors = validatePurchaseDryRunReportForImport(report)
    assert.deepEqual(errors, [], errors.join('; '))
    assert.ok(report.counts.proposed_insert >= 0)
    assert.ok(
      report.counts.manual_review >= 68,
      `manual_review=${report.counts.manual_review}`,
    )
  })
})
