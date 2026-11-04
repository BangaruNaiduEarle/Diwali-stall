import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchAllPublicProducts } from '../api/publicProducts.js'
import { mapAndSortPublicProducts } from '../utils/mapPublicProduct.js'
import { buildCatalogueCategories } from '../utils/catalogueCategories.js'
import { setEstimateCatalogueProducts } from '../utils/estimateHelpers.js'

/** @typedef {ReturnType<import('../utils/mapPublicProduct.js').mapPublicProductFromApi> & {}} StorefrontProduct */

const CatalogueProductsContext = createContext(
  /** @type {null | {
   *   products: StorefrontProduct[],
   *   categories: Array<{ slug: string, label: string }>,
   *   loading: boolean,
   *   error: string | null,
   *   refresh: () => void,
   *   getProductById: (id: string) => StorefrontProduct | null,
   * }} */ (null),
)

export function CatalogueProductsProvider({ children }) {
  const [products, setProducts] = useState(/** @type {StorefrontProduct[]} */ ([]))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [refreshToken, setRefreshToken] = useState(0)
  const productsRef = useRef(/** @type {StorefrontProduct[]} */ ([]))

  const refresh = useCallback(() => {
    setRefreshToken((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const hadCatalogue = productsRef.current.length > 0
      if (!hadCatalogue) {
        setLoading(true)
      }
      setError(null)

      const result = await fetchAllPublicProducts()
      if (cancelled) return

      if (!result.ok) {
        setError(result.message)
        setLoading(false)
        return
      }

      const mapped = mapAndSortPublicProducts(result.products)
      productsRef.current = mapped
      setProducts(mapped)
      setEstimateCatalogueProducts(mapped)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [refreshToken])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const categories = useMemo(() => buildCatalogueCategories(products), [products])

  const getProductById = useCallback((id) => productById.get(String(id ?? '').trim()) ?? null, [productById])

  const value = useMemo(
    () => ({
      products,
      categories,
      loading,
      error,
      refresh,
      getProductById,
    }),
    [products, categories, loading, error, refresh, getProductById],
  )

  return <CatalogueProductsContext.Provider value={value}>{children}</CatalogueProductsContext.Provider>
}

export function useCatalogueProducts() {
  const ctx = useContext(CatalogueProductsContext)
  if (!ctx) {
    throw new Error('useCatalogueProducts must be used within CatalogueProductsProvider')
  }
  return ctx
}
