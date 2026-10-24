import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import {
  createAdminCategory,
  fetchAdminCategories,
  updateAdminCategory,
} from '../api/adminApi.js'
import AdminFeedbackBanner from '../components/AdminFeedbackBanner.jsx'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** @param {unknown} raw */
function mapCategoryRow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const slug = String(o.slug ?? '').trim()
  if (!slug) return null
  const sortRaw = o.sortOrder ?? o.sort_order
  const sortOrder = Number.isFinite(Number(sortRaw)) ? Number(sortRaw) : 0
  return {
    slug,
    label: String(o.label ?? '').trim(),
    sortOrder,
  }
}

function fieldErrorsMessage(fields) {
  if (!fields) return ''
  return Object.values(fields).filter(Boolean).join(' ')
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState(/** @type {{ slug: string, label: string, sortOrder: number }[]} */ ([]))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [savingSlug, setSavingSlug] = useState(/** @type {string | null} */ (null))
  const [creating, setCreating] = useState(false)
  /** @type {[Record<string, { label: string, sortOrder: string }>, Function]} */
  const [editDraft, setEditDraft] = useState({})
  const [createForm, setCreateForm] = useState({ slug: '', label: '', sortOrder: '' })

  const nextSortHint = useMemo(() => {
    if (!categories.length) return 1
    return Math.max(...categories.map((c) => c.sortOrder)) + 1
  }, [categories])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await fetchAdminCategories()
    if (!result.ok) {
      setError(result.message)
      setCategories([])
      setEditDraft({})
    } else {
      const rows = result.categories.map(mapCategoryRow).filter(Boolean)
      rows.sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug))
      setCategories(rows)
      setEditDraft(
        Object.fromEntries(rows.map((c) => [c.slug, { label: c.label, sortOrder: String(c.sortOrder) }])),
      )
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    setError('')
    setSuccess('')
    const slug = createForm.slug.trim().toLowerCase()
    const label = createForm.label.trim()
    const sortOrder = createForm.sortOrder.trim()
    if (!SLUG_RE.test(slug)) {
      setError('Slug must use lowercase letters, numbers, and hyphens only (e.g. gift-boxes).')
      setCreating(false)
      return
    }
    const result = await createAdminCategory({
      slug,
      label,
      sortOrder: sortOrder === '' ? nextSortHint : Number(sortOrder),
    })
    setCreating(false)
    if (!result.ok) {
      setError(result.message || fieldErrorsMessage(result.fields) || 'Could not create category.')
      return
    }
    setSuccess('Category created.')
    setCreateForm({ slug: '', label: '', sortOrder: '' })
    load()
  }

  async function handleSaveRow(slug) {
    const draft = editDraft[slug]
    if (!draft) return
    const label = draft.label.trim()
    const sortOrder = Number(draft.sortOrder)
    if (!label) {
      setError('Label is required.')
      return
    }
    if (!Number.isFinite(sortOrder)) {
      setError('Sort order must be a number.')
      return
    }
    setSavingSlug(slug)
    setError('')
    setSuccess('')
    const result = await updateAdminCategory(slug, { label, sortOrder })
    setSavingSlug(null)
    if (!result.ok) {
      setError(result.message || fieldErrorsMessage(result.fields) || 'Could not update category.')
      return
    }
    setSuccess(`Updated ${slug}.`)
    load()
  }

  function updateDraft(slug, patch) {
    setEditDraft((prev) => ({
      ...prev,
      [slug]: { ...prev[slug], ...patch },
    }))
  }

  return (
    <div className="admin-page admin-page--categories">
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Catalogue</p>
          <h1 className="admin-page__title">Categories</h1>
          <p className="admin-page__subtitle admin-page__subtitle--compact">
            Slugs appear in product records and public URLs. Labels and sort order can be edited here.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </header>

      <AdminFeedbackBanner variant="error" message={error} onDismiss={() => setError('')} className="mt-4" />
      <AdminFeedbackBanner variant="success" message={success} onDismiss={() => setSuccess('')} className="mt-4" />

      <section className="admin-panel mt-6" aria-labelledby="create-category-heading">
        <h2 id="create-category-heading" className="text-sm font-semibold text-[var(--color-charcoal)]">
          New category
        </h2>
        <form className="mt-4 grid gap-4 md:grid-cols-3" onSubmit={handleCreate}>
          <div>
            <label className="admin-label" htmlFor="cat-slug">
              Slug
            </label>
            <input
              id="cat-slug"
              className="admin-input mt-1 w-full"
              value={createForm.slug}
              onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="e.g. sparklers"
              autoComplete="off"
              disabled={creating}
            />
          </div>
          <div>
            <label className="admin-label" htmlFor="cat-label">
              Label
            </label>
            <input
              id="cat-label"
              className="admin-input mt-1 w-full"
              value={createForm.label}
              onChange={(e) => setCreateForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Display name"
              disabled={creating}
            />
          </div>
          <div>
            <label className="admin-label" htmlFor="cat-sort">
              Sort order{' '}
              <span className="font-normal text-[var(--color-muted)]">(optional, default {nextSortHint})</span>
            </label>
            <input
              id="cat-sort"
              type="number"
              className="admin-input mt-1 w-full"
              value={createForm.sortOrder}
              onChange={(e) => setCreateForm((f) => ({ ...f, sortOrder: e.target.value }))}
              placeholder={String(nextSortHint)}
              disabled={creating}
            />
          </div>
          <div className="md:col-span-3">
            <Button type="submit" variant="primary" loading={creating} disabled={creating}>
              Create category
            </Button>
          </div>
        </form>
      </section>

      {loading ? <p className="mt-6 text-sm text-[var(--color-muted)]">Loading categories…</p> : null}

      {!loading && categories.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--color-muted)]">No categories found.</p>
      ) : null}

      {!loading && categories.length > 0 ? (
        <div className="admin-table-wrap mt-6">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Slug</th>
                <th scope="col">Label</th>
                <th scope="col">Sort</th>
                <th scope="col" className="admin-table__actions-col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.map((row) => {
                const draft = editDraft[row.slug] ?? { label: row.label, sortOrder: String(row.sortOrder) }
                const dirty =
                  draft.label.trim() !== row.label || Number(draft.sortOrder) !== row.sortOrder
                return (
                  <tr key={row.slug}>
                    <td className="admin-table__mono">{row.slug}</td>
                    <td>
                      <input
                        className="admin-input w-full max-w-md"
                        value={draft.label}
                        onChange={(e) => updateDraft(row.slug, { label: e.target.value })}
                        aria-label={`Label for ${row.slug}`}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="admin-input w-24"
                        value={draft.sortOrder}
                        onChange={(e) => updateDraft(row.slug, { sortOrder: e.target.value })}
                        aria-label={`Sort order for ${row.slug}`}
                      />
                    </td>
                    <td className="admin-table__actions-col">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!dirty || savingSlug === row.slug}
                        loading={savingSlug === row.slug}
                        onClick={() => handleSaveRow(row.slug)}
                      >
                        Save
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
