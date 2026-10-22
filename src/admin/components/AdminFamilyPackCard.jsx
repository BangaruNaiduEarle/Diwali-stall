import { Link } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import Button from '../../components/ui/Button.jsx'
import { formatINR } from '../../utils/currency.js'
import { adminFamilyPackEditPath } from '../lib/adminFamilyPackPaths.js'

/**
 * @param {{
 *   pack: { id: string, name: string, slug?: string, sellingPriceInr?: number, active?: boolean }
 *   onToggleActive: (id: string, active: boolean) => void
 *   onDelete: (pack: { id: string, name: string }) => void
 * }} props
 */
export default function AdminFamilyPackCard({ pack, onToggleActive, onDelete }) {
  const id = String(pack.id ?? '')
  const name = String(pack.name ?? '')
  const editPath = adminFamilyPackEditPath(id)
  const editLabel = `Edit ${name}`

  return (
    <article className="admin-card admin-family-pack-card">
      <div className="admin-family-pack-card__head">
        <div className="admin-family-pack-card__intro">
          <h3 className="admin-family-pack-card__name">{name}</h3>
          <p className="admin-family-pack-card__meta">
            <span className="admin-family-pack-card__id">{id}</span>
            {pack.slug ? (
              <>
                <span className="admin-family-pack-card__sep" aria-hidden="true">
                  ·
                </span>
                <span>{pack.slug}</span>
              </>
            ) : null}
          </p>
          <p className="admin-family-pack-card__price tabular-nums">{formatINR(pack.sellingPriceInr)}</p>
        </div>
        <div className="admin-family-pack-card__status-wrap">
          <span className={`admin-badge${pack.active ? '' : ' admin-badge--muted'}`}>
            {pack.active ? 'Active' : 'Inactive'}
          </span>
          <Link to={editPath} className="admin-product-card__edit-icon" aria-label={editLabel} title={editLabel}>
            <Pencil size={18} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <div className="admin-family-pack-card__actions">
        <Button to={editPath} variant="secondary" size="sm">
          Edit
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onToggleActive(id, Boolean(pack.active))}>
          {pack.active ? 'Deactivate' : 'Activate'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDelete({ id, name })}>
          Delete
        </Button>
      </div>
    </article>
  )
}
