import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  dbRowBlocksFinalizeMissingAgreedAmount,
  finalizeBlockedForMissingSavedAgreedAmount,
} from '../../src/lib/quotationBargainMode.js'
import { isFinalizeBlockedMissingAgreedAmount } from '../src/services/adminCustomerRequests.js'

describe('finalize agreed amount gate (all pricing modes)', () => {
  it('blocks when accepted_amount_paise is NULL', () => {
    assert.equal(
      dbRowBlocksFinalizeMissingAgreedAmount({
        pricing_mode: 'bargain',
        accepted_amount_paise: null,
      }),
      true,
    )
    assert.equal(
      dbRowBlocksFinalizeMissingAgreedAmount({
        pricing_mode: 'selling',
        accepted_amount_paise: null,
      }),
      true,
    )
  })

  it('blocks zero paise', () => {
    assert.equal(
      dbRowBlocksFinalizeMissingAgreedAmount({
        pricing_mode: 'selling',
        accepted_amount_paise: 0,
      }),
      true,
    )
  })

  it('allows finalize when a positive agreed amount is saved', () => {
    assert.equal(
      dbRowBlocksFinalizeMissingAgreedAmount({
        pricing_mode: 'selling',
        accepted_amount_paise: 360_000,
      }),
      false,
    )
    const quotation = { pricingMode: 'bargain', acceptedAmountPaise: 125_000 }
    assert.equal(finalizeBlockedForMissingSavedAgreedAmount(quotation), false)
    assert.equal(isFinalizeBlockedMissingAgreedAmount(quotation), false)
  })

  it('UI gate blocks unsaved quotation snapshot', () => {
    assert.equal(
      finalizeBlockedForMissingSavedAgreedAmount({
        pricingMode: 'selling',
        acceptedAmountPaise: null,
      }),
      true,
    )
  })
})
