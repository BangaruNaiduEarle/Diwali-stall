import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import {
  deleteAdminFamilyPack,
  fetchAdminFamilyPacks,
  patchAdminFamilyPackStatus,
} from '../api/adminApi.js'
import AdminConfirmDialog from '../components/AdminConfirmDialog.jsx'
import AdminFamilyPackCard from '../components/AdminFamilyPackCard.jsx'
import { adminFamilyPackEditPath } from '../lib/adminFamilyPackPaths.js'
import { formatINR } from '../../utils/currency.js'

export default function AdminFamilyPacksPage() {
  const [packs, setPacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [includeInactive, setIncludeInactive] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState(/** @type {{ id: string, name: string } | null} */ (null))
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await fetchAdminFamilyPacks({ includeInactive })
    if (!result.ok) {
      setError(result.message)
      setPacks([])
    } else {
      setPacks(result.familyPacks)
    }
    setLoading(false)
  }, [includeInactive])

  useEffect(() => {
    load()
  }, [load])

  async function toggleActive(id, active) {
    const result = await patchAdminFamilyPackStatus(id, !active)
    if (result.ok) load()
    else setError(result.message || 'Could not update status.')
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setError('')
    const result = await deleteAdminFamilyPack(deleteTarget.id)
    setDeleting(false)
    if (!result.ok) {
      setDeleteTarget(null)
      setError(result.message || 'Could not delete family pack.')
      return
    }
    setDeleteTarget(null)
    load()
  }

  return (
    <div className="admin-page admin-page--family-packs">
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Catalogue</p>
          <h1 className="admin-page__title">Family packs</h1>
        </div>
        <Button to="/admin/family-packs/new" variant="primary">
          New family pack
        </Button>
      </header>

      <div className="admin-toolbar mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show inactive packs
        </label>
        <Button type="button" variant="secondary" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-[var(--color-red)]" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <p className="mt-6 text-sm text-[var(--color-muted)]">Loading…</p> : null}

      {!loading && !packs.length ? (
        <p className="mt-6 text-sm text-[var(--color-muted)]">No family packs yet.</p>
      ) : null}

      {!loading && packs.length > 0 ? (
        <>
          <div className="admin-card-list admin-show-mobile mt-6" aria-label="Family packs">
            {packs.map((pack) => (
              <AdminFamilyPackCard
                key={String(pack.id)}
                pack={pack}
                onToggleActive={toggleActive}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>

          <div className="admin-table-wrap admin-show-desktop mt-6">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Slug</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {packs.map((pack) => {
                  const id = String(pack.id ?? '')
                  const editPath = adminFamilyPackEditPath(id)
                  return (
                    <tr key={id}>
                      <td>
                        <span className="admin-table__primary">{pack.name}</span>
                      </td>
                      <td className="admin-table__mono text-[var(--color-muted)]">{id}</td>
                      <td className="text-[var(--color-muted)]">{pack.slug}</td>
                      <td className="tabular-nums">{formatINR(pack.sellingPriceInr)}</td>
                      <td>{pack.active ? 'Active' : 'Inactive'}</td>
                      <td>
                        <div className="admin-table__actions">
                          <Link to={editPath} className="admin-table__link">
                            Edit
                          </Link>
                          <Button type="button" variant="ghost" size="sm" onClick={() => toggleActive(id, pack.active)}>
                            {pack.active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget({ id, name: String(pack.name ?? id) })}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `Delete “${deleteTarget.name}”?` : 'Delete family pack?'}
        description="Permanent deletion cannot be undone. Images and pack contents will be removed from the database. If customer requests reference this pack, deletion will be blocked — deactivate the pack instead."
        cancelLabel="Keep pack"
        confirmLabel="Delete permanently"
        confirming={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
