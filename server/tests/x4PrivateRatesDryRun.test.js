import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDryRunReport,
  excelCellKey,
  findDuplicateApprovedIds,
  inrX4ToPaise,
  normalizeApprovedRow,
  parseExcelX4Inr,
} from '../src/lib/x4PrivateRatesDryRun.js'
import { inrToPaise } from '../src/services/money.js'
import { PUBLIC_PRODUCT_FIELD_KEYS } from '../src/services/publicProducts.js'
import { d1QueryLocalSelect } from '../src/lib/d1LocalSelect.js'

describe('X4 dry-run (integer paise)', () => {
  it('uses money.js rounding for Excel X4 INR', () => {
    assert.equal(inrX4ToPaise(1694), 169400)
    assert.equal(inrX4ToPaise(2292.4), inrToPaise(2292.4))
    assert.equal(inrX4ToPaise(74.4), 7440)
  })

  it('rejects missing and invalid Excel X4', () => {
    assert.equal(parseExcelX4Inr(null).ok, false)
    assert.equal(parseExcelX4Inr('').ok, false)
    assert.equal(parseExcelX4Inr('abc').ok, false)
    assert.equal(parseExcelX4Inr(-1).ok, false)
    assert.equal(parseExcelX4Inr(100).ok, true)
  })
})

describe('X4 dry-run mapping validation', () => {
  const productsById = new Map([
    ['P001', { id: 'P001', name: 'EMERALD GIFT BOX' }],
    ['P018', { id: 'P018', name: 'MEGA STAR' }],
  ])

  it('marks ready when Excel matches approved CSV coordinates', () => {
    const approved = [
      normalizeApprovedRow({
        product_id: 'P001',
        product_name: 'EMERALD GIFT BOX',
        company_comp: 'AJN',
        matched_workbook: 'CRACKERS_all.xlsx',
        bill_number: '20261049',
        worksheet: 'Bill 20261049',
        excel_row_number: '5',
        x4_value: '1694',
      }),
    ]
    assert.ok(approved[0])
    const key = excelCellKey('CRACKERS_all.xlsx', 'Bill 20261049', 5)
    const excelByKey = new Map([
      [
        key,
        {
          comp: 'AJN',
          particulars: 'EMERALD GIFT BOX',
          x4_raw: 1694,
        },
      ],
    ])
    const report = buildDryRunReport({
      approvedRows: approved,
      pendingRows: [],
      productsById,
      currentRatesByProductId: new Map(),
      excelByKey,
      duplicateApprovedIds: [],
    })
    assert.equal(report.ready_for_import.length, 1)
    assert.equal(report.ready_for_import[0].unit_rate_paise, 169400)
    assert.equal(report.excel_drift.length, 0)
  })

  it('excludes P142 when absent from D1 catalogue', () => {
    const approved = [
      normalizeApprovedRow({
        product_id: 'P142',
        product_name: 'PEACOCK GAINT',
        company_comp: 'VTM',
        matched_workbook: 'CRACKERS_all.xlsx',
        worksheet: 'Bill 20261040',
        excel_row_number: '105',
        x4_value: '1400',
      }),
    ]
    const key = excelCellKey('CRACKERS_all.xlsx', 'Bill 20261040', 105)
    const excelByKey = new Map([
      [key, { comp: 'VTM', particulars: 'PEACOCK BIG', x4_raw: 1400 }],
    ])
    const report = buildDryRunReport({
      approvedRows: approved,
      pendingRows: [],
      productsById,
      currentRatesByProductId: new Map(),
      excelByKey,
      duplicateApprovedIds: [],
    })
    assert.equal(report.ready_for_import.length, 0)
    assert.equal(report.catalogue_missing.length, 1)
    assert.equal(report.catalogue_missing[0].product_id, 'P142')
  })

  it('detects duplicate product_id in approved CSV', () => {
    const row = {
      product_id: 'P001',
      product_name: 'A',
      company_comp: 'AJN',
      matched_workbook: 'CRACKERS_all.xlsx',
      worksheet: 'Bill 20261049',
      excel_row_number: '5',
      x4_value: '1',
    }
    const approved = [normalizeApprovedRow(row), normalizeApprovedRow(row)]
    const dupes = findDuplicateApprovedIds(approved.filter(Boolean))
    assert.deepEqual(dupes, ['P001'])
    const report = buildDryRunReport({
      approvedRows: approved.filter(Boolean),
      pendingRows: [],
      productsById,
      currentRatesByProductId: new Map(),
      excelByKey: new Map(),
      duplicateApprovedIds: dupes,
    })
    assert.equal(report.duplicate_approved_id.length, 1)
    assert.equal(report.ready_for_import.length, 0)
  })

  it('blocks pending CSV rows without importing them', () => {
    const report = buildDryRunReport({
      approvedRows: [],
      pendingRows: [
        {
          product_id: 'P005',
          product_name: 'GC BIG 10P',
          reason_skipped: 'duplicate_javascript_product_name',
          possible_excel_matches: 'row9|row27',
        },
      ],
      productsById: new Map([['P005', { id: 'P005', name: 'GC BIG 10P' }]]),
      currentRatesByProductId: new Map(),
      excelByKey: new Map(),
      duplicateApprovedIds: [],
    })
    assert.equal(report.blocked_manual.length, 1)
    assert.equal(report.ready_for_import.length, 0)
  })

  it('flags excel drift and existing private rate conflicts', () => {
    const approved = [
      normalizeApprovedRow({
        product_id: 'P001',
        product_name: 'EMERALD GIFT BOX',
        company_comp: 'AJN',
        matched_workbook: 'CRACKERS_all.xlsx',
        worksheet: 'Bill 20261049',
        excel_row_number: '5',
        x4_value: '1694',
      }),
    ]
    const key = excelCellKey('CRACKERS_all.xlsx', 'Bill 20261049', 5)
    const excelByKey = new Map([
      [key, { comp: 'AJN', particulars: 'EMERALD GIFT BOX', x4_raw: 1700 }],
    ])
    const driftReport = buildDryRunReport({
      approvedRows: approved,
      pendingRows: [],
      productsById,
      currentRatesByProductId: new Map(),
      excelByKey,
      duplicateApprovedIds: [],
    })
    assert.equal(driftReport.excel_drift.length, 1)

    const excelByKeyOk = new Map([
      [key, { comp: 'AJN', particulars: 'EMERALD GIFT BOX', x4_raw: 1694 }],
    ])
    const conflictReport = buildDryRunReport({
      approvedRows: approved,
      pendingRows: [],
      productsById,
      currentRatesByProductId: new Map([
        ['P001', { id: 99, unit_rate_paise: 169400 }],
      ]),
      excelByKey: excelByKeyOk,
      duplicateApprovedIds: [],
    })
    assert.equal(conflictReport.would_conflict.length, 1)
    assert.equal(conflictReport.ready_for_import.length, 0)
  })

  it('records name_warning but keeps coordinate-valid rows ready', () => {
    const approved = [
      normalizeApprovedRow({
        product_id: 'P018',
        product_name: 'MEGA STAR',
        company_comp: 'AJN',
        matched_workbook: 'CRACKERS_all.xlsx',
        worksheet: 'Bill 20261049',
        excel_row_number: '22',
        x4_value: '682',
      }),
    ]
    const key = excelCellKey('CRACKERS_all.xlsx', 'Bill 20261049', 22)
    const excelByKey = new Map([
      [key, { comp: 'AJN', particulars: 'MEGA STAR 12', x4_raw: 682 }],
    ])
    const report = buildDryRunReport({
      approvedRows: approved,
      pendingRows: [],
      productsById,
      currentRatesByProductId: new Map(),
      excelByKey,
      duplicateApprovedIds: [],
    })
    assert.equal(report.ready_for_import.length, 1)
    assert.equal(report.name_warning.length, 1)
  })
})

describe('d1LocalSelect (read-only guard)', () => {
  it('rejects non-SELECT SQL', () => {
    assert.throws(
      () => d1QueryLocalSelect("INSERT INTO private_rates (product_id, unit_rate_paise, effective_from) VALUES ('P001', 1, datetime('now'))"),
      /only SELECT|mutating/i,
    )
  })
})

describe('X4 dry-run public/private separation', () => {
  it('public product field keys never include private rate fields', () => {
    for (const key of PUBLIC_PRODUCT_FIELD_KEYS) {
      assert.ok(!key.toLowerCase().includes('rate') || key === 'sellingPricePaise')
      assert.ok(key === 'sellingPricePaise' || !key.toLowerCase().includes('paise'))
      assert.ok(!key.toLowerCase().includes('x4'))
      assert.ok(key !== 'price')
    }
  })

  it('ready_for_import uses server-side keys only (not public API shape)', () => {
    const report = buildDryRunReport({
      approvedRows: [
        normalizeApprovedRow({
          product_id: 'P001',
          product_name: 'EMERALD GIFT BOX',
          company_comp: 'AJN',
          matched_workbook: 'CRACKERS_all.xlsx',
          worksheet: 'Bill 20261049',
          excel_row_number: '5',
          x4_value: '1694',
        }),
      ].filter(Boolean),
      pendingRows: [],
      productsById: new Map([['P001', { id: 'P001', name: 'EMERALD GIFT BOX' }]]),
      currentRatesByProductId: new Map(),
      excelByKey: new Map([
        [
          excelCellKey('CRACKERS_all.xlsx', 'Bill 20261049', 5),
          { comp: 'AJN', particulars: 'EMERALD GIFT BOX', x4_raw: 1694 },
        ],
      ]),
      duplicateApprovedIds: [],
    })
    const row = report.ready_for_import[0]
    for (const key of PUBLIC_PRODUCT_FIELD_KEYS) {
      assert.equal(key in row, false, `public field ${key} must not appear on import row`)
    }
    assert.equal(typeof row.unit_rate_paise, 'number')
  })
})
