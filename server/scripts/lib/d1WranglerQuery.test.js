import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractWranglerResultRows,
  isWranglerFileSummaryRow,
  parseWranglerExecuteJson,
} from './d1WranglerQuery.mjs'

describe('d1WranglerQuery parsing', () => {
  it('detects wrangler remote file summary rows', () => {
    assert.equal(
      isWranglerFileSummaryRow({
        'Total queries executed': 1,
        'Rows read': 160,
        'Rows written': 0,
        'Database size (MB)': '0.36',
      }),
      true,
    )
    assert.equal(isWranglerFileSummaryRow({ n: 160 }), false)
    assert.equal(isWranglerFileSummaryRow({ id: 'P001' }), false)
  })

  it('extracts SELECT rows and rejects summary-only remote file output', () => {
    const stdout = `upload noise\n[{"results":[{"id":"P001"}],"success":true}]`
    const parsed = parseWranglerExecuteJson(stdout)
    assert.deepEqual(extractWranglerResultRows(parsed), [{ id: 'P001' }])

    const summaryOnly = `[{"results":[{"Total queries executed":1,"Rows read":160,"Rows written":0,"Database size (MB)":"0.36"}],"success":true}]`
    assert.throws(
      () => extractWranglerResultRows(parseWranglerExecuteJson(summaryOnly)),
      /summary rows/,
    )
  })
})
