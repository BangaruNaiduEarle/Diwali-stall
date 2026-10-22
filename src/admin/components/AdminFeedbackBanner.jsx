import { X } from 'lucide-react'

/**
 * @param {{
 *   variant?: 'success' | 'error'
 *   message: string | null | undefined
 *   onDismiss?: () => void
 *   className?: string
 * }} props
 */
export default function AdminFeedbackBanner({
  variant = 'success',
  message,
  onDismiss,
  className = '',
}) {
  const text = String(message ?? '').trim()
  if (!text) return null

  const role = variant === 'error' ? 'alert' : 'status'
  const variantClass = variant === 'error' ? 'admin-alert--error' : 'admin-alert--success'

  return (
    <div className={`admin-alert ${variantClass} ${className}`.trim()} role={role}>
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
