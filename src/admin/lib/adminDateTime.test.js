import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatAdminDateTimeIST, parseAdminTimestamp } from './adminDateTime.js'

describe('adminDateTime (Asia/Kolkata)', () => {
  it('formats SQLite UTC datetime as IST with 12-hour clock', () => {
    assert.equal(formatAdminDateTimeIST('2026-10-21 12:05:00'), '21 Oct 2026, 5:35 PM')
  })

  it('formats ISO UTC strings consistently', () => {
    assert.equal(formatAdminDateTimeIST('2026-10-21T12:05:00.000Z'), '21 Oct 2026, 5:35 PM')
  })

  it('handles midnight IST boundary from UTC', () => {
    assert.equal(formatAdminDateTimeIST('2026-10-20 18:30:00'), '21 Oct 2026, 12:00 AM')
  })

  it('formats AM times correctly', () => {
    assert.equal(formatAdminDateTimeIST('2026-10-21 00:30:00'), '21 Oct 2026, 6:00 AM')
  })

  it('parses unix seconds and milliseconds', () => {
    const ms = Date.parse('2026-10-21T12:05:00.000Z')
    assert.equal(formatAdminDateTimeIST(ms), '21 Oct 2026, 5:35 PM')
    assert.equal(formatAdminDateTimeIST(Math.floor(ms / 1000)), '21 Oct 2026, 5:35 PM')
  })

  it('returns em dash for null, empty, and invalid values', () => {
    assert.equal(formatAdminDateTimeIST(null), '—')
    assert.equal(formatAdminDateTimeIST(''), '—')
    assert.equal(formatAdminDateTimeIST('not-a-date'), '—')
    assert.equal(parseAdminTimestamp('not-a-date'), null)
  })

  it('parses date-only strings as UTC calendar dates', () => {
    assert.equal(formatAdminDateTimeIST('2026-01-01'), '01 Jan 2026, 5:30 AM')
  })
})
