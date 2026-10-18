import { useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { quickBillThumbViewModel } from '../lib/quickBillProductImage.js'

/**
 * Compact product thumb for Quick Bill — HTTPS URLs from admin API / D1 only.
 * @param {{ src?: string, label?: string, className?: string }} props
 */
export default function AdminQuickBillProductThumb({ src = '', label = '', className = '' }) {
  const [failed, setFailed] = useState(false)
  const { showImage, imageSrc } = quickBillThumbViewModel(src, failed)
  const rootClass = `admin-quick-bill__thumb${className ? ` ${className}` : ''}`

  return (
    <div className={rootClass} aria-hidden={showImage ? true : undefined}>
      {showImage ? (
        <img
          className="admin-quick-bill__thumb-img"
          src={imageSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="admin-quick-bill__thumb-placeholder" title="No image">
          <ImageIcon className="admin-quick-bill__thumb-icon" aria-hidden="true" />
        </span>
      )}
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  )
}
