import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getProductUnitLabel, resolveEstimateLineUnitLabel } from './productUnitLabel.js'

describe('productUnitLabel', () => {
  it('prefers unit_label and trims', () => {
    assert.equal(getProductUnitLabel({ unit_label: '  Box  ', pack: 'Packet' }), 'Box')
    assert.equal(getProductUnitLabel({ unitLabel: 'Piece' }), 'Piece')
  })

  it('falls back to pack when unit_label is empty', () => {
    assert.equal(getProductUnitLabel({ pack: 'Box of 10' }), 'Box of 10')
  })

  it('returns blank when no label is set', () => {
    assert.equal(getProductUnitLabel({ pack: '' }), '')
    assert.equal(getProductUnitLabel(null), '')
  })

  it('resolveEstimateLineUnitLabel uses snapshot then product', () => {
    assert.equal(resolveEstimateLineUnitLabel('Packet', { pack: 'Box' }), 'Packet')
    assert.equal(resolveEstimateLineUnitLabel('', { pack: 'Box' }), 'Box')
    assert.equal(resolveEstimateLineUnitLabel(null, null), '')
  })
})
