import { adminLocationMode } from '../middleware/requireAdmin.js'

const writers = new WeakMap()
const unavailable = () => ({
  ok: false, status: 503, error: 'catalogue_unavailable',
  message: 'The catalogue is temporarily unavailable. Please try again later.',
})
const CONTEXT_FROM = `FROM business_locations bl
  JOIN businesses b ON b.id = bl.business_id
  JOIN location_seasons ls ON ls.location_id = bl.id
  JOIN business_seasons s ON s.id = ls.season_id
  WHERE bl.id = ? AND b.id = ? AND ls.season_id = ?`
const ACTIVE = "bl.status = 'active' AND b.status = 'active' AND ls.status = 'active' AND s.status = 'active'"

export const PUBLIC_REQUEST_CONTEXT_SQL = `SELECT bl.id AS location_id, b.id AS business_id,
  ls.season_id, ls.operating_year, bl.status AS location_status, b.status AS business_status,
  ls.status AS association_status, s.status AS season_status ${CONTEXT_FROM}`

/** Only DB wrappers created after server-configuration validation have this scope. */
export function publicCustomerRequestScope(db) {
  return writers.get(db) ?? null
}

/** No request headers/body or public-catalogue fallback participate in selection. */
export async function resolveTrustedPublicLocation(db, env = {}) {
  const mode = adminLocationMode(env)
  if (mode === false) return { ok: true, scope: null }
  const businessId = String(env.PUBLIC_REQUEST_BUSINESS_ID ?? '').trim()
  const locationId = String(env.PUBLIC_REQUEST_LOCATION_ID ?? '').trim()
  const seasonId = String(env.PUBLIC_REQUEST_SEASON_ID ?? '').trim()
  if (mode !== true || !businessId || !locationId || !seasonId || seasonId === 'season-2099') return unavailable()
  const previous = writers.get(db)
  if (previous) {
    return previous.businessId === businessId && previous.locationId === locationId && previous.seasonId === seasonId
      ? { ok: true, scope: previous } : unavailable()
  }
  try {
    const rows = (await db.prepare(PUBLIC_REQUEST_CONTEXT_SQL).bind(locationId, businessId, seasonId).all()).results ?? []
    const row = rows[0]
    if (rows.length !== 1 || row.business_id !== businessId || row.location_id !== locationId || row.season_id !== seasonId ||
        !Number.isInteger(row.operating_year) || row.operating_year < 1 || row.operating_year > 9999 ||
        !['business_status', 'location_status', 'association_status', 'season_status'].every(key => row[key] === 'active')) return unavailable()
    const scope = Object.freeze({ businessId, locationId, seasonId })
    return { ok: true, scope }
  } catch {
    // Missing 0020 schema and database errors fail closed without SQL details.
    return unavailable()
  }
}

export async function preparePublicCustomerRequestWriter(db, env = {}) {
  const context = await resolveTrustedPublicLocation(db, env)
  if (!context.ok) return context
  if (!context.scope || writers.has(db)) return { ...context, db }
  const scoped = publicWriterDb(db, context.scope)
  writers.set(scoped, context.scope)
  return { ...context, db: scoped }
}

// A narrow boundary for the existing shared writer, summary/reference helpers,
// and public availability checks. Unsupported SQL fails before execution.
function publicWriterDb(raw, { businessId, locationId: loc, seasonId: season }) {
  const statements = new WeakMap()
  const ownedParent = `EXISTS (SELECT 1 FROM customer_requests public_parent
    WHERE public_parent.id = customer_request_items.request_id AND public_parent.location_id = ? AND public_parent.season_id = ?)`
  function rewrite(original, values) {
    let sql = original.replace(/\s+/g, ' ').trim()
    if (sql.includes(';')) throw new Error('Unsupported public request statement.')
    if (/^SELECT\b/.test(sql) && /FROM (products|family_packs) WHERE id = \? AND season_id = \?$/.test(sql) && values.length === 2) {
      return { sql: sql.replace('season_id = ?', 'location_id = ?'), values: [values[0], loc] }
    }
    if (/^SELECT\b/.test(sql) && sql.endsWith('FROM customer_requests WHERE id = ?') && values.length === 1) {
      return { sql: sql + ' AND location_id = ? AND season_id = ?', values: [...values, loc, season] }
    }
    if (sql === 'SELECT COUNT(*) AS n FROM customer_request_items WHERE request_id = ?') {
      return { sql: sql + ` AND ${ownedParent}`, values: [...values, loc, season] }
    }
    if (sql.startsWith('UPDATE customer_requests SET public_reference = ?') && sql.endsWith('WHERE id = ? AND public_reference IS NULL') && values.length === 2) {
      return { sql: sql + ' AND location_id = ? AND season_id = ?', values: [...values, loc, season] }
    }
    if (sql.startsWith('INSERT INTO customer_requests (') && sql.includes('source, season_id, updated_at') && values.length === 12) {
      // Guard the NOT NULL source column so context archival/reassignment between
      // resolution and batch execution aborts the entire parent/child batch.
      return { sql: `INSERT INTO customer_requests (
        id, public_reference, status, customer_name, customer_phone, customer_area,
        pickup_preference, customer_note, delivery_address, delivery_landmark, delivery_maps_url,
        source, season_id, location_id, updated_at
      ) VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?,
        (SELECT ? ${CONTEXT_FROM} AND ${ACTIVE}), ?, ?, datetime('now'))`,
      values: [...values.slice(0, 11), loc, businessId, season, season, loc] }
    }
    if (sql.startsWith('INSERT INTO customer_request_items (') && values.length === 7) {
      const [id, line, product, pack, name, quantity, price] = values
      if ((!product && !pack) || (product && pack)) throw new Error('Invalid public request line reference.')
      return { sql: `INSERT INTO customer_request_items
        (request_id, line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise)
        VALUES ((SELECT id FROM customer_requests WHERE id = ? AND location_id = ? AND season_id = ?
          AND (? IS NULL OR EXISTS (SELECT 1 FROM products WHERE id = ? AND location_id = ?))
          AND (? IS NULL OR EXISTS (SELECT 1 FROM family_packs WHERE id = ? AND location_id = ?))), ?, ?, ?, ?, ?, ?)`,
      values: [id, loc, season, product, product, loc, pack, pack, loc, line, product, pack, name, quantity, price] }
    }
    throw new Error('Unsupported public request location statement.')
  }
  return {
    prepare(sql) {
      return { bind(...values) {
        const query = rewrite(sql, values)
        const statement = raw.prepare(query.sql).bind(...query.values)
        const exposed = {
          first: (...args) => statement.first(...args),
          all: (...args) => statement.all(...args),
          run: (...args) => statement.run(...args),
        }
        statements.set(exposed, statement)
        return exposed
      } }
    },
    batch(batch) {
      const unwrapped = batch.map(statement => statements.get(statement))
      if (unwrapped.some(statement => !statement)) throw new Error('Unscoped public request batch.')
      return raw.batch(unwrapped)
    },
  }
}
