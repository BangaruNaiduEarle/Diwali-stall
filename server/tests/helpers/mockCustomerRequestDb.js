/**
 * In-memory D1 mock for public customer request + admin detail flows.
 * @param {{
 *   products?: object[],
 *   familyPacks?: object[],
 *   privateRates?: Map<string, number>,
 *   failOnItemLine?: number,
 *   rejectPublicReferences?: Set<string>,
 * }} opts
 */
export function createMockCustomerRequestDb(opts = {}) {
  const products = new Map((opts.products ?? []).map((p) => [p.id, p]))
  const familyPacks = new Map(
    (opts.familyPacks ?? []).map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        active: p.active ?? 1,
        archived: p.archived ?? 0,
        selling_price_paise: p.selling_price_paise ?? p.sellingPricePaise ?? 0,
      },
    ]),
  )
  const rates = opts.privateRates ?? new Map()
  const usedPublicReferences = new Set(opts.rejectPublicReferences ?? [])
  const state = {
    requests: new Map(),
    items: /** @type {Record<string, unknown>[]} */ ([]),
    familyPacks,
    usedPublicReferences,
  }
  let batchCalls = 0
  let itemInsertCount = 0

  const db = {
    batchCalls: 0,
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          const stmt = {
            _sql: normalized,
            _params: params,
            async first() {
              if (normalized.includes('FROM products WHERE id')) {
                return products.get(String(params[0])) ?? null
              }
              if (normalized.includes('FROM family_packs WHERE id')) {
                return familyPacks.get(String(params[0])) ?? null
              }
              if (normalized.includes('FROM private_rates')) {
                const paise = rates.get(String(params[0]))
                return paise != null ? { unit_rate_paise: paise } : null
              }
              if (normalized.includes('FROM customer_requests WHERE id')) {
                const id = String(params[0])
                const req = state.requests.get(id)
                if (!req) return null
                return { ...req }
              }
              if (normalized.includes('COUNT(*) AS n FROM customer_request_items')) {
                const n = state.items.filter((i) => i.request_id === params[0]).length
                return { n }
              }
              if (normalized.includes('SELECT id, status FROM customer_requests')) {
                return state.requests.get(String(params[0])) ?? null
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM customer_request_items')) {
                const requestId = String(params[0])
                return {
                  results: state.items
                    .filter((i) => i.request_id === requestId)
                    .sort((a, b) => Number(a.line_number) - Number(b.line_number))
                    .map((i) => ({ ...i })),
                }
              }
              return { results: [] }
            },
            async run() {
              if (normalized.startsWith('UPDATE customer_requests') && normalized.includes('public_reference')) {
                const [publicReference, requestId] = params
                const req = state.requests.get(String(requestId))
                if (!req) return { meta: { changes: 0 } }
                if (req.public_reference != null && String(req.public_reference).trim()) {
                  return { meta: { changes: 0 } }
                }
                const ref = String(publicReference)
                if (usedPublicReferences.has(ref)) {
                  throw new Error('UNIQUE constraint failed: customer_requests.public_reference')
                }
                for (const other of state.requests.values()) {
                  if (other.public_reference === ref) {
                    throw new Error('UNIQUE constraint failed: customer_requests.public_reference')
                  }
                }
                req.public_reference = ref
                usedPublicReferences.add(ref)
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 1 } }
            },
          }
          return stmt
        },
      }
    },
    async batch(statements) {
      batchCalls += 1
      db.batchCalls = batchCalls
      const snap = {
        requests: new Map(state.requests),
        items: [...state.items],
      }
      itemInsertCount = 0
      try {
        for (const stmt of statements) {
          const sql = stmt._sql
          const params = stmt._params
          if (sql.startsWith('INSERT INTO customer_requests')) {
            const [
              id,
              publicReference,
              name,
              phone,
              area,
              pickup,
              note,
              deliveryAddress,
              deliveryLandmark,
              deliveryMapsUrl,
              source = 'web',
            ] = params
            if (state.requests.has(id)) {
              throw new Error('UNIQUE constraint failed: customer_requests.id')
            }
            const ref = String(publicReference ?? '')
            if (ref) {
              if (usedPublicReferences.has(ref)) {
                throw new Error('UNIQUE constraint failed: customer_requests.public_reference')
              }
              usedPublicReferences.add(ref)
            }
            state.requests.set(id, {
              id,
              public_reference: ref || null,
              status: 'received',
              source,
              customer_name: name,
              customer_phone: phone,
              customer_area: area,
              pickup_preference: pickup,
              customer_note: note,
              delivery_address: deliveryAddress ?? null,
              delivery_landmark: deliveryLandmark ?? null,
              delivery_maps_url: deliveryMapsUrl ?? null,
              created_at: '2026-10-15 00:00:00',
              updated_at: '2026-10-15 00:00:00',
            })
          } else if (sql.startsWith('INSERT INTO customer_request_items')) {
            itemInsertCount += 1
            if (opts.failOnItemLine && itemInsertCount === opts.failOnItemLine) {
              throw new Error('SIMULATED_ITEM_INSERT_FAILURE')
            }
            const [requestId, lineNumber, productId, familyPackId, productName, quantity, unitPricePaise] =
              params
            state.items.push({
              request_id: requestId,
              line_number: lineNumber,
              product_id: productId,
              family_pack_id: familyPackId ?? null,
              product_name: productName,
              quantity,
              unit_price_paise: unitPricePaise ?? null,
            })
          }
        }
      } catch (err) {
        state.requests = snap.requests
        state.items = snap.items
        throw err
      }
    },
  }

  return db
}
