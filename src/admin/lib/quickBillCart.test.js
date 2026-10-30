import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addProductToCart,
  cartItemCount,
  cartToCheckoutItems,
  getCartLineQuantity,
  removeCartLine,
  setCartLineQuantity,
} from './quickBillCart.js'

describe('quickBillCart', () => {
  it('reads box and piece quantities from cart lines', () => {
    let cart = addProductToCart([], { productId: 'P001', name: 'A' }, 2, 'box')
    cart = addProductToCart(cart, { productId: 'P001', name: 'A', allowLooseSale: true }, 5, 'piece')
    assert.equal(getCartLineQuantity(cart, 'P001', 'box'), 2)
    assert.equal(getCartLineQuantity(cart, 'P001', 'piece'), 5)
    assert.equal(getCartLineQuantity(cart, 'P999', 'box'), null)
  })

  it('merges duplicate product lines when adding', () => {
    let cart = addProductToCart([], { productId: 'P001', name: 'A' }, 2)
    cart = addProductToCart(cart, { productId: 'P001', name: 'A' }, 3)
    assert.equal(cart.length, 1)
    assert.equal(cart[0].quantity, 5)
  })

  it('caps quantity at 99', () => {
    let cart = addProductToCart([], { productId: 'P002', name: 'B' }, 95)
    cart = addProductToCart(cart, { productId: 'P002', name: 'B' }, 10)
    assert.equal(cart[0].quantity, 99)
  })

  it('updates quantity and removes at zero', () => {
    const cart = [{ productId: 'P003', name: 'C', quantity: 2, unitType: 'box' }]
    const updated = setCartLineQuantity(cart, 'P003', 4, 'box')
    assert.equal(updated[0].quantity, 4)
    const removed = setCartLineQuantity(updated, 'P003', 0, 'box')
    assert.equal(removed.length, 0)
  })

  it('removes lines and maps checkout payload', () => {
    const cart = [
      { productId: 'P001', name: 'A', quantity: 1, unitType: 'box' },
      { productId: 'P002', name: 'B', quantity: 2, unitType: 'box' },
    ]
    const trimmed = removeCartLine(cart, 'P001', 'box')
    assert.equal(trimmed.length, 1)
    assert.deepEqual(cartToCheckoutItems(trimmed), [{ productId: 'P002', quantity: 2, unitType: 'box' }])
    assert.equal(cartItemCount(cart), 3)
  })
})
