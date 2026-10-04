import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useEstimate } from '../context/EstimateContext'
import { formatINR } from '../utils/currency'
import { isProductSoldOut } from '../utils/estimateHelpers'
import Button from './ui/Button'
import ProductDetailSheet from './ProductDetailSheet'
import ProductImageCarousel from './ProductImageCarousel'
import QuantityControl from './QuantityControl'

export default function ProductCard({ product }) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [cardImageIndex, setCardImageIndex] = useState(0)
  const soldOut = isProductSoldOut(product)
  const { getQuantity, addToEstimate, increaseQuantity, decreaseQuantity } = useEstimate()
  const quantity = getQuantity(product.id)
  const inEstimate = quantity > 0

  const openDetails = () => setDetailOpen(true)

  return (
    <>
      <article className="product-card-surface group flex h-full flex-col md:transition-ui md:hover:-translate-y-0.5 md:hover:shadow-[var(--shadow-hover)]">
        <div
          role="button"
          tabIndex={0}
          className="focus-ring block w-full overflow-hidden rounded-[calc(var(--radius-lg)-2px)] text-left"
          onClick={openDetails}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openDetails()
            }
          }}
          aria-label={`View details for ${product.name}`}
        >
          <ProductImageCarousel
            images={product.images}
            productName={product.name}
            productId={product.id}
            legacyImage={product.image}
            onSlideChange={setCardImageIndex}
          />
        </div>

        <div className="flex flex-1 flex-col pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-red)]">
            {product.category}
          </p>
          <button
            type="button"
            className="focus-ring mt-1 line-clamp-2 min-h-[2.5rem] text-left text-[13px] font-semibold leading-snug text-[var(--color-charcoal)] sm:text-[14px] md:min-h-[2.35rem] md:text-[15px]"
            onClick={openDetails}
          >
            {product.name}
          </button>
          {product.pack?.trim() ? (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-muted)]">{product.pack.trim()}</p>
          ) : null}

          <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <span className="shrink-0 text-[15px] font-bold tracking-tight text-[var(--color-maroon)] sm:text-base">
              {formatINR(product.price)}
            </span>
            {product.referencePrice > product.price ? (
              <>
                <span className="max-w-full truncate text-[10px] text-[var(--color-ref-price)] line-through sm:text-[11px]">
                  {formatINR(product.referencePrice)}
                </span>
                <span className="discount-pill shrink-0 text-[9px] sm:text-[10px]">{product.discount ?? 20}% off</span>
              </>
            ) : null}
          </div>

          {soldOut ? (
            <p className="mt-2 text-[11px] text-[var(--color-red)]">Sold out</p>
          ) : null}

          <div className="mt-auto flex justify-center pt-3 md:pt-4" onClick={(e) => e.stopPropagation()}>
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
                variant="secondary"
                size="sm"
                icon={Plus}
                fullWidth
                disabled={soldOut}
                aria-label={`Add ${product.name} to estimate`}
                className="!px-2 !text-xs sm:!px-4 sm:!text-sm"
                onClick={() => addToEstimate(product.id)}
              >
                <span className="sm:hidden">Add</span>
                <span className="hidden sm:inline">Add to estimate</span>
              </Button>
            )}
          </div>
        </div>
      </article>

      <ProductDetailSheet
        product={product}
        open={detailOpen}
        initialImageIndex={cardImageIndex}
        onClose={() => setDetailOpen(false)}
      />
    </>
  )
}
