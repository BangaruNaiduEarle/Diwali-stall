import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  effectiveFamilyPackId,
  familyPackSaveTarget,
  shouldNavigateToEditAfterImagePersist,
} from './adminFamilyPackEditMode.js'

describe('effectiveFamilyPackId', () => {
  it('prefers route id over draft', () => {
    assert.equal(effectiveFamilyPackId('FP002', 'FP003'), 'FP002')
  })

  it('uses draft on create route', () => {
    assert.equal(effectiveFamilyPackId(null, 'FP004'), 'FP004')
  })
})

describe('familyPackSaveTarget', () => {
  it('creates when on /new without draft', () => {
    assert.deepEqual(familyPackSaveTarget({ isCreateRoute: true, routePackId: null, draftPackId: null }), {
      mode: 'create',
      id: null,
    })
  })

  it('updates when draft exists on /new', () => {
    assert.deepEqual(familyPackSaveTarget({ isCreateRoute: true, routePackId: null, draftPackId: 'FP005' }), {
      mode: 'update',
      id: 'FP005',
    })
  })
})

describe('shouldNavigateToEditAfterImagePersist', () => {
  it('navigates only after draft exists on create route', () => {
    assert.equal(shouldNavigateToEditAfterImagePersist(true, null, 'FP006'), true)
    assert.equal(shouldNavigateToEditAfterImagePersist(true, null, null), false)
    assert.equal(shouldNavigateToEditAfterImagePersist(false, 'FP002', null), false)
  })
})
