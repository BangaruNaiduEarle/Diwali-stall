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

        <div className="product-card-body flex min-w-0 flex-1 flex-col pt-1.5 md:pt-3">
          <p className="text-[10px] font-semibold uppercase leading-tight tracking-[0.14em] text-[var(--color-red)] md:tracking-[0.16em]">
            {product.category}
          </p>
          <button
            type="button"
            className="focus-ring mt-0.5 line-clamp-2 min-h-[2.25rem] text-left text-[13px] font-semibold leading-[1.3] text-[var(--color-charcoal)] md:mt-1 md:min-h-[2.35rem] md:text-[15px] md:leading-snug"
            onClick={openDetails}
          >
            {product.name}
          </button>
          {product.pack?.trim() ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] text-[var(--color-muted)] md:text-[11px]">
              {product.pack.trim()}
            </p>
          ) : null}

          <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5 md:mt-2">
            <span className="shrink-0 text-[15px] font-bold leading-none tracking-tight text-[var(--color-maroon)] md:text-base">
              {formatINR(product.price)}
            </span>
          </div>

          {soldOut ? (
            <p className="mt-1 text-[10px] text-[var(--color-red)] md:mt-2 md:text-[11px]">Sold out</p>
          ) : null}

          <div
            className="product-card-actions mt-auto w-full min-w-0 pt-2 md:pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            {inEstimate && !soldOut ? (
              <div className="flex w-full justify-center">
                <QuantityControl
                  quantity={quantity}
                  productName={product.name}
                  onIncrease={() => increaseQuantity(product.id)}
                  onDecrease={() => decreaseQuantity(product.id)}
                />
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Plus}
                fullWidth
                disabled={soldOut}
                aria-label={`Add ${product.name} to estimate`}
                className="product-card-add-btn"
                onClick={() => addToEstimate(product.id)}
              >
                <span className="md:hidden">Add</span>
                <span className="hidden md:inline">Add to estimate</span>
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
