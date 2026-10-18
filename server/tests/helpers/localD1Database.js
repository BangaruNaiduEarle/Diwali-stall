import { d1ExecLocal, d1QueryLocal } from './d1Local.js'

/**
 * Minimal D1Database adapter for service tests against Wrangler local D1.
 * Each statement is a separate Wrangler process; do not query changes()
 * on a second connection (it is not the same SQLite session).
 * @returns {D1Database}
 */
export function createLocalD1Database() {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          const statement = interpolateParams(sql, params)
          return {
            async all() {
              return { results: d1QueryLocal(statement) }
            },
            async first() {
              return d1QueryLocal(statement)[0] ?? null
            },
            async run() {
              d1ExecLocal(statement)
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  }
}

/** @param {string} sql @param {unknown[]} params */
function interpolateParams(sql, params) {
  let i = 0
  return sql.replace(/\?/g, () => {
    const v = params[i++]
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'number') return String(v)
    return `'${String(v).replace(/'/g, "''")}'`
  })
}
