import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  validatePlatformSeasonCreateForm,
  validatePlatformSeasonEditForm,
  validatePlatformSeasonId,
} from './adminPlatformSeasonFormValidation.js'

describe('adminPlatformSeasonFormValidation', () => {
  it('validates create form fields', () => {
    const fail = validatePlatformSeasonCreateForm({ id: '', code: '', label: '' })
    assert.equal(fail.ok, false)

    const badId = validatePlatformSeasonCreateForm({ id: '2030', code: '2030', label: 'X' })
    assert.equal(badId.ok, false)
    if (!badId.ok) assert.equal(badId.field, 'id')

    const ok = validatePlatformSeasonCreateForm({
      id: ' season-2030 ',
      code: '2030',
      label: ' Diwali 2030 ',
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.id, 'season-2030')
      assert.equal(ok.label, 'Diwali 2030')
    }
  })

  it('validates edit form for code and label only', () => {
    const fail = validatePlatformSeasonEditForm({ code: '', label: 'Only label' })
    assert.equal(fail.ok, false)

    const ok = validatePlatformSeasonEditForm({ code: '2027', label: 'Renamed' })
    assert.equal(ok.ok, true)
    if (ok.ok) assert.equal(ok.code, '2027')
  })

  it('rejects invalid season id pattern before API call', () => {
    assert.ok(validatePlatformSeasonId('season-2030') === null)
    assert.ok(validatePlatformSeasonId('bad id') !== null)
  })
})
