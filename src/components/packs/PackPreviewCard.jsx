import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Gift } from 'lucide-react'
import { useProductImageLightbox } from '../../context/ProductImageLightboxContext'
import { formatINR } from '../../utils/currency'

const ICON = { strokeWidth: 1.8 }

export default function PackPreviewCard({ pack, className = '' }) {
  const { openLightbox } = useProductImageLightbox()
  const [imgFailed, setImgFailed] = useState(false)
  const imageUrl = pack.image?.trim()
  const showImage = imageUrl && !imgFailed

  const openImage = (e) => {
    if (!showImage) return
    e.preventDefault()
    e.stopPropagation()
    openLightbox({
      productName: pack.name,
      images: [imageUrl],
      startIndex: 0,
    })
  }

  return (
    <article
      className={`pack-preview-card surface-card flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden ${className}`.trim()}
    >
      <div className="pack-preview-card__media relative flex h-[7.75rem] w-full shrink-0 items-center justify-center bg-[var(--color-image-well)] sm:h-[8.5rem] md:h-[10.5rem]">
        {showImage ? (
          <button
            type="button"
            className="product-image-zoom-trigger focus-ring flex h-full w-full cursor-zoom-in items-center justify-center p-2"
            aria-label={`View larger image of ${pack.name}`}
            onClick={openImage}
          >
            <img
              src={imageUrl}
              alt={pack.name}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="max-h-full max-w-full object-contain"
              onError={() => setImgFailed(true)}
            />
          </button>
        ) : (
          <Gift className="h-8 w-8 shrink-0 text-[var(--color-gold)]" {...ICON} aria-hidden="true" />
        )}
      </div>

      <div className="pack-preview-card__body flex min-h-0 flex-1 flex-col px-2.5 pb-2.5 pt-2 md:px-3 md:pb-3 md:pt-2.5">
        <div className="pack-preview-card__meta shrink-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-red)] md:text-[10px]">
            Family pack
          </p>
          <div className="pack-preview-card__title-price mt-0.5 flex min-h-[3.5rem] flex-col gap-1 md:min-h-[3.625rem]">
            <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug tracking-tight text-[var(--color-maroon)] md:text-sm">
              {pack.name}
            </h3>
            <p className="text-base font-bold tabular-nums leading-none text-[var(--color-charcoal)] md:text-lg">
              {formatINR(pack.price)}
            </p>
            <div className="min-h-0 flex-1" aria-hidden="true" />
          </div>
        </div>

        <Link
          to={`/packs/${pack.slug}`}
          className="pack-preview-card__cta focus-ring mt-4 inline-flex min-h-9 w-full shrink-0 items-center justify-center rounded-[var(--btn-radius)] border border-[var(--color-border)] bg-[var(--color-white)] px-2.5 text-xs font-semibold text-[var(--color-maroon)] transition-ui hover:border-[var(--color-gold)] md:mt-[1.125rem] md:min-h-10 md:px-3 md:text-sm"
        >
          View Pack
        </Link>

        <div className="pack-preview-card__fill min-h-0 flex-1" aria-hidden="true" />
      </div>
    </article>
  )
}
