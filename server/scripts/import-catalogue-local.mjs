/** Disposable-only legacy importer. No implicit project configuration or cleanup. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SERVER_ROOT = fileURLToPath(new URL('../', import.meta.url))
const REPO_ROOT = path.resolve(SERVER_ROOT, '..')
const CONFIG = `name = "diwali-catalogue-import-disposable"
compatibility_date = "2025-04-01"
[[d1_databases]]
binding = "DB_IMPORT"
database_name = "diwali-catalogue-import-disposable"
database_id = "11111111-1111-4111-8111-000000000004"
`
const quote = value => value == null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`
export const inputHash = input => createHash('sha256').update(input).digest('hex')
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function parseImportOptions(args) {
  const options = { apply: false, confirmUpsert: false }
  const names = { '--workspace': 'workspace', '--input': 'input', '--reviewed-scope': 'scopeFile', '--legacy-season-id': 'legacySeasonId' }
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`)
    seen.add(flag)
    if (flag === '--apply') options.apply = true
    else if (flag === '--confirm-upsert') options.confirmUpsert = true
    else if (names[flag] && args[i + 1] && !args[i + 1].startsWith('--')) options[names[flag]] = args[++i]
    else throw new Error(`Unsupported or incomplete option: ${flag}`)
  }
  if (!options.workspace || !path.isAbsolute(options.workspace)) throw new Error('An explicit absolute --workspace under the system temporary directory is required.')
  if (options.apply && !options.confirmUpsert) throw new Error('--apply requires --confirm-upsert: existing authorized product fields may be overwritten.')
  return options
}

/** Real paths prevent a TEMP junction/symlink from selecting the repository DB. */
export function prepareDisposableTarget(workspace) {
  const directory = fs.realpathSync(workspace)
  const temporary = fs.realpathSync(os.tmpdir())
  if (!inside(temporary, directory) || directory === REPO_ROOT || inside(REPO_ROOT, directory)) throw new Error('Workspace must be an isolated TEMP directory outside the repository.')
  const persist = path.join(directory, 'persist')
  fs.mkdirSync(persist, { recursive: true })
  function checkTree(entry) {
    if (fs.lstatSync(entry).isSymbolicLink() || !inside(directory, fs.realpathSync(entry))) throw new Error('Disposable persistence must not contain redirected paths.')
    if (fs.statSync(entry).isFile() && fs.statSync(entry).nlink > 1) throw new Error('Disposable persistence must not contain hard-linked files.')
    if (fs.statSync(entry).isDirectory()) for (const name of fs.readdirSync(entry)) checkTree(path.join(entry, name))
  }
  checkTree(persist)
  const config = path.join(directory, 'import.wrangler.toml')
  if (fs.existsSync(config)) {
    if (fs.lstatSync(config).isSymbolicLink() || fs.readFileSync(config, 'utf8') !== CONFIG) throw new Error('Disposable config differs from the fixed dummy configuration.')
  } else fs.writeFileSync(config, CONFIG, { flag: 'wx' })
  return { directory, persist, config }
}

export function wranglerArguments(target, sqlFile) {
  if (!inside(target.directory, sqlFile)) throw new Error('SQL file must be in the disposable workspace.')
  return ['d1', 'execute', 'DB_IMPORT', '--local', '--config', target.config, '--persist-to', target.persist, '--file', sqlFile, '--json']
}

export function buildImportSql(payload, schema, { scope, legacySeasonId, workspace, sourceHash } = {}) {
  const records = payload.records
  if (!Array.isArray(records) || !records.length) throw new Error('Import must contain a non-empty records array.')
  const pc = schema.productColumns
  const cc = schema.categoryColumns
  const locationSchema = pc.includes('location_id') || cc.includes('location_id') ||
    schema.tables.some(name => ['businesses', 'business_locations', 'location_seasons', 'location_members'].includes(name))
  if (locationSchema && !scope) throw new Error('Location-enabled schema requires an independently reviewed --reviewed-scope; no location is inferred.')
  if (!locationSchema && scope) throw new Error('Location scope requires the location foundation schema.')
  const seasonal = pc.includes('season_id')
  if (seasonal !== cc.includes('season_id')) throw new Error('Inconsistent catalogue season schema.')
  let season = legacySeasonId
  let context = '1'
  if (locationSchema) {
    if (!pc.includes('location_id') || !cc.includes('location_id') || !seasonal) throw new Error('Incomplete location ownership schema.')
    if (legacySeasonId) throw new Error('Do not combine legacy and location scopes.')
    if (scope.formatVersion !== 1 || scope.workspace !== workspace || scope.inputSha256 !== sourceHash ||
        !['businessId', 'locationId', 'seasonId', 'reviewedBy'].every(key => typeof scope[key] === 'string' && scope[key].trim())) throw new Error('Reviewed scope must bind this workspace, exact input hash and explicit business/location/season, with reviewer attribution.')
    season = scope.seasonId
    context = `EXISTS (SELECT 1 FROM business_locations bl JOIN businesses b ON b.id = bl.business_id
      JOIN location_seasons ls ON ls.location_id = bl.id JOIN business_seasons s ON s.id = ls.season_id
      WHERE b.id = ${quote(scope.businessId)} AND bl.id = ${quote(scope.locationId)} AND ls.season_id = ${quote(season)}
      AND b.status = 'active' AND bl.status = 'active' AND ls.status = 'active' AND s.status = 'active')`
  } else if (seasonal) {
    if (!season) throw new Error('Season-aware legacy schema requires explicit --legacy-season-id.')
    context = `EXISTS (SELECT 1 FROM business_seasons WHERE id = ${quote(season)} AND status = 'active')`
  } else if (season) throw new Error('Legacy season selection is not supported by this schema.')
  if (season === 'season-2099') throw new Error('Protected season-2099 cannot be imported.')
  const ids = new Set()
  const lines = records.map(r => {
    if (!r || typeof r.id !== 'string' || !r.id.trim() || ids.has(r.id)) throw new Error('Product IDs must be non-empty and unique.')
    ids.add(r.id)
    if (/^TEST-/i.test(r.id) || /^P90[012356]$/i.test(r.id)) throw new Error(`Protected test product ID: ${r.id}`)
    if (typeof r.category_slug !== 'string' || !r.category_slug.trim() || typeof r.name !== 'string' || !r.name.trim() ||
        !Number.isSafeInteger(r.sort_order) || ![0, 1, false, true].includes(r.featured) || ![0, 1, false, true].includes(r.active) ||
        !['available', 'soldout', 'sold-out'].includes(r.stock_status)) throw new Error(`Invalid product fields: ${r.id}`)
    if (!Array.isArray(JSON.parse(r.images_json))) throw new Error('images_json must encode an array.')
    const ownership = locationSchema ? `location_id = ${quote(scope.locationId)} AND season_id IS NOT 'season-2099'`
      : seasonal ? `season_id = ${quote(season)}` : '1'
    // A scalar NULL violates category_slug NOT NULL, aborting foreign/global ID
    // collisions instead of silently skipping them in the UPSERT WHERE clause.
    const category = `(SELECT slug FROM categories WHERE slug = ${quote(r.category_slug)} AND ${ownership}
      AND ${context} AND NOT EXISTS (SELECT 1 FROM products WHERE id = ${quote(r.id)} AND (${ownership}) IS NOT TRUE))`
    return `INSERT INTO products (id, category_slug, name, pack, description, featured, stock_status,
      active, sort_order, images_json, company${seasonal ? ', season_id' : ''}${locationSchema ? ', location_id' : ''})
      VALUES (${quote(r.id)}, ${category}, ${quote(r.name)}, ${quote(r.pack ?? '')}, ${quote(r.description ?? '')},
      ${Number(r.featured)}, ${quote(r.stock_status)}, ${Number(r.active)}, ${r.sort_order}, ${quote(r.images_json)}, ${quote(r.company)}${seasonal ? ', ' + quote(season) : ''}${locationSchema ? ', ' + quote(scope.locationId) : ''})
      ON CONFLICT(id) DO UPDATE SET category_slug = excluded.category_slug, name = excluded.name,
      pack = excluded.pack, description = excluded.description, featured = excluded.featured,
      stock_status = excluded.stock_status, active = excluded.active, sort_order = excluded.sort_order,
      images_json = excluded.images_json, company = excluded.company, updated_at = datetime('now')
      WHERE ${ownership};`
  })
  return lines.join('\n\n') + '\n'
}

export function runImport(args, execute = execFileSync) {
  const options = parseImportOptions(args) // No arguments fail before any writes/processes.
  const target = prepareDisposableTarget(options.workspace)
  const input = fs.readFileSync(options.input ?? path.join(SERVER_ROOT, 'data/catalogue-import.json'))
  const scope = options.scopeFile ? JSON.parse(fs.readFileSync(options.scopeFile, 'utf8')) : undefined
  const wrangler = path.join(SERVER_ROOT, 'node_modules/wrangler/bin/wrangler.js')
  function sql(sqlText) {
    const file = path.join(target.directory, `import-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`)
    fs.writeFileSync(file, sqlText, { flag: 'wx' })
    return execute(process.execPath, [wrangler, ...wranglerArguments(target, file)], {
      cwd: target.directory, encoding: 'utf8', shell: false, windowsHide: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    })
  }
  const output = JSON.parse(sql(`SELECT name AS table_name, NULL AS column_name FROM sqlite_master WHERE type = 'table'
    UNION ALL SELECT 'products', name FROM pragma_table_info('products')
    UNION ALL SELECT 'categories', name FROM pragma_table_info('categories');`))
  if (!Array.isArray(output) || !output.length || output.some(result => result.success !== true || !Array.isArray(result.results))) throw new Error('Unrecognized Wrangler schema result.')
  const rows = output.flatMap(result => result.results)
  const schema = {
    tables: rows.filter(r => r.column_name === null).map(r => r.table_name),
    productColumns: rows.filter(r => r.table_name === 'products' && r.column_name !== null).map(r => r.column_name),
    categoryColumns: rows.filter(r => r.table_name === 'categories' && r.column_name !== null).map(r => r.column_name),
  }
  if (!schema.productColumns.includes('category_slug') || !schema.categoryColumns.includes('slug')) throw new Error('Disposable database must already contain the expected catalogue schema; no bootstrap/migrations are performed.')
  const planned = buildImportSql(JSON.parse(input), schema, { scope, legacySeasonId: options.legacySeasonId,
    workspace: target.directory, sourceHash: inputHash(input) })
  const planFile = path.join(target.directory, `reviewed-import-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`)
  fs.writeFileSync(planFile, planned, { flag: 'wx' })
  if (options.apply) {
    const applied = JSON.parse(sql(planned))
    if (!Array.isArray(applied) || !applied.length || applied.some(result => result.success !== true)) throw new Error('Wrangler did not confirm successful import; preserve disposable evidence for investigation.')
  }
  return { applied: options.apply, planFile, config: target.config, persist: target.persist, records: JSON.parse(input).records.length }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(runImport(process.argv.slice(2)), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
