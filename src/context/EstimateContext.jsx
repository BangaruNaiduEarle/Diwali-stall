import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ESTIMATE_MAX_QUANTITY,
  buildFamilyPackEstimateSnapshot,
  computeEstimateCount,
  computeEstimateSubtotal,
  getProductById,
  isFamilyPackEstimateItem,
  isProductSoldOut,
  loadEstimateFromStorage,
  persistDraftEstimateItems,
} from '../utils/estimateHelpers'
import { isFamilyPackAvailableForEstimate } from '../utils/familyPackCatalogue.js'
import { appendSharedEstimate, loadEstimateHistoryFromStorage } from '../utils/estimateHistory.js'

const EstimateContext = createContext(null)

function canAddProduct(productId) {
  const product = getProductById(productId)
  return product && !isProductSoldOut(product)
}

export function EstimateProvider({ children }) {
  const [estimateItems, setEstimateItems] = useState(() => loadEstimateFromStorage())
  const [sharedHistory, setSharedHistory] = useState(() => loadEstimateHistoryFromStorage())

  useEffect(() => {
    persistDraftEstimateItems(estimateItems)
  }, [estimateItems])

  const applyDraftItems = useCallback((updater) => {
    setEstimateItems((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      return persistDraftEstimateItems(next)
    })
  }, [])

  const setQuantity = useCallback((productId, nextQuantity) => {
    if (!canAddProduct(productId) && nextQuantity > 0) return

    const qty = Math.floor(Number(nextQuantity))
    if (!Number.isFinite(qty)) return

    applyDraftItems((prev) => {
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
  }, [applyDraftItems])

  const addToEstimate = useCallback(
    (productId) => {
      if (!canAddProduct(productId)) return
      applyDraftItems((prev) => {
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
    [applyDraftItems],
  )

  const removeFromEstimate = useCallback(
    (productId) => {
      applyDraftItems((prev) => prev.filter((i) => i.productId !== productId))
    },
    [applyDraftItems],
  )

  const removeFamilyPackFromEstimate = useCallback(
    (familyPackId) => {
      applyDraftItems((prev) => prev.filter((i) => !isFamilyPackEstimateItem(i) || i.familyPackId !== familyPackId))
    },
    [applyDraftItems],
  )

  const addFamilyPackToEstimate = useCallback(
    (familyPackId) => {
      if (!isFamilyPackAvailableForEstimate(familyPackId)) return
      const snapshot = buildFamilyPackEstimateSnapshot(familyPackId)
      if (!snapshot) return
      applyDraftItems((prev) => {
        const index = prev.findIndex((i) => isFamilyPackEstimateItem(i) && i.familyPackId === familyPackId)
        if (index === -1) {
          return [
            ...prev,
            {
              familyPackId,
              quantity: 1,
              snapshotName: snapshot.snapshotName,
              snapshotPricePaise: snapshot.snapshotPricePaise,
            },
          ]
        }
        const current = prev[index].quantity
        if (current >= ESTIMATE_MAX_QUANTITY) return prev
        const copy = [...prev]
        copy[index] = {
          ...copy[index],
          quantity: current + 1,
          snapshotName: snapshot.snapshotName,
          snapshotPricePaise: snapshot.snapshotPricePaise,
        }
        return copy
      })
    },
    [applyDraftItems],
  )

  const setFamilyPackQuantity = useCallback(
    (familyPackId, nextQuantity) => {
      const qty = Math.floor(Number(nextQuantity))
      if (!Number.isFinite(qty)) return
      applyDraftItems((prev) => {
        const index = prev.findIndex((i) => isFamilyPackEstimateItem(i) && i.familyPackId === familyPackId)
        if (qty <= 0) {
          if (index === -1) return prev
          return prev.filter((i) => !isFamilyPackEstimateItem(i) || i.familyPackId !== familyPackId)
        }
        if (!isFamilyPackAvailableForEstimate(familyPackId)) {
          if (index === -1) return prev
        }
        const snapshot = buildFamilyPackEstimateSnapshot(familyPackId)
        const clamped = Math.min(ESTIMATE_MAX_QUANTITY, Math.max(1, qty))
        if (index === -1) {
          if (!snapshot) return prev
          return [
            ...prev,
            {
              familyPackId,
              quantity: clamped,
              snapshotName: snapshot.snapshotName,
              snapshotPricePaise: snapshot.snapshotPricePaise,
            },
          ]
        }
        const copy = [...prev]
        copy[index] = {
          ...copy[index],
          quantity: clamped,
          ...(snapshot
            ? { snapshotName: snapshot.snapshotName, snapshotPricePaise: snapshot.snapshotPricePaise }
            : {}),
        }
        return copy
      })
    },
    [applyDraftItems],
  )

  const updateQuantity = useCallback(
    (productId, quantity) => {
      setQuantity(productId, quantity)
    },
    [setQuantity],
  )

  const increaseQuantity = useCallback(
    (productId) => {
      applyDraftItems((prev) => {
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
    [applyDraftItems],
  )

  const decreaseQuantity = useCallback(
    (productId) => {
      applyDraftItems((prev) => {
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
    },
    [applyDraftItems],
  )

  const clearEstimate = useCallback(() => {
    const empty = persistDraftEstimateItems([])
    setEstimateItems(empty)
    return empty
  }, [])

  /**
   * @param {{ submissionFingerprint: string, items: { productId: string, quantity: number, unit?: string | null }[], reference?: string }} payload
   */
  const archiveSharedEstimate = useCallback((payload) => {
    const result = appendSharedEstimate(payload, loadEstimateHistoryFromStorage())
    setSharedHistory(result.records)
    return result
  }, [])

  const startNewDraftEstimate = useCallback(() => {
    const empty = persistDraftEstimateItems([])
    setEstimateItems(empty)
    return empty
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
      removeFamilyPackFromEstimate,
      addFamilyPackToEstimate,
      setFamilyPackQuantity,
      updateQuantity,
      increaseQuantity,
      decreaseQuantity,
      clearEstimate,
      startNewDraftEstimate,
      archiveSharedEstimate,
      sharedHistory,
      getQuantity,
    }),
    [
      estimateItems,
      estimateCount,
      estimateSubtotal,
      uniqueProductCount,
      addToEstimate,
      removeFromEstimate,
      removeFamilyPackFromEstimate,
      addFamilyPackToEstimate,
      setFamilyPackQuantity,
      updateQuantity,
      increaseQuantity,
      decreaseQuantity,
      clearEstimate,
      startNewDraftEstimate,
      archiveSharedEstimate,
      sharedHistory,
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
