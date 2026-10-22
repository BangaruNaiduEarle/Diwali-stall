import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ESTIMATE_SHARED_STATUS,
  appendSharedEstimate,
  findSharedEstimateByFingerprint,
  historyLineKey,
  normalizeHistoryLine,
  normalizeSharedEstimateRecord,
} from './estimateHistory.js'

describe('estimateHistory', () => {
  it('creates one shared record with reference, items, and status', () => {
    const fp = '{"customer":{"name":"A","mobile":"9876543210"},"items":[]}'
    const first = appendSharedEstimate(
      {
        submissionFingerprint: fp,
        items: [
          { lineType: 'product', productId: 'P001', quantity: 2, unit: 'Box' },
          { lineType: 'product', productId: 'P002', quantity: 1 },
        ],
      },
      [],
    )
    assert.equal(first.created, true)
    assert.ok(first.record)
    assert.match(first.record.reference, /^EST-/)
    assert.equal(first.record.status, ESTIMATE_SHARED_STATUS)
    assert.equal(first.record.items.length, 2)
    assert.equal(first.record.items[0].unit, 'Box')
    assert.ok(!('price' in first.record))
    assert.ok(!('lineTotal' in first.record.items[0]))
  })

  it('does not duplicate history when the same submission fingerprint is confirmed again', () => {
    const fp = 'fingerprint-duplicate-test'
    const items = [{ productId: 'P010', quantity: 3 }]
    const first = appendSharedEstimate({ submissionFingerprint: fp, items }, [])
    const second = appendSharedEstimate({ submissionFingerprint: fp, items }, first.records)
    assert.equal(second.created, false)
    assert.equal(second.record?.id, first.record?.id)
    assert.equal(second.records.length, 1)
  })

  it('normalizes stored records without private pricing fields', () => {
    const record = normalizeSharedEstimateRecord({
      id: 'hist_1',
      reference: 'EST-ABC',
      sharedAt: '2026-10-18T12:00:00.000Z',
      status: ESTIMATE_SHARED_STATUS,
      submissionFingerprint: 'fp1',
      items: [{ productId: 'P001', quantity: 1, unit: 'Pkt', price: 999 }],
    })
    assert.ok(record)
    assert.equal(record.items[0].quantity, 1)
    assert.equal(record.items[0].unit, 'Pkt')
    assert.equal(record.items[0].lineType, 'product')
    assert.equal('price' in record.items[0], false)
  })

  it('loads legacy product-only records without lineType', () => {
    const legacy = normalizeSharedEstimateRecord({
      id: 'hist_legacy',
      reference: 'EST-OLD',
      sharedAt: '2026-01-01T00:00:00.000Z',
      status: ESTIMATE_SHARED_STATUS,
      submissionFingerprint: 'legacy-fp',
      items: [{ productId: 'P099', quantity: 4, unit: 'Pkt' }],
    })
    assert.ok(legacy)
    assert.equal(legacy.items.length, 1)
    assert.equal(legacy.items[0].productId, 'P099')
    assert.equal(legacy.items[0].lineType, 'product')
    assert.equal(historyLineKey(legacy.items[0]), 'p:P099')
  })

  it('stores product lines with lineType product and allowed fields only', () => {
    const record = appendSharedEstimate(
      {
        submissionFingerprint: 'fp-minimal-fields',
        items: [{ productId: 'P099', quantity: 4, unit: 'Pkt' }],
      },
      [],
    ).record
    assert.ok(record)
    const line = record.items[0]
    assert.deepEqual(Object.keys(line).sort(), ['lineType', 'productId', 'quantity', 'unit'])
    assert.equal(line.lineType, 'product')
  })

  it('persists family-pack-only history as one billable line per pack', () => {
    const record = appendSharedEstimate(
      {
        submissionFingerprint: 'fp-pack-only',
        items: [
          {
            lineType: 'family_pack',
            familyPackId: 'FP001',
            quantity: 2,
            unit: 'Family pack',
            label: 'Budget Pack',
            snapshotPricePaise: 50_000,
          },
        ],
      },
      [],
    ).record
    assert.ok(record)
    assert.equal(record.items.length, 1)
    const line = record.items[0]
    assert.equal(line.lineType, 'family_pack')
    assert.equal(line.familyPackId, 'FP001')
    assert.equal(line.label, 'Budget Pack')
    assert.equal(line.snapshotPricePaise, 50_000)
    assert.equal('productId' in line, false)
  })

  it('persists mixed product and family pack lines', () => {
    const record = appendSharedEstimate(
      {
        submissionFingerprint: 'fp-mixed',
        items: [
          { productId: 'P001', quantity: 1, unit: 'Box' },
          {
            familyPackId: 'FP001',
            quantity: 1,
            label: 'Budget Pack',
            snapshotPricePaise: 25_000,
          },
        ],
      },
      [],
    ).record
    assert.ok(record)
    assert.equal(record.items.length, 2)
    assert.equal(record.items[0].lineType, 'product')
    assert.equal(record.items[1].lineType, 'family_pack')
  })

  it('normalizeHistoryLine maps label to pack name and preserves snapshot price', () => {
    const line = normalizeHistoryLine({
      familyPackId: 'FP002',
      quantity: 3,
      label: 'Festive Pack',
      snapshotPricePaise: 75_000,
      unit: 'Family pack',
    })
    assert.ok(line)
    assert.equal(line.lineType, 'family_pack')
    assert.equal(line.label, 'Festive Pack')
    assert.equal(line.snapshotPricePaise, 75_000)
  })

  it('reload normalizes round-trip JSON without expanding pack contents', () => {
    const stored = {
      id: 'hist_rt',
      reference: 'EST-RT',
      sharedAt: '2026-10-18T12:00:00.000Z',
      status: ESTIMATE_SHARED_STATUS,
      submissionFingerprint: 'round-trip',
      items: [
        { lineType: 'family_pack', familyPackId: 'FP001', quantity: 1, label: 'Pack A', snapshotPricePaise: 10_000 },
        { lineType: 'product', productId: 'P1', quantity: 2, unit: 'Pkt' },
      ],
    }
    const normalized = normalizeSharedEstimateRecord(JSON.parse(JSON.stringify(stored)))
    assert.ok(normalized)
    assert.equal(normalized.items.length, 2)
    assert.equal(normalized.items.filter((l) => l.lineType === 'family_pack').length, 1)
    assert.equal(normalized.items.filter((l) => l.lineType === 'product').length, 1)
  })

  it('dedupes duplicate pack or product keys when appending', () => {
    const result = appendSharedEstimate(
      {
        submissionFingerprint: 'fp-dedupe',
        items: [
          { familyPackId: 'FP001', quantity: 1, label: 'A' },
          { familyPackId: 'FP001', quantity: 9, label: 'A again' },
          { productId: 'P1', quantity: 1 },
        ],
      },
      [],
    )
    assert.ok(result.record)
    assert.equal(result.record.items.length, 2)
  })

  it('uses server public reference when provided', () => {
    const record = appendSharedEstimate(
      {
        submissionFingerprint: 'fp-server-ref',
        reference: 'DWL-2026-TEST',
        items: [{ productId: 'P001', quantity: 1 }],
      },
      [],
    ).record
    assert.ok(record)
    assert.equal(record.reference, 'DWL-2026-TEST')
  })

  it('updates duplicate fingerprint record when server reference arrives later', () => {
    const fp = 'fp-ref-upgrade'
    const items = [{ productId: 'P001', quantity: 1 }]
    const first = appendSharedEstimate({ submissionFingerprint: fp, items }, [])
    assert.match(first.record.reference, /^EST-/)
    const second = appendSharedEstimate(
      { submissionFingerprint: fp, items, reference: 'DWL-LATER' },
      first.records,
    )
    assert.equal(second.created, false)
    assert.equal(second.record?.reference, 'DWL-LATER')
    assert.equal(second.records.length, 1)
  })

  it('finds records by submission fingerprint', () => {
    const records = [
      {
        id: 'h1',
        reference: 'EST-1',
        sharedAt: '2026-10-18T12:00:00.000Z',
        status: ESTIMATE_SHARED_STATUS,
        submissionFingerprint: 'alpha',
        items: [{ productId: 'P1', quantity: 1 }],
      },
    ]
    assert.equal(findSharedEstimateByFingerprint('alpha', records)?.reference, 'EST-1')
    assert.equal(findSharedEstimateByFingerprint('missing', records), null)
  })
})
