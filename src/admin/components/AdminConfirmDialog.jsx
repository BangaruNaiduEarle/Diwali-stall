import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import Button from '../../components/ui/Button.jsx'

/**
 * Accessible confirmation dialog for destructive admin actions.
 */
export default function AdminConfirmDialog({
  open,
  title,
  description,
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  hideConfirm = false,
  onCancel,
  onConfirm,
  confirming = false,
}) {
  const titleId = useId()
  const descId = useId()
  const dialogRef = useRef(/** @type {HTMLDivElement | null} */ (null))

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !confirming) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onCancel, confirming])

  if (!open) return null

  return createPortal(
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="fixed inset-0 z-[95] bg-[var(--color-maroon)]/25 backdrop-blur-[2px]"
        onClick={confirming ? undefined : onCancel}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="fixed left-1/2 top-1/2 z-[100] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border border-[var(--color-gold)]/35 bg-[var(--color-ivory)] p-6 shadow-[var(--shadow-hover)] outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold text-[var(--color-maroon)]">
          {title}
        </h2>
        <div id={descId} className="mt-3 text-sm leading-relaxed text-[var(--color-charcoal)]">
          {description}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          {!hideConfirm ? (
            <Button
              type="button"
              variant={confirmVariant}
              fullWidth
              loading={confirming}
              disabled={confirming}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" surface="light" fullWidth disabled={confirming} onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  )
}
