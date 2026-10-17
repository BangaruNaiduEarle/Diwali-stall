import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import ProductImageLightbox from '../components/ProductImageLightbox'

const ProductImageLightboxContext = createContext(null)

export function ProductImageLightboxProvider({ children }) {
  const [state, setState] = useState(null)

  const closeLightbox = useCallback(() => setState(null), [])

  const openLightbox = useCallback(({ productName, images, startIndex = 0 }) => {
    const urls = (images ?? []).filter(Boolean)
    if (!urls.length) return
    const index = Math.min(Math.max(0, startIndex), urls.length - 1)
    setState({ productName: productName?.trim() || 'Product', images: urls, index })
  }, [])

  const value = useMemo(
    () => ({
      openLightbox,
      closeLightbox,
      isOpen: Boolean(state),
    }),
    [openLightbox, closeLightbox, state],
  )

  return (
    <ProductImageLightboxContext.Provider value={value}>
      {children}
      {state ? (
        <ProductImageLightbox
          productName={state.productName}
          images={state.images}
          initialIndex={state.index}
          onClose={closeLightbox}
        />
      ) : null}
    </ProductImageLightboxContext.Provider>
  )
}

export function useProductImageLightbox() {
  const ctx = useContext(ProductImageLightboxContext)
  if (!ctx) {
    throw new Error('useProductImageLightbox must be used within ProductImageLightboxProvider')
  }
  return ctx
}
