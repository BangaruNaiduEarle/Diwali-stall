import { useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { imagePreviewSrc } from '../lib/cloudinaryUpload.js'
import { firstAdminProductImagePath } from '../lib/adminProductTableDisplay.js'

/**
 * @param {{ images?: unknown, name?: string }} props
 */
export default function AdminProductTableThumb({ images, name = '' }) {
  const path = firstAdminProductImagePath(images)
  const src = path ? imagePreviewSrc(path) : ''
  const [failed, setFailed] = useState(false)
  const showPlaceholder = !src || failed

  return (
    <div className="admin-product-thumb" aria-hidden={showPlaceholder ? undefined : true}>
      {showPlaceholder ? (
        <span className="admin-product-thumb__placeholder" title="No image">
          <ImageIcon className="admin-product-thumb__icon" aria-hidden="true" />
        </span>
      ) : (
        <img
          className="admin-product-thumb__img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      <span className="sr-only">{name}</span>
    </div>
  )
}
