import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from 'lucide-react'

const ICON = { strokeWidth: 1.8 }
const MIN_SCALE = 1
const MAX_SCALE = 4
const ZOOM_STEP = 0.25

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

function LightboxControlButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      className="product-lightbox-control focus-ring inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-ivory)]/95 text-[var(--color-charcoal)] shadow-sm transition-colors hover:bg-[var(--color-white)] disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function ProductImageLightbox({ productName, images, initialIndex, onClose }) {
  const titleId = useId()
  const dialogRef = useRef(null)
  const viewportRef = useRef(null)
  const [index, setIndex] = useState(initialIndex)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)

  const panRef = useRef({ active: false, pointerId: null, startX: 0, startY: 0, baseX: 0, baseY: 0 })
  const pinchRef = useRef({ active: false, startDist: 0, startScale: 1 })

  const multi = images.length > 1
  const currentUrl = images[index]

  const resetTransform = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    setIndex(initialIndex)
    resetTransform()
    setLoaded(false)
    setBroken(false)
  }, [initialIndex, productName, images, resetTransform])

  useEffect(() => {
    resetTransform()
    setLoaded(false)
    setBroken(false)
  }, [currentUrl, resetTransform])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' && multi) {
        e.preventDefault()
        setIndex((i) => (i - 1 + images.length) % images.length)
        return
      }
      if (e.key === 'ArrowRight' && multi) {
        e.preventDefault()
        setIndex((i) => (i + 1) % images.length)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, multi, images.length])

  const zoomIn = () => setScale((s) => clampScale(s + ZOOM_STEP))
  const zoomOut = () => setScale((s) => clampScale(s - ZOOM_STEP))

  const onWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
    setScale((s) => clampScale(s + delta))
  }

  const onPointerDown = (e) => {
    if (scale <= 1) return
    if (e.pointerType === 'touch' && e.isPrimary === false) return
    panRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e) => {
    const pan = panRef.current
    if (!pan.active || pan.pointerId !== e.pointerId) return
    setOffset({
      x: pan.baseX + (e.clientX - pan.startX),
      y: pan.baseY + (e.clientY - pan.startY),
    })
  }

  const onPointerUp = (e) => {
    const pan = panRef.current
    if (pan.pointerId === e.pointerId) {
      panRef.current.active = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
  }

  const touchDistance = (touches) => {
    const [a, b] = touches
    const dx = a.clientX - b.clientX
    const dy = a.clientY - b.clientY
    return Math.hypot(dx, dy)
  }

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      pinchRef.current = {
        active: true,
        startDist: touchDistance(e.touches),
        startScale: scale,
      }
    }
  }

  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current.active) {
      e.preventDefault()
      const dist = touchDistance(e.touches)
      const ratio = dist / pinchRef.current.startDist
      setScale(clampScale(pinchRef.current.startScale * ratio))
    }
  }

  const onTouchEnd = () => {
    pinchRef.current.active = false
  }

  const goPrev = (e) => {
    e?.stopPropagation()
    setIndex((i) => (i - 1 + images.length) % images.length)
  }

  const goNext = (e) => {
    e?.stopPropagation()
    setIndex((i) => (i + 1) % images.length)
  }

  const content = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="product-lightbox-dialog fixed inset-0 z-[120] flex flex-col outline-none"
    >
      <button
        type="button"
        className="product-lightbox-backdrop absolute inset-0 bg-black/70"
        aria-label="Close image viewer"
        tabIndex={-1}
        onClick={onClose}
      />

      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="pointer-events-auto flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1 pr-2">
            <p id={titleId} className="truncate text-sm font-semibold text-[var(--color-ivory)] sm:text-base">
              {productName}
            </p>
            {multi ? (
              <p className="mt-0.5 text-xs tabular-nums text-white/70">
                Image {index + 1} of {images.length}
              </p>
            ) : null}
          </div>
          <LightboxControlButton label="Close image viewer" onClick={onClose}>
            <X className="h-5 w-5" {...ICON} />
          </LightboxControlButton>
        </div>

        <div
          ref={viewportRef}
          className="pointer-events-auto relative min-h-0 flex-1 touch-none px-4 pb-2"
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {multi ? (
            <>
              <button
                type="button"
                className="product-lightbox-nav focus-ring absolute left-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-[var(--color-border)] bg-[var(--color-ivory)]/95 p-2 shadow-sm sm:inline-flex"
                aria-label="Previous image"
                onClick={goPrev}
              >
                <ChevronLeft className="h-5 w-5" {...ICON} />
              </button>
              <button
                type="button"
                className="product-lightbox-nav focus-ring absolute right-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-[var(--color-border)] bg-[var(--color-ivory)]/95 p-2 shadow-sm sm:inline-flex"
                aria-label="Next image"
                onClick={goNext}
              >
                <ChevronRight className="h-5 w-5" {...ICON} />
              </button>
            </>
          ) : null}

          <div className="flex h-full w-full items-center justify-center overflow-hidden">
            {broken ? (
              <p className="rounded-lg bg-[var(--color-ivory)]/90 px-4 py-3 text-sm text-[var(--color-muted)]">
                Image unavailable
              </p>
            ) : (
              <div
                className={`product-lightbox-stage ${scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {!loaded ? (
                  <div
                    className="product-image-skeleton h-[min(70vh,520px)] w-[min(92vw,720px)] max-w-full rounded-lg"
                    aria-hidden="true"
                  />
                ) : null}
                <img
                  src={currentUrl}
                  alt={`${productName} — enlarged view`}
                  draggable={false}
                  className={`max-h-[min(70vh,520px)] max-w-[min(92vw,720px)] object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                  style={{ objectFit: 'contain' }}
                  onLoad={() => setLoaded(true)}
                  onError={() => setBroken(true)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="safe-bottom pointer-events-auto flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <LightboxControlButton label="Zoom in" onClick={zoomIn} disabled={scale >= MAX_SCALE}>
            <Plus className="h-5 w-5" {...ICON} />
          </LightboxControlButton>
          <LightboxControlButton label="Zoom out" onClick={zoomOut} disabled={scale <= MIN_SCALE}>
            <Minus className="h-5 w-5" {...ICON} />
          </LightboxControlButton>
          <LightboxControlButton label="Reset zoom" onClick={resetTransform} disabled={scale === 1 && offset.x === 0 && offset.y === 0}>
            <RotateCcw className="h-5 w-5" {...ICON} />
          </LightboxControlButton>
          {multi ? (
            <div className="flex w-full justify-center gap-2 sm:hidden">
              <LightboxControlButton label="Previous image" onClick={goPrev}>
                <ChevronLeft className="h-5 w-5" {...ICON} />
              </LightboxControlButton>
              <LightboxControlButton label="Next image" onClick={goNext}>
                <ChevronRight className="h-5 w-5" {...ICON} />
              </LightboxControlButton>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
