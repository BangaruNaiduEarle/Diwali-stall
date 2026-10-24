import { X } from 'lucide-react'

/**
 * Non-blocking success/error toast for admin (fixed, auto-dismiss via parent).
 * @param {{
 *   variant?: 'success' | 'error'
 *   message: string | null | undefined
 *   onDismiss?: () => void
 * }} props
 */
export default function AdminToast({ variant = 'success', message, onDismiss }) {
  const text = String(message ?? '').trim()
  if (!text) return null

  const role = variant === 'error' ? 'alert' : 'status'
  const variantClass = variant === 'error' ? 'admin-alert--error' : 'admin-alert--success'

  return (
    <div className={`admin-toast admin-alert ${variantClass}`} role={role} aria-live="polite">
      <div className="admin-alert__inner">
        <p className="admin-alert__text">{text}</p>
        {onDismiss ? (
          <button type="button" className="admin-alert__dismiss" onClick={onDismiss} aria-label="Dismiss message">
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
