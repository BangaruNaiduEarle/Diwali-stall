import { categorySlugToLabel } from '../lib/categorySlug.js'
import { LIMITS, isValidCategorySlug } from '../lib/validation.js'
import { adminCatalogueScope } from '../lib/adminCatalogueScope.js'

/** @param {D1Database} db @param {string} seasonId */
export async function listAdminCategories(db, seasonId, context) {
  const scope = adminCatalogueScope(db, seasonId, context)
  const result = await db
    .prepare(
      `SELECT slug, label, sort_order, created_at, updated_at
       FROM categories
       WHERE ${scope.column} = ?
       ORDER BY sort_order ASC, slug ASC`,
    )
    .bind(scope.value)
    .all()
  return result.results ?? []
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {{ slug: string, label: string, sort_order?: number }} input
 */
export async function createCategory(db, seasonId, input, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const season = scope.seasonId
  if (!season) return { ok: false, errors: { _season: 'seasonId required.' } }

  const slug = String(input.slug ?? '').trim().toLowerCase()
  const label = String(input.label ?? '').trim()
  const sort_order = Number.isFinite(input.sort_order) ? Number(input.sort_order) : 0

  const errors = {}
  if (!isValidCategorySlug(slug)) errors.slug = 'Invalid slug format.'
  if (!label || label.length > LIMITS.categoryLabel) errors.label = 'Label required (max 120 chars).'

  if (Object.keys(errors).length) return { ok: false, errors }

  const exists = await db
    // Slugs remain global primary keys. Report reservation without owner details.
    .prepare(scope.locationId ? 'SELECT 1 FROM categories WHERE slug = ?' : 'SELECT 1 FROM categories WHERE slug = ? AND season_id = ?')
    .bind(...(scope.locationId ? [slug] : [slug, season]))
    .first()
  if (exists) return { ok: false, errors: { slug: 'Category slug already exists.' } }

  try {
    await db
      .prepare(scope.locationId
        ? 'INSERT INTO categories (slug, label, sort_order, season_id, location_id) VALUES (?, ?, ?, ?, ?)'
        : 'INSERT INTO categories (slug, label, sort_order, season_id) VALUES (?, ?, ?, ?)')
      .bind(slug, label, sort_order, season, ...(scope.locationId ? [scope.locationId] : []))
      .run()
  } catch (error) {
    if (scope.locationId && /UNIQUE constraint failed: categories\.slug/i.test(String(error?.message))) {
      return { ok: false, errors: { slug: 'Category slug already exists.' } }
    }
    throw error
  }

  return { ok: true, category: { slug, label, sort_order } }
}

/**
 * @param {D1Database} db
 * @param {string} seasonId
 * @param {string} slug
 * @param {{ label?: string, sort_order?: number }} patch
 */
export async function updateCategory(db, seasonId, slug, patch, context) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  const key = String(slug ?? '').trim()
  const row = await db
    .prepare(`SELECT slug FROM categories WHERE slug = ? AND ${scope.column} = ?`)
    .bind(key, scope.value)
    .first()
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
  binds.push(scope.value, key)

  await db
    .prepare(`UPDATE categories SET ${updates.join(', ')} WHERE ${scope.column} = ? AND slug = ?`)
    .bind(...binds)
    .run()

  const updated = await db
    .prepare(`SELECT slug, label, sort_order FROM categories WHERE slug = ? AND ${scope.column} = ?`)
    .bind(key, scope.value)
    .first()
  if (scope.locationId && !updated) return { ok: false, status: 404, code: 'not_found' }

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
