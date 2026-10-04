import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ESTIMATE_MAX_QUANTITY,
  computeEstimateCount,
  computeEstimateSubtotal,
  getProductById,
  isProductSoldOut,
  loadEstimateFromStorage,
  saveEstimateToStorage,
} from '../utils/estimateHelpers'

const EstimateContext = createContext(null)

function canAddProduct(productId) {
  const product = getProductById(productId)
  return product && !isProductSoldOut(product)
}

export function EstimateProvider({ children }) {
  const [estimateItems, setEstimateItems] = useState(() => loadEstimateFromStorage())

  useEffect(() => {
    saveEstimateToStorage(estimateItems)
  }, [estimateItems])

  const setQuantity = useCallback((productId, nextQuantity) => {
    if (!canAddProduct(productId) && nextQuantity > 0) return

    const qty = Math.floor(Number(nextQuantity))
    if (!Number.isFinite(qty)) return

    setEstimateItems((prev) => {
      const index = prev.findIndex((i) => i.productId === productId)
      if (qty <= 0) {
        if (index === -1) return prev
        return prev.filter((i) => i.productId !== productId)
      }
      const clamped = Math.min(ESTIMATE_MAX_QUANTITY, Math.max(1, qty))
      if (index === -1) {
        return [...prev, { productId, quantity: clamped }]
      }
      const copy = [...prev]
      copy[index] = { productId, quantity: clamped }
      return copy
    })
  }, [])

  const addToEstimate = useCallback(
    (productId) => {
      if (!canAddProduct(productId)) return
      setEstimateItems((prev) => {
        const index = prev.findIndex((i) => i.productId === productId)
        if (index === -1) {
          return [...prev, { productId, quantity: 1 }]
        }
        const current = prev[index].quantity
        if (current >= ESTIMATE_MAX_QUANTITY) return prev
        const copy = [...prev]
        copy[index] = { productId, quantity: current + 1 }
        return copy
      })
    },
    [],
  )

  const removeFromEstimate = useCallback((productId) => {
    setEstimateItems((prev) => prev.filter((i) => i.productId !== productId))
  }, [])

  const updateQuantity = useCallback(
    (productId, quantity) => {
      setQuantity(productId, quantity)
    },
    [setQuantity],
  )

  const increaseQuantity = useCallback(
    (productId) => {
      setEstimateItems((prev) => {
        const index = prev.findIndex((i) => i.productId === productId)
        if (index === -1) {
          if (!canAddProduct(productId)) return prev
          return [...prev, { productId, quantity: 1 }]
        }
        const current = prev[index].quantity
        if (current >= ESTIMATE_MAX_QUANTITY) return prev
        const copy = [...prev]
        copy[index] = { productId, quantity: current + 1 }
        return copy
      })
    },
    [],
  )

  const decreaseQuantity = useCallback((productId) => {
    setEstimateItems((prev) => {
      const index = prev.findIndex((i) => i.productId === productId)
      if (index === -1) return prev
      const current = prev[index].quantity
      if (current <= 1) {
        return prev.filter((i) => i.productId !== productId)
      }
      const copy = [...prev]
      copy[index] = { productId, quantity: current - 1 }
      return copy
    })
  }, [])

  const clearEstimate = useCallback(() => {
    setEstimateItems([])
  }, [])

  const getQuantity = useCallback(
    (productId) => estimateItems.find((i) => i.productId === productId)?.quantity ?? 0,
    [estimateItems],
  )

  const estimateCount = useMemo(() => computeEstimateCount(estimateItems), [estimateItems])
  const estimateSubtotal = useMemo(() => computeEstimateSubtotal(estimateItems), [estimateItems])
  const uniqueProductCount = estimateItems.length

  const value = useMemo(
    () => ({
      estimateItems,
      estimateCount,
      estimateSubtotal,
      uniqueProductCount,
      addToEstimate,
      removeFromEstimate,
      updateQuantity,
      increaseQuantity,
      decreaseQuantity,
      clearEstimate,
      getQuantity,
    }),
    [
      estimateItems,
      estimateCount,
      estimateSubtotal,
      uniqueProductCount,
      addToEstimate,
      removeFromEstimate,
      updateQuantity,
      increaseQuantity,
      decreaseQuantity,
      clearEstimate,
      getQuantity,
    ],
  )

  return <EstimateContext.Provider value={value}>{children}</EstimateContext.Provider>
}

export function useEstimate() {
  const ctx = useContext(EstimateContext)
  if (!ctx) {
    throw new Error('useEstimate must be used within EstimateProvider')
  }
  return ctx
}
