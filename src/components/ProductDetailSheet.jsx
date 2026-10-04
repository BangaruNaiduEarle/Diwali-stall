import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'
import { useEstimate } from '../context/EstimateContext'
import { formatINR } from '../utils/currency'
import { isProductSoldOut } from '../utils/estimateHelpers'
import Button from './ui/Button'
import ProductImageCarousel from './ProductImageCarousel'
import QuantityControl from './QuantityControl'

const ICON = { strokeWidth: 1.8 }

export default function ProductDetailSheet({ product, open, onClose, initialImageIndex = 0 }) {
  const sheetRef = useRef(null)
  const titleId = useId()
  const [carouselMountKey, setCarouselMountKey] = useState(0)
  const [sheetStartIndex, setSheetStartIndex] = useState(0)
  const { getQuantity, addToEstimate, increaseQuantity, decreaseQuantity } = useEstimate()

  useEffect(() => {
    if (!open) return
    setSheetStartIndex(initialImageIndex)
    setCarouselMountKey((k) => k + 1)
  }, [open, initialImageIndex, product?.id])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    sheetRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!product || !open) return null

  const soldOut = isProductSoldOut(product)
  const quantity = getQuantity(product.id)
  const inEstimate = quantity > 0

  const sheet = (
    <>
      <button
        type="button"
        aria-label="Close product details"
        className="fixed inset-0 z-[90] bg-black/40 opacity-100 transition-opacity duration-300 ease-out"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="safe-bottom fixed inset-x-0 bottom-0 z-[100] flex max-h-[90svh] translate-y-0 flex-col rounded-t-xl border border-[var(--color-border)] bg-[var(--color-ivory)] shadow-[var(--shadow-hover)] outline-none transition-transform duration-300 ease-out md:left-1/2 md:max-w-lg md:-translate-x-1/2"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Product</p>
          <button
            type="button"
            className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-full"
            aria-label="Close product details"
            onClick={onClose}
          >
            <X className="h-5 w-5" {...ICON} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <ProductImageCarousel
            key={`${product.id}-${carouselMountKey}`}
            images={product.images}
            productName={product.name}
            productId={product.id}
            legacyImage={product.image}
            variant="detail"
            initialSlide={sheetStartIndex}
          />
          <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-red)]">
            {product.category}
          </p>
          <h2 id={titleId} className="mt-1 text-xl font-semibold text-[var(--color-charcoal)]">
            {product.name}
          </h2>
          {product.pack?.trim() ? (
            <p className="mt-1 text-sm text-[var(--color-muted)]">{product.pack.trim()}</p>
          ) : null}

          <div className="mt-4 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xl font-bold text-[var(--color-maroon)]">{formatINR(product.price)}</span>
            {product.referencePrice > product.price ? (
              <>
                <span className="shrink-0 text-sm text-[var(--color-ref-price)] line-through">
                  {formatINR(product.referencePrice)}
                </span>
                <span className="discount-pill shrink-0">{product.discount ?? 20}% off</span>
              </>
            ) : null}
          </div>

          {soldOut ? (
            <p className="mt-3 text-sm font-medium text-[var(--color-red)]">Sold out at the stall</p>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              Available — add to your estimate to request on WhatsApp.
            </p>
          )}

          {product.description?.trim() ? (
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted)]">{product.description.trim()}</p>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-[var(--color-border)] p-4">
          {inEstimate && !soldOut ? (
            <QuantityControl
              quantity={quantity}
              productName={product.name}
              onIncrease={() => increaseQuantity(product.id)}
              onDecrease={() => decreaseQuantity(product.id)}
            />
          ) : (
            <Button
              type="button"
              variant="primary"
              size="md"
              icon={Plus}
              fullWidth
              disabled={soldOut}
              onClick={() => addToEstimate(product.id)}
            >
              Add to estimate
            </Button>
          )}
        </div>
      </div>
    </>
  )

  return typeof document !== 'undefined' ? createPortal(sheet, document.body) : null
}
