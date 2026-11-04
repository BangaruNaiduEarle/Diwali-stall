import { adminCatalogueScope } from './adminCatalogueScope.js'
import { inheritAdminServiceMode, requireLegacyServiceMode, serviceScopeError } from './adminServiceMode.js'
import { auditSqlLiteral as literal, workflowActorSql } from './requestWorkflowAudit.js'
import { adminOperationScope } from './adminOperationScope.js'

const wrappers = new WeakMap()
const ownershipError = () => Object.assign(new Error('A customer request references records outside its location.'), {
  status: 409, code: 'request_ownership_mismatch',
})

// A product's category is another owned reference, including locked-price lines.
const ownedProductCategory = alias => `EXISTS (SELECT 1 FROM categories scope_category
  WHERE scope_category.slug = ${alias}.category_slug AND scope_category.location_id = ${alias}.location_id)`

// Add predicates before pagination, preserving the positional bindings of the
// original query. Only trusted service SQL reaches this boundary, never user SQL.
function constrain(sql, values, predicate, binds) {
  let depth = 0, quote = null, whereAt = -1, index = sql.length
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (quote) {
      if (ch === quote) { if (sql[i + 1] === quote) i++; else quote = null }
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (depth || (i > 0 && /\w/.test(sql[i - 1]))) continue
    if (/^WHERE\b/i.test(sql.slice(i))) whereAt = i
    if (/^(ORDER\s+BY|LIMIT)\b/i.test(sql.slice(i))) { index = i; break }
  }
  const offset = (sql.slice(0, index).match(/\?/g) ?? []).length
  const next = [...values]
  next.splice(offset, 0, ...binds)
  const scoped = whereAt >= 0
    ? sql.slice(0, whereAt + 5) + ' (' + sql.slice(whereAt + 5, index).trim() + ') AND ' + predicate
    : sql.slice(0, index) + ' WHERE ' + predicate
  return { sql: scoped + ' ' + sql.slice(index), values: next }
}

/**
 * Admin request/quotation/Quick Bill D1 boundary. Disabled mode returns the
 * ORIGINAL DB. Nested helpers retain the validated transaction scope. This is
 * not a general SQL rewriter:
 * unsupported statement/table shapes throw before any query executes.
 * All transaction reads/writes retain operating season AND location; catalogue
 * SELECTs substitute location for provenance season without changing formulas.
 */
export function customerRequestDb(db, seasonId, context, write = false) {
  const existing = wrappers.get(db)
  if (existing && context === undefined) {
    context = existing.context
    seasonId = seasonId === undefined || seasonId === '' ? existing.scope.seasonId : seasonId
  }
  const scope = adminCatalogueScope(db, seasonId, context, write)
  if (!scope.locationId) return db
  Object.assign(scope, adminOperationScope(db, seasonId, context, write))
  Object.freeze(scope)
  if (existing && (existing.scope.locationId !== scope.locationId || existing.scope.seasonId !== scope.seasonId)) {
    throw serviceScopeError('An operational DB scope cannot switch location or operating season.')
  }
  if (existing && existing.scope.locationId === scope.locationId && existing.scope.seasonId === scope.seasonId && (!write || existing.write)) return db
  const raw = existing?.raw ?? db
  const loc = scope.locationId, season = scope.seasonId
  const actor = workflowActorSql(context)
  // Only the verified server handover path supplies these internal transport fields.
  const origin = context.workflowTransport?.handoverCreator
  const creator = origin ? { id:literal(origin.userId), name:literal(origin.name), role:literal(origin.role),device:literal(origin.deviceId),occurred:literal(origin.occurredAt) } : actor
  const revisions = new Map(), lines = new Map(), quoteRequests = new Map()
  const lineKey = row => [row.request_id, row.product_id ?? '', row.family_pack_id ?? '', row.unit_type ?? (String(row.product_name).endsWith(' (loose pc)') ? 'piece' : 'box')].join('|')
  const parent = alias => `${alias}.location_id = ? AND ${alias}.season_id = ?`
  const open = alias => `${alias}.status NOT IN ('closed', 'void') AND ${alias}.finalization_status IS NOT 'finalized'`
  // Recheck locked-price pack/product ownership inside the write batch too.
  // Catalogue provenance season deliberately does not participate.
  const validChildren = alias => `NOT EXISTS (
    SELECT 1 FROM customer_request_items scoped_item WHERE scoped_item.request_id = ${alias}.id AND (
      (scoped_item.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products scoped_product
        WHERE scoped_product.id = scoped_item.product_id AND scoped_product.location_id = ${alias}.location_id
          AND ${ownedProductCategory('scoped_product')}))
      OR (scoped_item.family_pack_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM family_packs scoped_pack
        WHERE scoped_pack.id = scoped_item.family_pack_id AND scoped_pack.location_id = ${alias}.location_id))
      OR (scoped_item.product_id IS NOT NULL AND scoped_item.family_pack_id IS NOT NULL)))`
  const requestParent = (idExpr, checkChildren = false, mutable = false) => `EXISTS (SELECT 1 FROM customer_requests scoped_request WHERE scoped_request.id = ${idExpr} AND ${parent('scoped_request')}${mutable ? ` AND ${open('scoped_request')}` : ''}${checkChildren ? ` AND ${validChildren('scoped_request')}` : ''})`
  const quoteParent = (idExpr) => `EXISTS (SELECT 1 FROM quotations scoped_quote WHERE scoped_quote.id = ${idExpr} AND ${parent('scoped_quote')} AND ${requestParent('scoped_quote.customer_request_id')})`

  async function validateReferences(rows) {
    for (const row of rows) {
      const product = row.product_id ?? row.productId
      const pack = row.family_pack_id ?? row.familyPackId
      if (product && pack) throw ownershipError()
      if (product && !await raw.prepare(`SELECT 1 FROM products WHERE id = ? AND location_id = ? AND ${ownedProductCategory('products')}`).bind(product, loc).first()) throw ownershipError()
      if (pack && !await raw.prepare('SELECT 1 FROM family_packs WHERE id = ? AND location_id = ?').bind(pack, loc).first()) throw ownershipError()
    }
  }

  async function validateRequestChildren(id) {
    const result = await raw.prepare(`SELECT product_id, family_pack_id FROM customer_request_items
      WHERE request_id = ? AND ${requestParent('customer_request_items.request_id')}`)
      .bind(id, loc, season).all()
    await validateReferences(result.results ?? [])
    const mismatch = await raw.prepare(`SELECT 1 AS mismatch FROM quotations
      WHERE customer_request_id = ? AND status != 'void'
        AND (location_id IS NOT ? OR season_id IS NOT ?)`)
      .bind(id, loc, season).first()
    if (mismatch) throw ownershipError()
  }

  function rewrite(original, values) {
    let sql = original.trim().replace(/;$/, '')
    if (sql.includes(';')) throw new Error('Multiple statements are not supported by customer request scope.')
    const read = /^SELECT\b/i.test(sql)
    if (!read && !write) throw new Error('Customer request scope is read-only.')
    if (read && /\bFROM admin_users\b/i.test(sql)) return { sql, values }
    if (read && /\bFROM season_members sm\b/i.test(sql)) {
      return constrain(sql, values, `sm.season_id = ? AND EXISTS (
        SELECT 1 FROM location_members lm
        JOIN location_seasons ls ON ls.location_id = lm.location_id AND ls.season_id = lm.season_id
        WHERE lm.admin_user_id = sm.admin_user_id AND lm.season_id = sm.season_id
          AND lm.location_id = ? AND (lm.disabled_at IS NULL OR lm.disabled_at = '')
          AND lm.role IN ('owner', 'super_admin') AND ls.status = 'active'
      )`, [season, loc])
    }
    if (read && /\bFROM\s+(products|family_packs)\s+WHERE\b/i.test(sql)) {
      const next = [...values]
      // Known catalogue helper shapes: single ID or a bound ID list, optionally
      // filtered by season. Do not allow unrestricted catalogue scans here.
      if (!/\bid\s*(?:=\s*\?|IN\s*\()/i.test(sql)) throw new Error('Catalogue ID selection is required.')
      const matches = [...sql.matchAll(/\bseason_id\s*=\s*\?/gi)]
      for (const match of matches) next[(sql.slice(0, match.index).match(/\?/g) ?? []).length] = loc
      if (matches.length) sql = sql.replace(/\bseason_id\s*=\s*\?/gi, 'location_id = ?')
      const product = /\bFROM products\s+WHERE\b/i.test(sql)
      return constrain(sql, next, 'location_id = ?' + (product ? ` AND ${ownedProductCategory('products')}` : ''), [loc])
    }
    if (read && /\bFROM product_purchase_rates WHERE product_id = \?/i.test(sql)) {
      return constrain(sql, values, `location_id = ? AND EXISTS (SELECT 1 FROM products scope_rate_product
        WHERE scope_rate_product.id = product_purchase_rates.product_id AND scope_rate_product.location_id = ? AND ${ownedProductCategory('scope_rate_product')})`, [loc, loc])
    }
    if ((read && /\bFROM customer_requests(?:\s+r\b)?/i.test(sql)) || /^UPDATE customer_requests\b/i.test(sql)) {
      const alias = /\bFROM customer_requests r\b/i.test(sql) ? 'r' : 'customer_requests'
      const mutable = !read && !sql.includes('SET status = CASE')
      if (read && !/^SELECT COUNT\(/i.test(sql)) sql = sql.replace(/^SELECT\s+/i, `SELECT ${alias}.revision, `)
      if (!read && /SET assigned_to_email =/i.test(sql)) {
        const email = literal(values[0])
        const target = `SELECT id FROM admin_users WHERE lower(email) = lower(${email})`
        const sm = `(SELECT role FROM season_members WHERE admin_user_id = (${target}) AND season_id = ${literal(season)})`
        const lm = `(SELECT role FROM location_members WHERE admin_user_id = (${target}) AND season_id = ${literal(season)} AND location_id = ${literal(loc)})`
        sql = sql.replace(/\bWHERE id = \?/i, `, assigned_to_user_id = (${target}),
          assigned_to_name = (SELECT display_name FROM admin_users WHERE lower(email) = lower(${email})),
          assigned_to_role = CASE WHEN ${sm} = 'super_admin' OR ${lm} = 'super_admin' THEN 'super_admin' ELSE 'owner' END,
          assigned_by_user_id = ${actor.id}, assigned_by_name = ${actor.name}, assigned_by_role = ${actor.role}
          WHERE id = ?`)
      }
      return { ...constrain(sql, values, parent(alias) + (mutable ? ` AND ${open(alias)} AND ${validChildren(alias)}` : ''), [loc, season]), requestRows: read }
    }
    // Used only by the admin Quick Bill call path. Public writers receive their
    // original DB and SQL; this boundary supplies ownership to the admin insert.
    if (/^INSERT INTO customer_requests\b/i.test(sql)) {
      if (values.length !== 12 || !/source, season_id, updated_at/.test(sql)) throw new Error('Unsupported admin request insert.')
      sql = sql.replace('source, season_id, updated_at', 'source, season_id, location_id, updated_at')
        .replace(/\?, datetime\('now'\)\)$/, "?, ?, datetime('now'))")
      sql = sql.replace('location_id, updated_at', 'location_id, creator_user_id, creator_name, creator_role, audit_actor_user_id, audit_actor_name, audit_actor_role, audit_device_id, audit_occurred_at, updated_at')
        .replace(/datetime\('now'\)\)$/, `${creator.id}, ${creator.name}, ${creator.role}, ${creator.id}, ${creator.name}, ${creator.role}, ${creator.device}, ${creator.occurred}, datetime('now'))`)
      return { sql, values: [...values.slice(0, -1), season, loc] }
    }
    if (read && /\bFROM customer_request_items\b/i.test(sql)) {
      const alias = /\bFROM customer_request_items i\b/i.test(sql) ? 'i' : 'customer_request_items'
      if (!/^SELECT COUNT\(/i.test(sql)) sql = sql.replace(/^SELECT\s+/i, `SELECT ${alias}.request_id, ${alias}.line_id, ${alias}.unit_type, ${alias}.pack_snapshot, ${alias}.product_details_json, `)
      return { ...constrain(sql, values, requestParent(`${alias}.request_id`), [loc, season]), references: true }
    }
    if (/^DELETE FROM customer_request_items\b/i.test(sql)) {
      return constrain(sql, values, requestParent('customer_request_items.request_id', false, true), [loc, season])
    }
    if (/^INSERT INTO customer_request_items\b/i.test(sql)) {
      if (values.length !== 7 && !(values.length === 8 && sql.includes('product_details_json'))) throw new Error('Unsupported customer request item insert.')
      const [id, line, product, pack, name, quantity, price] = values
      if (product && pack) throw ownershipError()
      const transferred = context.workflowTransport?.handoverLines?.find(item => pack?item.familyPackId===pack&&item.unitType==='box':item.productId===product&&!item.familyPackId&&item.unitType===(String(name).endsWith(' (loose pc)')?'piece':'box'))
      const prior = transferred ? { line_id: transferred.lineId, unit_type:transferred.unitType, pack_snapshot:JSON.stringify(transferred.packSnapshot) } : lines.get(lineKey({ request_id: id, product_id: product, family_pack_id: pack, product_name: name }))
      const details = values.length === 8 ? values[7] : prior?.product_details_json
      return { sql: `INSERT INTO customer_request_items
        (request_id, line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise, line_id, unit_type, pack_snapshot, product_details_json)
        VALUES ((SELECT id FROM customer_requests WHERE id = ? AND location_id = ? AND season_id = ? AND ${open('customer_requests')}
          AND (? IS NULL OR EXISTS (SELECT 1 FROM products WHERE id = ? AND location_id = ? AND ${ownedProductCategory('products')}))
          AND (? IS NULL OR EXISTS (SELECT 1 FROM family_packs WHERE id = ? AND location_id = ?))),
          ?, ?, ?, ?, ?, ?, ${literal(prior?.line_id)}, ${literal(prior?.unit_type)}, ${literal(prior?.pack_snapshot)}, ${literal(details)})`, values: [id, loc, season, product, product, loc, pack, pack, loc, line, product, pack, name, quantity, price] }
    }
    if ((read && /\bFROM quotations\s+WHERE\b/i.test(sql)) || /^UPDATE quotations\b/i.test(sql)) {
      if (read) sql = sql.replace(/^SELECT\s+/i, 'SELECT (SELECT revision FROM customer_requests WHERE id = quotations.customer_request_id) AS request_revision, ')
      return { ...constrain(sql, values, `${parent('quotations')} AND ${requestParent('quotations.customer_request_id', !read, !read)}`, [loc, season, loc, season]), quotationRows: read }
    }
    if (/^INSERT INTO quotations\b/i.test(sql)) {
      if (values.length !== 15 || !/season_id, updated_at/.test(sql) || !/VALUES \(\?, \?, 'draft'/.test(sql)) throw new Error('Unsupported quotation insert.')
      sql = sql.replace('season_id, updated_at', 'season_id, location_id, updated_at')
        .replace(/\?, datetime\('now'\)\)$/, "?, ?, datetime('now'))")
        .replace("VALUES (?, ?, 'draft'", `VALUES (?, (SELECT id FROM customer_requests WHERE id = ? AND location_id = ? AND season_id = ? AND ${open('customer_requests')} AND ${validChildren('customer_requests')}), 'draft'`)
      return { sql, values: [values[0], values[1], loc, season, ...values.slice(2, -1), season, loc] }
    }
    if (read && /\bFROM quotation_items WHERE\b/i.test(sql)) {
      sql = sql.replace(/^SELECT\s+/i, 'SELECT request_line_id, unit_type, pack_snapshot, product_details_json, ')
      return { ...constrain(sql, values, quoteParent('quotation_items.quotation_id'), [loc, season, loc, season]), references: true }
    }
    if (/^INSERT INTO quotation_items\b/i.test(sql)) {
      if (values.length !== 7) throw new Error('Unsupported quotation item insert.')
      return {
        sql: `INSERT INTO quotation_items (quotation_id, line_number, product_id, product_name, quantity, unit_rate_paise, line_total_paise)
          VALUES ((SELECT id FROM quotations WHERE id = ? AND location_id = ? AND season_id = ? AND ${requestParent('quotations.customer_request_id', true, true)}
            AND (? IS NULL OR EXISTS (SELECT 1 FROM products WHERE id = ? AND location_id = ? AND ${ownedProductCategory('products')}))), ?, ?, ?, ?, ?, ?)`,
        values: [values[0], loc, season, loc, season, values[2], values[2], loc, ...values.slice(1)],
      }
    }
    if (read && /\bFROM request_workflow_events WHERE\b/i.test(sql)) {
      return constrain(sql, values, `location_id = ? AND season_id = ? AND business_id = (SELECT business_id FROM business_locations WHERE id = ?) AND ${requestParent('request_workflow_events.request_id')}`, [loc, season, loc, loc, season])
    }
    if (read && /\bFROM bill_item_purchase_costs s\b/i.test(sql)) {
      return constrain(sql, values, `s.business_id = ? AND s.location_id = ? AND s.season_id = ? AND ${requestParent('s.request_id')}`, [scope.businessId, loc, season, loc, season])
    }
    throw new Error('Unsupported statement in customer request location scope.')
  }

  function target(original, values) {
    const sql = original.trim()
    if (/^SELECT/i.test(sql)) return null
    if (/^INSERT INTO (customer_requests|customer_request_items)|^DELETE FROM customer_request_items/i.test(sql)) return { requestId: values[0], creating: /^INSERT INTO customer_requests\b/i.test(sql) }
    if (/^INSERT INTO quotations\b/i.test(sql)) { quoteRequests.set(values[0], values[1]); return { requestId: values[1] } }
    if (/^INSERT INTO quotation_items\b/i.test(sql)) return quoteRequests.has(values[0]) ? { requestId: quoteRequests.get(values[0]) } : { quotationId: values[0] }
    const where = /\bWHERE id = \?/i.exec(sql)
    if (where) {
      const id = values[(sql.slice(0, where.index).match(/\?/g) ?? []).length]
      return /^UPDATE customer_requests\b/i.test(sql) ? { requestId: id } : quoteRequests.has(id) ? { requestId: quoteRequests.get(id) } : { quotationId: id }
    }
    return null
  }

  async function execute(entries) {
    const batch = [], prepared = new Set(), cleanup = new Map(), businessIndexes = []
    for (const entry of entries) {
      const t = entry.target
      if (t) cleanup.set(t.requestId ?? `quotation:${t.quotationId}`, t)
      if (t?.creating) prepared.add(t.requestId)
      if (t && !t.creating) {
        const key = t.requestId ?? `quotation:${t.quotationId}`
        if (!prepared.has(key)) {
          prepared.add(key)
          const predicate = t.requestId ? 'id = ?' : 'id = (SELECT customer_request_id FROM quotations WHERE id = ? AND location_id = ? AND season_id = ?)'
          const binds = t.requestId ? [t.requestId] : [t.quotationId, loc, season]
          const expected = context.workflowTransport?.expectedRevision ?? revisions.get(t.requestId)
          if (expected != null) batch.push(raw.prepare(`UPDATE customer_requests SET status = CASE WHEN revision = ? THEN status ELSE NULL END WHERE ${predicate} AND location_id = ? AND season_id = ?`).bind(expected, ...binds, loc, season))
          batch.push(raw.prepare(`UPDATE customer_requests SET audit_actor_user_id = ${actor.id}, audit_actor_name = ${actor.name},
            audit_actor_role = ${actor.role}, audit_device_id = ${actor.device}, audit_occurred_at = ${actor.occurred}
            WHERE ${predicate} AND location_id = ? AND season_id = ? AND ${open('customer_requests')}`).bind(...binds, loc, season))
        }
      }
      businessIndexes.push(batch.length)
      batch.push(entry.statement)
    }
    // Actor context belongs to this transaction only. A later anonymous/legacy
    // writer must never inherit the last authenticated actor or device.
    for (const t of cleanup.values()) {
      const predicate = t.requestId ? 'id = ?' : 'id = (SELECT customer_request_id FROM quotations WHERE id = ? AND location_id = ? AND season_id = ?)'
      const binds = t.requestId ? [t.requestId] : [t.quotationId, loc, season]
      batch.push(raw.prepare(`UPDATE customer_requests SET audit_actor_user_id = NULL, audit_actor_name = NULL,
        audit_actor_role = NULL, audit_device_id = NULL, audit_occurred_at = NULL
        WHERE ${predicate} AND location_id = ? AND season_id = ?`).bind(...binds, loc, season))
    }
    try {
      const result = await raw.batch(batch)
      revisions.clear()
      return entries.length === 1 ? result[businessIndexes[0]] : businessIndexes.map(index => result[index])
    } catch (error) {
      if (String(error?.message ?? error).includes('bill_purchase_cost_authority_changed')) {
        error.status = 403; error.code = 'forbidden'
      }
      if (/NOT NULL constraint failed: customer_requests.status/.test(String(error?.message ?? error))) {
        error.status = 409; error.code = 'revision_conflict'
      }
      throw error
    }
  }

  function remember(query, row) {
    if (query.quotationRows && row?.id && row.customer_request_id) {
      quoteRequests.set(row.id, row.customer_request_id)
      if (Number.isSafeInteger(row.request_revision) && !revisions.has(row.customer_request_id)) revisions.set(row.customer_request_id, row.request_revision)
    }
    if (query.requestRows && row?.id && Number.isSafeInteger(row.revision)) revisions.set(row.id, row.revision)
    if (query.references && row?.request_id && row.line_id) lines.set(lineKey(row), row)
  }

  const wrapper = {
    prepare(original) {
      return {
        bind(...values) {
          const query = rewrite(original, values)
          const statement = raw.prepare(query.sql).bind(...query.values)
          const exposed = {
            async first(...args) {
              const row = await statement.first(...args)
              remember(query, row)
              if (query.requestRows && row?.id) await validateRequestChildren(row.id)
              if (query.references && row) await validateReferences([row])
              return row
            },
            async all(...args) {
              const result = await statement.all(...args)
              for (const row of result.results ?? []) remember(query, row)
              if (query.requestRows) for (const row of result.results ?? []) if (row.id) await validateRequestChildren(row.id)
              if (query.references) await validateReferences(result.results ?? [])
              return result
            },
            run: () => execute([{ statement, target: target(original, values) }]),
          }
          wrappers.set(exposed, { statement, target: target(original, values) })
          return exposed
        },
      }
    },
    batch(statements) {
      const unwrapped = statements.map(statement => wrappers.get(statement))
      if (unwrapped.some(statement => !statement)) throw new Error('Unscoped adjustment statement.')
      return execute(unwrapped)
    },
  }
  wrappers.set(wrapper, { raw, scope, write, context })
  inheritAdminServiceMode(wrapper, db)
  return wrapper
}

/** Internal scope metadata, never derived from a client business/location ID. */
export function customerRequestScope(db) {
  return wrappers.get(db)?.scope ?? null
}

/** Validate even locked-price lines which do not otherwise need a catalogue read. */
export async function validateTransactionCatalogueReferences(db, rows) {
  const scope = customerRequestScope(db)
  if (!scope) { requireLegacyServiceMode(db); return }
  for (const row of rows ?? []) {
    const product = row.product_id ?? row.productId
    const pack = row.family_pack_id ?? row.familyPackId
    if (product && pack) throw ownershipError()
    for (const [table, id] of [['products', product], ['family_packs', pack]]) {
      if (id && !await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first()) throw ownershipError()
    }
  }
}

/** Reject a foreign/mismatched response object before using stored audit totals. */
export async function validateScopedQuotation(db, quotation, requestId) {
  if (!customerRequestScope(db)) { requireLegacyServiceMode(db); return }
  const row = await db.prepare('SELECT id, customer_request_id FROM quotations WHERE id = ?').bind(quotation?.id).first()
  const parentId = requestId ?? quotation?.customerRequestId ?? quotation?.customer_request_id
  if (!row || !parentId || row.customer_request_id !== parentId) throw ownershipError()
  for (const id of [quotation?.customerRequestId, quotation?.customer_request_id]) {
    if (id != null && id !== parentId) throw ownershipError()
  }
  const parent = await db.prepare('SELECT id FROM customer_requests WHERE id = ?').bind(parentId).first()
  if (!parent) throw ownershipError()
  await db.prepare('SELECT product_id FROM quotation_items WHERE quotation_id = ?').bind(row.id).all()
  await validateTransactionCatalogueReferences(db, quotation.items)
}

export async function validateScopedRequest(db, request) {
  if (!customerRequestScope(db)) { requireLegacyServiceMode(db); return }
  if (!request) return
  if (!await db.prepare('SELECT id FROM customer_requests WHERE id = ?').bind(request.id).first()) throw ownershipError()
  await validateTransactionCatalogueReferences(db, request.items)
}
