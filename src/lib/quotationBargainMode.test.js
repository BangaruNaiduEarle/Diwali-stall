import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activeQuotationAuditRowFromApi,
  bargainDbRowRequiresAgreedAmount,
  bargainFinalizeBlockedForActiveQuotation,
  finalizeBlockedForMissingSavedAgreedAmount,
  quotationIsBargainMode,
} from './quotationBargainMode.js'

describe('quotationIsBargainMode', () => {
  it('detects explicit pricing_mode bargain case-insensitively', () => {
    assert.equal(quotationIsBargainMode({ pricingMode: 'Bargain' }), true)
  })
})

describe('bargainFinalizeBlockedForActiveQuotation', () => {
  it('blocks bargain API quotation with null accepted amount', () => {
    assert.equal(
      bargainFinalizeBlockedForActiveQuotation({
        pricingMode: 'bargain',
        acceptedAmountPaise: null,
        bargainFloorPaise: 500_000,
      }),
      true,
    )
  })

  it('does not treat selling as bargain-only gate (legacy bargain helper)', () => {
    assert.equal(
      bargainFinalizeBlockedForActiveQuotation({
        pricingMode: 'selling',
        acceptedAmountPaise: null,
      }),
      false,
    )
  })
})

describe('finalizeBlockedForMissingSavedAgreedAmount', () => {
  it('blocks selling mode until agreed amount is saved', () => {
    assert.equal(
      finalizeBlockedForMissingSavedAgreedAmount({
        pricingMode: 'selling',
        acceptedAmountPaise: null,
      }),
      true,
    )
  })
})

describe('bargainDbRowRequiresAgreedAmount', () => {
  it('blocks when pricing_mode is bargain and accepted_amount_paise is NULL', () => {
    assert.equal(
      bargainDbRowRequiresAgreedAmount({
        pricing_mode: 'bargain',
        accepted_amount_paise: null,
        bargain_floor_paise: 400_000,
      }),
      true,
    )
  })

  it('detects bargain via bargain_floor when pricing_mode is null', () => {
    assert.equal(
      bargainDbRowRequiresAgreedAmount({
        pricing_mode: null,
        bargain_floor_paise: 450_000,
        accepted_amount_paise: null,
      }),
      true,
    )
  })

  it('treats zero paise as missing agreed amount', () => {
    assert.equal(
      bargainDbRowRequiresAgreedAmount({
        pricing_mode: 'bargain',
        accepted_amount_paise: 0,
      }),
      true,
    )
  })

  it('allows finalize when a positive agreed amount is saved', () => {
    assert.equal(
      bargainDbRowRequiresAgreedAmount({
        pricing_mode: 'bargain',
        accepted_amount_paise: 125_000,
      }),
      false,
    )
  })
})

describe('activeQuotationAuditRowFromApi', () => {
  it('maps camelCase quotation audit fields', () => {
    assert.deepEqual(
      activeQuotationAuditRowFromApi({
        pricingMode: 'bargain',
        acceptedAmountPaise: null,
        bargainFloorPaise: 1,
      }),
      {
        pricing_mode: 'bargain',
        accepted_amount_paise: null,
        bargain_floor_paise: 1,
      },
    )
  })
})
