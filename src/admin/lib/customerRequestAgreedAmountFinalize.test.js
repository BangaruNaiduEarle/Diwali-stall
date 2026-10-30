import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  customerAgreedAmountReadyToFinalize,
  parseCustomerAgreedInrToPaise,
} from './customerRequestAgreedAmountFinalize.js'

describe('customerAgreedAmountReadyToFinalize', () => {
  it('blocks when input is empty but quotation still has a saved amount', () => {
    assert.equal(
      customerAgreedAmountReadyToFinalize({ acceptedAmountPaise: 250_000 }, ''),
      false,
    )
  })

  it('blocks when input is valid but not saved on quotation', () => {
    assert.equal(
      customerAgreedAmountReadyToFinalize({ acceptedAmountPaise: null }, '2500'),
      false,
    )
  })

  it('blocks when input differs from saved quotation amount', () => {
    assert.equal(
      customerAgreedAmountReadyToFinalize({ acceptedAmountPaise: 250_000 }, '2600'),
      false,
    )
  })

  it('allows when input matches saved positive quotation amount', () => {
    assert.equal(
      customerAgreedAmountReadyToFinalize({ acceptedAmountPaise: 250_000 }, '2500'),
      true,
    )
  })
})

describe('parseCustomerAgreedInrToPaise', () => {
  it('rejects zero', () => {
    assert.equal(parseCustomerAgreedInrToPaise('0').ok, false)
  })
})
