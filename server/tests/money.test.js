import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inrToPaise, lineTotalPaise, paiseToInr, sumPaise } from '../src/services/money.js'

describe('money (integer paise)', () => {
  it('converts INR to paise without float drift', () => {
    assert.equal(inrToPaise(10.5), 1050)
    assert.equal(paiseToInr(1050), 10.5)
  })

  it('computes line totals in integer paise', () => {
    assert.equal(lineTotalPaise(3, 250), 750)
    assert.equal(sumPaise([750, 100, 50]), 900)
  })
})
