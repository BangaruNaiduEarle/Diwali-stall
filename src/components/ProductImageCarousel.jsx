import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Package } from 'lucide-react'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Navigation, Pagination } from 'swiper/modules'
import {
  getProductIdFallbackImageSlots,
  normalizeProductImageUrl,
  normalizeProductImages,
} from '../utils/productImage'

import 'swiper/css'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

const ICON = { strokeWidth: 1.8 }

function buildExplicitUrls(images, legacyImage) {
  const fromData = normalizeProductImages(images)
  if (fromData.length) return fromData
  const legacy = normalizeProductImageUrl(legacyImage)
  return legacy ? [legacy] : []
}

export default function ProductImageCarousel({
  images = [],
  productName = '',
  productId = '',
  legacyImage = '',
  variant = 'card',
  initialSlide = 0,
  onSlideChange,
}) {
  const uid = useId().replace(/:/g, '')
  const label = productName?.trim() || 'Product'
  const isDetail = variant === 'detail'
  const swiperRef = useRef(null)
  const paginationRef = useRef(null)

  const explicitUrls = useMemo(
    () => buildExplicitUrls(images, legacyImage),
    [images, legacyImage],
  )

  const fallbackSlots = useMemo(() => {
    if (explicitUrls.length) return []
    return getProductIdFallbackImageSlots(productId)
  }, [explicitUrls.length, productId])

  const [brokenUrls, setBrokenUrls] = useState(() => new Set())
  const [resolvedFallbackUrls, setResolvedFallbackUrls] = useState([])
  const [exhaustedFallbackSlots, setExhaustedFallbackSlots] = useState(0)

  const sourceKey = explicitUrls.length
    ? explicitUrls.join('|')
    : fallbackSlots.map((s) => s[0]).join('|')

  useEffect(() => {
    setBrokenUrls(new Set())
    setResolvedFallbackUrls([])
    setExhaustedFallbackSlots(0)
  }, [productId, sourceKey])

  const slideUrls = useMemo(() => {
    if (explicitUrls.length) {
      return explicitUrls.filter((url) => !brokenUrls.has(url))
    }
    return resolvedFallbackUrls.filter((url) => !brokenUrls.has(url))
  }, [explicitUrls, resolvedFallbackUrls, brokenUrls])

  const multi = slideUrls.length > 1
  const awaitingFallback =
    explicitUrls.length === 0 &&
    fallbackSlots.length > 0 &&
    resolvedFallbackUrls.length === 0 &&
    exhaustedFallbackSlots < fallbackSlots.length

  const showComingSoon =
    slideUrls.length === 0 &&
    !awaitingFallback &&
    (explicitUrls.length === 0
      ? fallbackSlots.length === 0 || exhaustedFallbackSlots >= fallbackSlots.length
      : true)

  const aspectClass = isDetail ? 'aspect-[4/3] sm:aspect-[5/4]' : 'aspect-[4/3]'
  const padClass = isDetail ? 'p-3 sm:p-4' : 'p-2'

  const goPrevious = (event) => {
    event.preventDefault()
    event.stopPropagation()
    swiperRef.current?.slidePrev()
  }

  const goNext = (event) => {
    event.preventDefault()
    event.stopPropagation()
    swiperRef.current?.slideNext()
  }

  const bindPagination = useCallback(
    (swiper) => {
      if (!multi || !paginationRef.current) return
      swiper.params.pagination.el = paginationRef.current
      if (swiper.pagination) {
        swiper.pagination.destroy()
        swiper.pagination.init()
        swiper.pagination.render()
        swiper.pagination.update()
      }
    },
    [multi],
  )

  const onSwiper = (swiper) => {
    swiperRef.current = swiper
    bindPagination(swiper)
    const start = Math.min(initialSlide, Math.max(slideUrls.length - 1, 0))
    if (start > 0) {
      if (multi && swiper.params.loop) {
        swiper.slideToLoop(start, 0)
      } else {
        swiper.slideTo(start, 0)
      }
    }
  }

  useEffect(() => {
    const swiper = swiperRef.current
    if (!swiper) return
    bindPagination(swiper)
  }, [slideUrls.length, multi, bindPagination])

  const onImageError = (url) => {
    setBrokenUrls((prev) => {
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }

  if (showComingSoon) {
    return (
      <div
        className={`product-image-carousel relative w-full overflow-hidden rounded-[calc(var(--radius-lg)-2px)] bg-[var(--color-ivory)] ${aspectClass}`}
      >
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-2"
          role="img"
          aria-label={`${label} — image not available`}
        >
          <Package className={`${isDetail ? 'h-8 w-8' : 'h-6 w-6'} text-[var(--color-gold)]`} {...ICON} />
          <span className={`${isDetail ? 'text-xs' : 'text-[10px]'} font-medium text-[var(--color-muted)]`}>
            Image coming soon
          </span>
        </div>
      </div>
    )
  }

  if (awaitingFallback) {
    return (
      <div
        className={`product-image-carousel relative w-full overflow-hidden rounded-[calc(var(--radius-lg)-2px)] bg-[var(--color-ivory)] ${aspectClass}`}
      >
        <div className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden="true">
          {fallbackSlots.map((candidates, slotIndex) => (
            <FallbackSlotProbe
              key={`${uid}-slot-${slotIndex}`}
              candidates={candidates}
              onResolved={(url) => {
                setResolvedFallbackUrls((prev) => (prev.includes(url) ? prev : [...prev, url]))
              }}
              onExhausted={() => setExhaustedFallbackSlots((n) => n + 1)}
            />
          ))}
        </div>
        <div className="flex h-full w-full items-center justify-center">
          <span className="sr-only">Loading product image</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`product-image-carousel group/carousel relative w-full overflow-hidden rounded-[calc(var(--radius-lg)-2px)] bg-[var(--color-ivory)] ${aspectClass}`}
      data-carousel-id={uid}
    >
      <Swiper
        className="product-image-swiper !absolute inset-0 h-full w-full"
        modules={[Navigation, Pagination]}
        slidesPerView={1}
        spaceBetween={0}
        loop={multi}
        speed={300}
        initialSlide={Math.min(initialSlide, Math.max(slideUrls.length - 1, 0))}
        allowTouchMove={multi}
        preventClicksPropagation
        preventInteractionOnTransition
        watchOverflow
        pagination={
          multi
            ? {
                clickable: true,
                bulletClass: 'product-swiper-bullet',
                bulletActiveClass: 'product-swiper-bullet-active',
              }
            : false
        }
        onBeforeInit={(swiper) => {
          if (multi && paginationRef.current) {
            swiper.params.pagination.el = paginationRef.current
          }
        }}
        onSwiper={onSwiper}
        onSlideChange={(swiper) => {
          onSlideChange?.(swiper.realIndex)
        }}
      >
        {slideUrls.map((url, index) => (
          <SwiperSlide key={`${uid}-${url}`} className="!flex h-full items-center justify-center">
            <div className={`flex h-full w-full items-center justify-center ${padClass}`}>
              <img
                src={url}
                alt={`${label} - image ${index + 1}`}
                loading={index === 0 ? (isDetail ? 'eager' : 'lazy') : 'lazy'}
                decoding="async"
                draggable={false}
                className="max-h-full max-w-full object-contain"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={() => onImageError(url)}
              />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      {multi ? (
        <>
          <button
            type="button"
            data-carousel-control
            className="product-carousel-nav focus-ring absolute left-1.5 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-white)]/95 text-[var(--color-charcoal)] shadow-sm md:inline-flex"
            aria-label="Previous image"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={goPrevious}
          >
            <ChevronLeft className="h-4 w-4" {...ICON} />
          </button>
          <button
            type="button"
            data-carousel-control
            className="product-carousel-nav focus-ring absolute right-1.5 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-white)]/95 text-[var(--color-charcoal)] shadow-sm md:inline-flex"
            aria-label="Next image"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={goNext}
          >
            <ChevronRight className="h-4 w-4" {...ICON} />
          </button>

          <div
            ref={paginationRef}
            className="product-carousel-pagination pointer-events-auto absolute inset-x-0 bottom-1.5 z-20 flex justify-center"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />

          {isDetail ? (
            <SlideCounter swiperRef={swiperRef} total={slideUrls.length} />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function SlideCounter({ swiperRef, total }) {
  const [index, setIndex] = useState(1)

  useEffect(() => {
    const swiper = swiperRef.current
    if (!swiper) return

    const update = () => setIndex(swiper.realIndex + 1)
    update()
    swiper.on('slideChange', update)
    return () => {
      swiper.off('slideChange', update)
    }
  }, [swiperRef, total])

  return (
    <p
      className="pointer-events-none absolute right-3 top-3 z-20 rounded-full bg-[var(--color-white)]/90 px-2.5 py-1 text-[11px] font-medium tabular-nums text-[var(--color-charcoal)] shadow-sm"
      aria-live="polite"
    >
      {index} / {total}
    </p>
  )
}

function FallbackSlotProbe({ candidates, onResolved, onExhausted }) {
  const [tryIndex, setTryIndex] = useState(0)
  const done = useRef(false)
  const src = tryIndex < candidates.length ? candidates[tryIndex] : null

  useEffect(() => {
    setTryIndex(0)
    done.current = false
  }, [candidates.join('|')])

  useEffect(() => {
    if (!src && !done.current) {
      done.current = true
      onExhausted()
    }
  }, [src, onExhausted])

  if (!src) return null

  return (
    <img
      src={src}
      alt=""
      decoding="async"
      onLoad={() => {
        if (!done.current) {
          done.current = true
          onResolved(src)
        }
      }}
      onError={() => setTryIndex((i) => i + 1)}
    />
  )
}
