import { categorySlugToLabel } from '../lib/categorySlug.js'
import { LIMITS, isValidCategorySlug } from '../lib/validation.js'

/** @param {D1Database} db */
export async function listAdminCategories(db) {
  const result = await db
    .prepare(
      `SELECT slug, label, sort_order, created_at, updated_at
       FROM categories
       ORDER BY sort_order ASC, slug ASC`,
    )
    .all()
  return result.results ?? []
}

/**
 * @param {D1Database} db
 * @param {{ slug: string, label: string, sort_order?: number }} input
 */
export async function createCategory(db, input) {
  const slug = String(input.slug ?? '').trim().toLowerCase()
  const label = String(input.label ?? '').trim()
  const sort_order = Number.isFinite(input.sort_order) ? Number(input.sort_order) : 0

  const errors = {}
  if (!isValidCategorySlug(slug)) errors.slug = 'Invalid slug format.'
  if (!label || label.length > LIMITS.categoryLabel) errors.label = 'Label required (max 120 chars).'

  if (Object.keys(errors).length) return { ok: false, errors }

  const exists = await db.prepare('SELECT 1 FROM categories WHERE slug = ?').bind(slug).first()
  if (exists) return { ok: false, errors: { slug: 'Category slug already exists.' } }

  await db
    .prepare(
      `INSERT INTO categories (slug, label, sort_order) VALUES (?, ?, ?)`,
    )
    .bind(slug, label, sort_order)
    .run()

  return { ok: true, category: { slug, label, sort_order } }
}

/**
 * @param {D1Database} db
 * @param {string} slug
 * @param {{ label?: string, sort_order?: number }} patch
 */
export async function updateCategory(db, slug, patch) {
  const key = String(slug ?? '').trim()
  const row = await db.prepare('SELECT slug FROM categories WHERE slug = ?').bind(key).first()
  if (!row) return { ok: false, status: 404, code: 'not_found' }

  const updates = []
  const binds = []

  if (patch.label !== undefined) {
    const label = String(patch.label).trim()
    if (!label || label.length > LIMITS.categoryLabel) {
      return { ok: false, errors: { label: 'Invalid label.' } }
    }
    updates.push('label = ?')
    binds.push(label)
  }
  if (patch.sort_order !== undefined) {
    const sort_order = Number(patch.sort_order)
    if (!Number.isFinite(sort_order)) {
      return { ok: false, errors: { sort_order: 'Invalid sort_order.' } }
    }
    updates.push('sort_order = ?')
    binds.push(sort_order)
  }

  if (updates.length === 0) {
    return { ok: false, errors: { _body: 'No valid fields to update.' } }
  }

  updates.push("updated_at = datetime('now')")
  binds.push(key)

  await db
    .prepare(`UPDATE categories SET ${updates.join(', ')} WHERE slug = ?`)
    .bind(...binds)
    .run()

  const updated = await db
    .prepare('SELECT slug, label, sort_order FROM categories WHERE slug = ?')
    .bind(key)
    .first()

  return { ok: true, category: updated }
}

/** @param {Record<string, unknown>} row */
export function mapAdminCategoryRow(row) {
  return {
    slug: row.slug,
    label: row.label ?? categorySlugToLabel(String(row.slug)),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
