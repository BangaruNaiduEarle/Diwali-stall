#!/usr/bin/env node
/**
 * Phase 0 baseline and 0020 comparison snapshots. Explicit local SQLite file
 * only; JSON goes to stdout. Snapshot/comparison modes never write artifacts.
 * Requires Python 3 (standard-library sqlite3); never invokes Wrangler.
 * Exit codes: 0 compatible, 1 inspection failed, 2 compatibility violations.
 * Original-column fingerprints include private fields, never raw values.
 * Comparison requires a separately reviewed post-schema hash; it cannot prove
 * trigger behavior and does not replace disposable migration rehearsal tests.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const MIGRATIONS_DIR = path.join(path.dirname(SCRIPT_PATH), '../database/migrations')

// Match existing scripts' Python subprocess convention without shell execution.
export function runPython(source, args = [], input = '') {
  const candidates = process.platform === 'win32'
    ? [['py', '-3'], ['python3'], ['python']]
    : [['python3'], ['python']]
  for (const [command, ...prefix] of candidates) {
    const result = spawnSync(command, [...prefix, '-c', source, ...args], {
      input, encoding: 'utf8', shell: false, windowsHide: true,
      maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
    })
    if (result.error?.code === 'ENOENT') continue
    return result
  }
  throw new Error('Python 3 with sqlite3 is required (py -3 on Windows or python3).')
}

const READER = String.raw`
import collections, hashlib, json, pathlib, sqlite3, sys

SEASONS = ['season-2026', 'season-2099']
SCOPED = ['categories', 'products', 'family_packs', 'private_rates',
          'product_purchase_rates', 'customer_requests', 'quotations', 'season_members']
REQUIRED = {
 'business_seasons': ['id', 'code', 'status'],
 'platform_settings': ['singleton_id', 'public_catalogue_season_id'],
 'season_members': ['season_id', 'admin_user_id', 'role', 'disabled_at'],
 'categories': ['slug', 'season_id'],
 'products': ['id', 'category_slug', 'season_id'],
 'family_packs': ['id', 'slug', 'season_id'],
 'private_rates': ['id', 'product_id', 'season_id', 'effective_to'],
 'product_purchase_rates': ['id', 'product_id', 'season_id', 'effective_to'],
 'customer_requests': ['id', 'season_id', 'public_reference'],
 'quotations': ['id', 'customer_request_id', 'season_id', 'status'],
 'customer_request_items': ['id', 'request_id', 'product_id', 'family_pack_id', 'line_number'],
 'quotation_items': ['id', 'quotation_id', 'product_id', 'line_number'],
 'family_pack_items': ['id', 'family_pack_id', 'product_id'],
 'family_pack_images': ['id', 'family_pack_id'],
 'admin_users': ['id', 'email', 'role', 'disabled_at'],
 'platform_admins': ['admin_user_id'],
 'admin_sessions': ['id', 'admin_user_id'],
 'admin_login_attempts': ['id'],
 'admin_owner_bootstrap': ['singleton_id', 'owner_user_id'],
 'd1_migrations': ['name'],
}

def quoted(name):
 return '"' + name.replace('"', '""') + '"'

def canonical(value):
 # Preserve SQLite types, blobs, duplicate rows and all column values.
 if value is None: return ['null']
 if isinstance(value, bytes): return ['blob', value.hex()]
 if isinstance(value, int): return ['integer', str(value)]
 if isinstance(value, float): return ['real', value.hex()]
 return ['text', value]

def digest(value):
 return hashlib.sha256(json.dumps(value, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()

def platform_owned(name, owner=None):
 # One rule for tables, object names and owning tables; '_' is a literal.
 return any(isinstance(n,str) and n.lower().startswith('_cf_') for n in (name,owner))

def application_master(c):
 return [r for r in c.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name')
         if not platform_owned(r[1],r[2])]

def integrity_issues(c, tables):
 # Keep platform data outside logical checks too; retain all application FKs.
 for t in tables:
  n = len(c.execute('PRAGMA foreign_key_check('+quoted(t)+')').fetchall())
  if n: yield {'code':'foreign_key_violation','subject':t,'count':n}
  errors = c.execute('PRAGMA quick_check('+quoted(t)+')').fetchall()
  if errors!=[('ok',)]: yield {'code':'sqlite_integrity_failure','subject':t,'count':len(errors)}

def audit():
 p = pathlib.Path(sys.argv[1]).resolve(strict=True)
 if not p.is_file(): raise ValueError('not a file')
 c = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True, timeout=5)
 try:
  c.execute('PRAGMA query_only=ON')
  c.execute('PRAGMA trusted_schema=OFF')
  # One read snapshot, including WAL contents. Do not use immutable=1: it ignores WAL.
  c.execute('BEGIN')
  master = application_master(c)
  tables = {r[1] for r in master if r[0] == 'table'}
  columns = {t: {r[1] for r in c.execute('PRAGMA table_info(' + quoted(t) + ')')} for t in REQUIRED if t in tables}
  violations = []
  def issue(code, subject, count=1):
   violations.append({'code': code, 'subject': subject, 'count': count})
  def ready(*specs):
   return all(t in columns and set(cols).issubset(columns[t]) for t, cols in specs)
  for t, cols in REQUIRED.items():
   if t not in tables: issue('missing_table', t)
   elif not set(cols).issubset(columns[t]): issue('missing_required_columns', t, len(set(cols)-columns[t]))

  schema = {}
  counts = {}
  for t in REQUIRED:
   if t not in tables: continue
   counts[t] = c.execute('SELECT count(*) FROM ' + quoted(t)).fetchone()[0]
   schema[t] = {
    'columns': [{'name': r[1], 'type': r[2], 'notNull': bool(r[3]), 'primaryKeyPosition': r[5]}
                for r in c.execute('PRAGMA table_info(' + quoted(t) + ')')],
    'foreignKeys': [{'table': r[2], 'from': r[3], 'to': r[4], 'onDelete': r[6]}
                    for r in c.execute('PRAGMA foreign_key_list(' + quoted(t) + ')')],
    'indexes': [{'name': r[1], 'unique': bool(r[2]), 'partial': bool(r[4]),
                 'columns': [x[2] for x in c.execute('PRAGMA index_info(' + quoted(r[1]) + ')')]}
                for r in c.execute('PRAGMA index_list(' + quoted(t) + ')') if not platform_owned(r[1],t)],
   }
  expected = json.loads(sys.stdin.read())
  applied = []
  if ready(('d1_migrations', ['name'])):
   names = [r[0] for r in c.execute('SELECT name FROM d1_migrations ORDER BY name')]
   # Only repository filenames are printed. Unknown database values may be sensitive.
   applied = [n for n in names if n in expected]
   for n in expected:
    if n not in names: issue('missing_migration', n)
   unknown = sum(n not in expected for n in names)
   if unknown: issue('unknown_applied_migrations', 'd1_migrations', unknown)
   if len(names) != len(set(names)): issue('duplicate_migration_entries', 'd1_migrations')

  violations.extend(integrity_issues(c,sorted(tables)))

  # Also check logical edges explicitly: missing FK declarations must not hide orphans.
  edges = [
   ('products','category_slug','categories','slug'),
   ('private_rates','product_id','products','id'),
   ('product_purchase_rates','product_id','products','id'),
   ('quotations','customer_request_id','customer_requests','id'),
   ('customer_request_items','request_id','customer_requests','id'),
   ('customer_request_items','product_id','products','id'),
   ('customer_request_items','family_pack_id','family_packs','id'),
   ('quotation_items','quotation_id','quotations','id'),
   ('quotation_items','product_id','products','id'),
   ('family_pack_images','family_pack_id','family_packs','id'),
   ('family_pack_items','family_pack_id','family_packs','id'),
   ('family_pack_items','product_id','products','id'),
   ('season_members','admin_user_id','admin_users','id'),
   ('platform_admins','admin_user_id','admin_users','id'),
   ('admin_sessions','admin_user_id','admin_users','id'),
   ('admin_owner_bootstrap','owner_user_id','admin_users','id'),
   ('platform_settings','public_catalogue_season_id','business_seasons','id'),
  ] + [(t,'season_id','business_seasons','id') for t in SCOPED]
  for child, fk, parent, pk in edges:
   if not ready((child,[fk]), (parent,[pk])): continue
   if child != 'admin_owner_bootstrap' and not any(f['table']==parent and f['from']==fk and f['to']==pk for f in schema[child]['foreignKeys']):
    issue('missing_foreign_key_constraint', child + '.' + fk + '->' + parent)
   n = c.execute('SELECT count(*) FROM ' + child + ' a LEFT JOIN ' + parent +
                 ' b ON a.' + fk + '=b.' + pk + ' WHERE a.' + fk + ' IS NOT NULL AND b.' + pk + ' IS NULL').fetchone()[0]
   if n: issue('missing_relationship', child + '.' + fk + '->' + parent, n)
  for t in SCOPED:
   if ready((t,['season_id'])):
    n = c.execute('SELECT count(*) FROM ' + t + ' WHERE season_id IS NULL').fetchone()[0]
    if n: issue('missing_season_ownership', t, n)
  checks = [
   ('product_category', 'products a JOIN categories b ON a.category_slug=b.slug', [('products',['category_slug','season_id']),('categories',['slug','season_id'])]),
   ('private_rate_product', 'private_rates a JOIN products b ON a.product_id=b.id', [('private_rates',['product_id','season_id']),('products',['id','season_id'])]),
   ('purchase_rate_product', 'product_purchase_rates a JOIN products b ON a.product_id=b.id', [('product_purchase_rates',['product_id','season_id']),('products',['id','season_id'])]),
   ('quotation_request', 'quotations a JOIN customer_requests b ON a.customer_request_id=b.id', [('quotations',['customer_request_id','season_id']),('customer_requests',['id','season_id'])]),
   ('pack_product', 'family_pack_items i JOIN family_packs a ON a.id=i.family_pack_id JOIN products b ON b.id=i.product_id', [('family_pack_items',['family_pack_id','product_id']),('family_packs',['id','season_id']),('products',['id','season_id'])]),
   ('request_product', 'customer_request_items i JOIN customer_requests a ON a.id=i.request_id JOIN products b ON b.id=i.product_id', [('customer_request_items',['request_id','product_id']),('customer_requests',['id','season_id']),('products',['id','season_id'])]),
   ('request_pack', 'customer_request_items i JOIN customer_requests a ON a.id=i.request_id JOIN family_packs b ON b.id=i.family_pack_id', [('customer_request_items',['request_id','family_pack_id']),('customer_requests',['id','season_id']),('family_packs',['id','season_id'])]),
   ('quotation_product', 'quotation_items i JOIN quotations a ON a.id=i.quotation_id JOIN products b ON b.id=i.product_id', [('quotation_items',['quotation_id','product_id']),('quotations',['id','season_id']),('products',['id','season_id'])]),
  ]
  for label, join, specs in checks:
   if ready(*specs):
    n = c.execute('SELECT count(*) FROM ' + join + ' WHERE a.season_id IS NOT b.season_id').fetchone()[0]
    if n: issue('cross_season_relationship', label, n)

  # Global identity/slug constraints are expected today, but block future local slugs.
  unique_specs = [('categories',['slug']),('products',['id']),('family_packs',['id']),
                  ('family_packs',['slug']),('business_seasons',['code']),('admin_users',['email']),
                  ('season_members',['season_id','admin_user_id']),
                  ('customer_request_items',['request_id','line_number']),('quotation_items',['quotation_id','line_number'])]
  for t, key in unique_specs:
   if t in schema and not any(i['unique'] and not i['partial'] and i['columns']==key for i in schema[t]['indexes']):
    issue('missing_unique_constraint', t + '.' + '+'.join(key))
  for t, name in [('private_rates','idx_private_rates_one_current'),
                  ('product_purchase_rates','idx_product_purchase_rates_one_current'),
                  ('quotations','idx_quotations_one_active_per_request'),
                  ('customer_requests','idx_customer_requests_public_reference')]:
   if t in schema and not any(i['name']==name and i['unique'] and i['partial'] for i in schema[t]['indexes']):
    issue('missing_partial_unique_index', name)

  def fingerprint(t, where, params):
   cursor = c.execute('SELECT a.* FROM ' + t + ' a WHERE ' + where, params)
   names = [r[0] for r in cursor.description]
   encoded = sorted(json.dumps([canonical(v) for v in row], ensure_ascii=True, separators=(',', ':')) for row in cursor)
   return {'count':len(encoded), 'sha256':digest([names, encoded])}
  seasons = {}
  for season in SEASONS:
   parts = {}
   def add(t, where, specs):
    if ready(*specs): parts[t] = fingerprint(t, where, (season,))
   add('business_seasons','a.id=?',[('business_seasons',['id'])])
   if not parts.get('business_seasons',{}).get('count'): issue('missing_baseline_season',season)
   for t in SCOPED: add(t,'a.season_id=?',[(t,['season_id'])])
   for t, fk, parent in [('family_pack_items','family_pack_id','family_packs'),
                          ('family_pack_images','family_pack_id','family_packs'),
                          ('customer_request_items','request_id','customer_requests'),
                          ('quotation_items','quotation_id','quotations')]:
    add(t,'a.'+fk+' IN (SELECT id FROM '+parent+' WHERE season_id=?)',[(t,[fk]),(parent,['id','season_id'])])
   add('admin_users','a.id IN (SELECT admin_user_id FROM season_members WHERE season_id=?)', [('admin_users',['id']),('season_members',['admin_user_id','season_id'])])
   add('platform_admins','a.admin_user_id IN (SELECT admin_user_id FROM season_members WHERE season_id=?)', [('platform_admins',['admin_user_id']),('season_members',['admin_user_id','season_id'])])
   seasons[season] = {'tables':parts, 'sha256':digest(parts),
                     'complete': len(parts)==15}
  return {'formatVersion':2, 'schemaScope':'application', 'readOnly':True, 'compatible':not violations,
          'migrations':{'expected':expected,'applied':applied},
          'schema':{'sha256':digest(master),'tables':schema}, 'counts':counts,
          'seasons':seasons, 'violations':violations,
          'notes':[
           'Fingerprints include every column of selected rows; no raw row contents are emitted.',
           'Shared admin identities affect both season hashes when members overlap; sessions/login attempts are counted, not season-fingerprinted.',
           'Unowned/orphan rows are reported globally; child fingerprints follow parent ownership.',
           'Global category and pack slug uniqueness must be redesigned before independent local slugs.',
           'This checks the pre-location baseline; it does not infer business/location mappings or validate Phase 1 architecture.',
           'A fingerprint is a comparison baseline, not a backup or proof of correctness without a prior baseline.'
          ]}
 finally:
  c.close()

try:
 print(json.dumps(audit(), ensure_ascii=True))
except Exception:
 # SQLite exceptions and tracebacks can contain row values or SQL literals.
 print(json.dumps({'error':'local_sqlite_inspection_failed'}))
 sys.exit(1)
`

// Reuse the typed canonical hashing above. Snapshot/comparison never call the
// legacy audit: the latter intentionally expects the current migration inventory.
const COMPARISON_READER = READER.slice(0, READER.indexOf('\ndef audit():')) + String.raw`
MIGRATION = '0020_business_location_foundation.sql'
OWNED = ['categories','products','family_packs','private_rates',
         'product_purchase_rates','customer_requests','quotations']
FOUNDATION = ['businesses','business_locations','location_seasons','location_members']
LOCATION = 'location-diwali-2026'
BUSINESS = 'business-diwali'

def rows_hash(c, table, names, where='1', params=()):
 cursor = c.execute('SELECT '+','.join(quoted(n) for n in names)+' FROM '+quoted(table)+' WHERE '+where, params)
 encoded = sorted(json.dumps([canonical(v) for v in row], ensure_ascii=True, separators=(',', ':')) for row in cursor)
 return {'count':len(encoded), 'sha256':digest([names, encoded])}

def column_metadata(c, table):
 # Defaults are hashed: SQL defaults can themselves contain sensitive literals.
 return [{'name':r[1], 'type':r[2], 'notNull':bool(r[3]), 'defaultSha256':digest(r[4]),
          'primaryKeyPosition':r[5], 'hidden':r[6]}
         for r in c.execute('PRAGMA table_xinfo('+quoted(table)+')')]

def foreign_keys(c, table):
 # FK numeric ids can change when ADD COLUMN prepends another FK. Preserve groups.
 groups = collections.defaultdict(list)
 for r in c.execute('PRAGMA foreign_key_list('+quoted(table)+')'):
  groups[r[0]].append(list(r[1:]))
 return sorted([sorted(group) for group in groups.values()])

def artifact_violations(base, baseline):
 issues = []
 def fail(code, subject): issues.append({'code':code,'subject':subject,'count':1})
 if (not isinstance(base,dict) or base.get('formatVersion') not in (1,2)
     or base.get('kind')!='diwali-pre-0020-comparison-snapshot'
     or base.get('algorithm')!='sha256-sqlite-typed-rows-v1' or base.get('readOnly') is not True
     or base.get('sha256')!=digest({k:v for k,v in base.items() if k!='sha256'})
     or not isinstance(base.get('tables'),dict)
     or any(t not in base['tables'] for t in REQUIRED)
     or any(t in base['tables'] for t in FOUNDATION)):
  fail('invalid_comparison_snapshot','snapshot')
  return issues
 # Check the ORIGINAL seal before deriving or using an application-only view.
 if ((base['formatVersion']==1 and 'schemaScope' in base)
     or (base['formatVersion']==2 and base.get('schemaScope')!='application')):
  fail('invalid_snapshot_schema_scope','snapshot')
  return issues
 if baseline is None:
  fail('compatibility_baseline_required','baseline')
  return issues
 if (not isinstance(baseline,dict) or baseline.get('formatVersion') not in (1,2)
     or baseline.get('readOnly') is not True or baseline.get('compatible') is not True
     or baseline.get('violations')!=[] or not isinstance(baseline.get('schema',{}).get('tables'),dict)
     or not isinstance(baseline.get('counts'),dict) or not isinstance(baseline.get('seasons'),dict)
     or not isinstance(baseline.get('migrations',{}).get('applied'),list)
     or baseline['migrations'].get('expected')!=baseline['migrations']['applied']
     or MIGRATION in baseline['migrations']['applied']):
  fail('invalid_compatibility_baseline','baseline')
  return issues
 if (baseline['formatVersion']!=base['formatVersion']
     or (baseline['formatVersion']==1 and 'schemaScope' in baseline)
     or (baseline['formatVersion']==2 and baseline.get('schemaScope')!='application')):
  fail('artifact_schema_scope_mismatch','baseline')
  return issues
 # For saved v1 artifacts this is historical provenance, never a current DB hash.
 if base.get('schemaSha256')!=baseline['schema'].get('sha256'):
  fail('artifact_schema_mismatch','baseline')
 table_objects = {o['name'] for o in base.get('schemaObjects',[]) if o.get('type')=='table'}
 if table_objects!=set(base['tables']): fail('snapshot_table_inventory_mismatch','snapshot')
 if base['formatVersion']==2 and (any(platform_owned(t) for t in base['tables'])
     or any(platform_owned(o['name'],o['table']) for o in base['schemaObjects'])):
  fail('invalid_snapshot_schema_scope','snapshot')
 for t, saved in baseline['schema']['tables'].items():
  if t not in base['tables']:
   fail('baseline_table_missing_from_snapshot',t)
   continue
  common = ['name','type','notNull','primaryKeyPosition']
  projected = [{key:col.get(key) for key in common} for col in base['tables'][t]['columns']]
  expected = [{key:col.get(key) for key in common} for col in saved['columns']]
  if projected!=expected: fail('artifact_original_columns_mismatch',t)
  if base['tables'][t]['count']!=baseline['counts'].get(t): fail('artifact_record_count_mismatch',t)
 required_parts = set(SCOPED + ['business_seasons','family_pack_items','family_pack_images',
                              'customer_request_items','quotation_items','admin_users','platform_admins'])
 for season in SEASONS:
  part = baseline['seasons'].get(season,{})
  if (part.get('complete') is not True or set(part.get('tables',{}))!=required_parts
      or part.get('sha256')!=digest(part.get('tables'))):
   fail('invalid_baseline_season_fingerprint',season)
 return issues

def application_view(base):
 # Called only AFTER artifact_violations validates the untouched input checksum.
 return {**base,
         'tables':{t:v for t,v in base['tables'].items() if not platform_owned(t)},
         'schemaObjects':[o for o in base['schemaObjects'] if not platform_owned(o['name'],o['table'])]}

def comparison(c, request):
 master = application_master(c)
 tables = sorted(r[1] for r in master if r[0]=='table')
 schema_hash = digest(master)
 objects = [{'type':r[0], 'name':r[1], 'table':r[2], 'sha256':digest(r[3])} for r in master]
 if request['mode']=='snapshot':
  # Capture only the pre-0020 state, never silently redefine original columns.
  if any(t in tables for t in FOUNDATION) or any(t not in tables for t in REQUIRED):
   raise ValueError('not a pre-foundation database')
  if c.execute('SELECT count(*) FROM d1_migrations WHERE name=?',(MIGRATION,)).fetchone()[0]:
   raise ValueError('0020 already recorded')
  captured = {}
  for t in tables:
   meta = column_metadata(c,t)
   if t in OWNED and any(col['name']=='location_id' for col in meta):
    raise ValueError('ownership already present')
   names = [col['name'] for col in meta]
   captured[t] = {'columns':meta, 'foreignKeys':foreign_keys(c,t), **rows_hash(c,t,names)}
  result = {'formatVersion':2, 'schemaScope':'application', 'kind':'diwali-pre-0020-comparison-snapshot',
            'readOnly':True, 'algorithm':'sha256-sqlite-typed-rows-v1',
            'schemaSha256':schema_hash, 'schemaObjects':objects, 'tables':captured}
  # Wrangler's migration-history INSERT can advance its AUTOINCREMENT counter.
  # Pin the exact expected counter without exporting its row or numeric value.
  migration_columns = [col['name'] for col in captured['d1_migrations']['columns']]
  if 'id' in migration_columns:
   next_id = c.execute('SELECT coalesce(max(id),0)+1 FROM d1_migrations').fetchone()[0]
   if 'sqlite_sequence' in tables:
    seq = c.execute("SELECT seq FROM sqlite_sequence WHERE name='d1_migrations'").fetchone()
    if seq: next_id = max(next_id,seq[0]+1)
   result['newMigrationIdSha256'] = digest(canonical(next_id))
   if 'sqlite_sequence' in tables:
    names = [col['name'] for col in captured['sqlite_sequence']['columns']]
    rows = c.execute('SELECT '+','.join(quoted(n) for n in names)+' FROM sqlite_sequence').fetchall()
    rows = [tuple(next_id if names[i]=='seq' and row[names.index('name')]=='d1_migrations' else v for i,v in enumerate(row)) for row in rows]
    encoded = sorted(json.dumps([canonical(v) for v in row],ensure_ascii=True,separators=(',',':')) for row in rows)
    result['allowedSequenceAfter0020'] = {'count':len(rows),'sha256':digest([names,encoded])}
  result['sha256'] = digest(result)
  return result

 base = request['snapshot']
 baseline = request.get('baseline')
 violations = artifact_violations(base,baseline)
 pre = request['mode']=='verify-pre'
 kind = 'diwali-pre-0020-verification' if pre else 'diwali-0020-comparison'
 if violations:
  return {'formatVersion':2,'schemaScope':'application','kind':kind,'readOnly':True,
          'compatible':False,'schemaSha256':schema_hash,'violations':violations}
 base = application_view(base)
 def issue(code, subject, count=1):
  violations.append({'code':code,'subject':subject,'count':count})
 policy = request.get('schemaPolicy')
 if pre:
  if policy is not None: issue('schema_policy_not_allowed_pre_0020','policy')
 elif not policy:
  issue('reviewed_schema_policy_required','0020')
 elif (not isinstance(policy,dict) or set(policy)!={'formatVersion','schemaScope','migration','schemaSha256'}
       or policy['formatVersion']!=2 or policy['schemaScope']!='application'
       or policy['migration']!=MIGRATION or not isinstance(policy['schemaSha256'],str)
       or len(policy['schemaSha256'])!=64
       or any(ch not in '0123456789abcdef' for ch in policy['schemaSha256'])):
  issue('invalid_schema_policy','0020')
 elif policy['schemaSha256']!=schema_hash:
  issue('unapproved_schema','database')
 # A reviewed schema hash pins new table definitions, CHECKs, indexes, trigger SQL,
 # and all allowed ALTERs. Never trust names/prefixes as approval of arbitrary SQL.
 original = base['tables']
 for t in sorted(set(original)-set(tables)): issue('missing_original_table',t)
 for t in sorted(set(tables)-set(original)-(set() if pre else set(FOUNDATION))): issue('unexpected_table',t)
 for t in ([] if pre else FOUNDATION):
  if t not in tables: issue('missing_foundation_table',t)
 results = {}
 available = {}
 for t, saved in original.items():
  if t not in tables: continue
  current = column_metadata(c,t)
  available[t] = {col['name'] for col in current}
  names = [col['name'] for col in saved['columns']]
  expected_count = len(names) + (1 if t in OWNED and not pre else 0)
  if current[:len(names)]!=saved['columns'] or len(current)!=expected_count:
   issue('original_column_schema_changed',t)
  if t in OWNED and not pre:
   expected_col = {'name':'location_id','type':'TEXT','notNull':False,'defaultSha256':digest(None),'primaryKeyPosition':0,'hidden':0}
   if current[len(names):]!=[expected_col]: issue('unexpected_ownership_column',t)
  expected_fks = list(saved['foreignKeys'])
  if t in OWNED and not pre:
   expected_fks.append([[0,'business_locations','location_id','id','NO ACTION','NO ACTION','NONE']])
  if foreign_keys(c,t)!=sorted(expected_fks): issue('foreign_key_schema_changed',t)
  if not set(names).issubset(available[t]): continue
  where = '1'
  params = ()
  if t=='d1_migrations':
   history = [r[0] for r in c.execute('SELECT name FROM d1_migrations')]
   expected_history = baseline['migrations']['applied']+([] if pre else [MIGRATION])
   if collections.Counter(history)!=collections.Counter(expected_history):
    issue('unexpected_migration_inventory',t)
  if t=='d1_migrations' and not pre:
   # Exclude exactly the new row; hash every original column of all prior entries.
   where = 'name IS NOT ?'
   params = (MIGRATION,)
   n = c.execute('SELECT count(*) FROM d1_migrations WHERE name=?',(MIGRATION,)).fetchone()[0]
   if n!=1: issue('expected_migration_entry_missing_or_duplicate',t)
   elif 'newMigrationIdSha256' in base:
    row_id = c.execute('SELECT id FROM d1_migrations WHERE name=?',(MIGRATION,)).fetchone()[0]
    if digest(canonical(row_id))!=base['newMigrationIdSha256']:
     issue('unexpected_migration_id',t)
  actual = rows_hash(c,t,names,where,params)
  results[t] = actual
  expected_rows = base.get('allowedSequenceAfter0020') if t=='sqlite_sequence' and not pre else None
  if actual!=(expected_rows or {'count':saved['count'],'sha256':saved['sha256']}):
   issue('original_rows_changed',t)
 # Existing indexes/triggers/views must remain byte-identical; altered table SQL
 # is pinned by the reviewed policy. This also protects global slug constraints.
 current_objects = {(o['type'],o['name']):o for o in objects}
 for obj in base['schemaObjects']:
  if not pre and obj['type']=='table' and obj['name'] in OWNED: continue
  if current_objects.get((obj['type'],obj['name']))!=obj:
   issue('original_schema_object_changed',obj['table'])
 if pre:
  original_objects = {(o['type'],o['name']) for o in base['schemaObjects']}
  for key in sorted(set(current_objects)-original_objects):
   issue('unexpected_schema_object',current_objects[key]['table'])
 ownership = {}
 if not pre:
  for t in OWNED:
   if not {'season_id','location_id'}.issubset(available.get(t,set())):
    issue('ownership_check_unavailable',t)
    continue
   n = c.execute('SELECT count(*) FROM '+quoted(t)+
                 ' WHERE location_id IS NOT CASE WHEN season_id=? THEN ? ELSE NULL END',
                 ('season-2026',LOCATION)).fetchone()[0]
   mapped = c.execute('SELECT count(*) FROM '+quoted(t)+' WHERE season_id=? AND location_id=?',('season-2026',LOCATION)).fetchone()[0]
   expected_mapped = baseline['seasons']['season-2026']['tables'][t]['count']
   ownership[t] = {'mapped2026':mapped,'expected2026':expected_mapped,'violations':n}
   if mapped!=expected_mapped: issue('unexpected_2026_ownership_count',t)
   if n: issue('unexpected_location_ownership',t,n)
  for t in ['private_rates','product_purchase_rates']:
   if {'product_id','location_id'}.issubset(available.get(t,set())) and {'id','location_id'}.issubset(available.get('products',set())):
    n = c.execute('SELECT count(*) FROM '+t+' r LEFT JOIN products p ON p.id=r.product_id WHERE p.id IS NULL OR r.location_id IS NOT p.location_id').fetchone()[0]
    if n: issue('rate_product_location_mismatch',t,n)
  if {'id','customer_request_id','location_id','season_id'}.issubset(available.get('quotations',set())) and {'id','location_id','season_id'}.issubset(available.get('customer_requests',set())):
   n = c.execute('SELECT count(*) FROM quotations q LEFT JOIN customer_requests r ON r.id=q.customer_request_id WHERE q.customer_request_id IS NOT NULL AND (r.id IS NULL OR q.location_id IS NOT r.location_id OR q.season_id IS NOT r.season_id)').fetchone()[0]
   if n: issue('quotation_request_scope_mismatch','quotations',n)

  def foundation_ready(t, names):
   if t not in tables: return False
   if not set(names).issubset({col['name'] for col in column_metadata(c,t)}):
    issue('foundation_columns_missing',t)
    return False
   return True
  # No extra businesses/locations/associations/members may sneak into rehearsal.
  for t, names, expected_rows in [
   ('businesses',['id','business_type','status'],[(BUSINESS,'seasonal','active')]),
   ('business_locations',['id','business_id','status'],[(LOCATION,BUSINESS,'active')]),
   ('location_seasons',['location_id','season_id','operating_year','status'],[(LOCATION,'season-2026',2026,'active')]),
  ]:
   if foundation_ready(t,names):
    actual = c.execute('SELECT '+','.join(quoted(n) for n in names)+' FROM '+t).fetchall()
    if actual!=expected_rows: issue('unexpected_foundation_rows',t)
  member_names = ['location_id','season_id','admin_user_id','role','disabled_at']
  if foundation_ready('location_members',member_names) and {'season_id','admin_user_id','role','disabled_at'}.issubset(available.get('season_members',set())):
   # Hash expected membership projection entirely in memory; never output emails/ids.
   expected_members = c.execute('SELECT ?,season_id,admin_user_id,role,disabled_at FROM season_members WHERE season_id=?',(LOCATION,'season-2026')).fetchall()
   def member_hash(rows): return digest(sorted(json.dumps([canonical(v) for v in r],ensure_ascii=True,separators=(',',':')) for r in rows))
   actual_members = c.execute('SELECT '+','.join(member_names)+' FROM location_members').fetchall()
   if member_hash(actual_members)!=member_hash(expected_members): issue('unexpected_location_memberships','location_members')
   if len(actual_members)!=baseline['seasons']['season-2026']['tables']['season_members']['count']:
    issue('unexpected_2026_membership_count','location_members')

 # Independently re-evaluate the saved season baseline on its original columns.
 # The companion protects ALL application rows, including globals/unowned rows.
 season_results = {}
 for season in SEASONS:
  parts = {}
  for t, saved in baseline['seasons'][season]['tables'].items():
   if t not in available: continue
   names = [col['name'] for col in baseline['schema']['tables'][t]['columns']]
   if not set(names).issubset(available[t]): continue
   if t=='business_seasons': where = 'id=?'
   elif t in SCOPED: where = 'season_id=?'
   elif t in ['admin_users','platform_admins']:
    key = 'id' if t=='admin_users' else 'admin_user_id'
    where = key+' IN (SELECT admin_user_id FROM season_members WHERE season_id=?)'
   else:
    fk,parent = {'family_pack_items':('family_pack_id','family_packs'),
                 'family_pack_images':('family_pack_id','family_packs'),
                 'customer_request_items':('request_id','customer_requests'),
                 'quotation_items':('quotation_id','quotations')}[t]
    where = fk+' IN (SELECT id FROM '+parent+' WHERE season_id=?)'
   parts[t] = rows_hash(c,t,names,where,(season,))
   if parts[t]!=saved: issue('baseline_season_rows_changed',season+'.'+t)
  season_results[season] = {'tables':parts,'sha256':digest(parts),
                            'complete':len(parts)==len(baseline['seasons'][season]['tables'])}
  if season_results[season]['sha256']!=baseline['seasons'][season]['sha256']:
   issue('baseline_season_fingerprint_changed',season)
 violations.extend(integrity_issues(c,tables))
 return {'formatVersion':2,'schemaScope':'application','kind':kind,'readOnly':True,
         'compatible':not violations,'snapshotSha256':base['sha256'],
         'schemaSha256':schema_hash,'tables':results,'ownership':ownership,'seasons':season_results,
         'violations':violations,
         'notes':['Pre-0020 application schema and data are compared without migration allowances.' if pre else
                  'Comparison checks preserved original rows and initial 2026 ownership; it does not execute or prove trigger behavior.',
                  'Platform-owned _cf_ object names and owning tables are excluded case-insensitively; sqlite_sequence remains checked.',
                  'The schema policy must come from independent review, never automatic acceptance of the database being checked.']}

try:
 p = pathlib.Path(sys.argv[1]).resolve(strict=True)
 c = sqlite3.connect(p.as_uri()+'?mode=ro', uri=True, timeout=5)
 try:
  c.execute('PRAGMA query_only=ON')
  c.execute('PRAGMA trusted_schema=OFF')
  c.execute('BEGIN')
  print(json.dumps(comparison(c,json.loads(sys.stdin.read())),ensure_ascii=True))
 finally:
  c.close()
except Exception:
 print(json.dumps({'error':'comparison_inspection_failed'}))
 sys.exit(1)
`

/** Verify saved JSON artifacts without opening any SQLite database. */
export function validateComparisonArtifacts(snapshot, baseline) {
  const source = COMPARISON_READER.slice(0, COMPARISON_READER.lastIndexOf('\ntry:')) + String.raw`
request = json.loads(sys.stdin.read())
try:
 issues = artifact_violations(request['snapshot'],request.get('baseline'))
except Exception:
 issues = [{'code':'malformed_comparison_artifacts','subject':'artifacts','count':1}]
print(json.dumps({'readOnly':True,'compatible':not issues,'violations':issues}))
`
  const result = runPython(source, [], JSON.stringify({ snapshot, baseline }))
  if (result.error || result.status !== 0) throw new Error('Artifact validation failed.')
  return JSON.parse(result.stdout)
}

function inspectLocalDatabase(databasePath, source, input) {
  if (typeof databasePath !== 'string' || !databasePath.trim()) {
    throw new Error('An explicit local database path is required (--database <path>).')
  }
  // Reject URIs, UNC/network shares, device paths and non-files. Never create a DB.
  if (/^[a-z][a-z\d+.-]*:/i.test(databasePath) && !/^[a-z]:[\\/]/i.test(databasePath)) {
    throw new Error('Database must be a local file path, not a URI.')
  }
  if (/^[\\/]{2}/.test(databasePath)) {
    throw new Error('Database must be a local file path, not a network share.')
  }
  const resolved = fs.realpathSync(path.resolve(databasePath))
  if ([databasePath, resolved].some(p => /^[\\/]{2}/.test(p)) || !fs.statSync(resolved).isFile()) {
    throw new Error('Database must be an existing local file, not a directory or network share.')
  }
  const result = runPython(source, [resolved], JSON.stringify(input))
  if (result.error || result.status !== 0) {
    throw new Error('Read-only SQLite inspection failed. Ensure Python 3/sqlite3 is available and the file is a readable SQLite database.')
  }
  try { return JSON.parse(result.stdout) } catch {
    throw new Error('Read-only SQLite inspection returned an invalid report.')
  }
}

export function auditLocalDatabase(databasePath) {
  const migrations = fs.readdirSync(MIGRATIONS_DIR).filter(n => /^\d+.*\.sql$/.test(n)).sort()
  return inspectLocalDatabase(databasePath, READER, migrations)
}

/** All non-platform tables, including sqlite_sequence/unowned rows. No writes. */
export function captureComparisonSnapshot(databasePath) {
  return inspectLocalDatabase(databasePath, COMPARISON_READER, { mode: 'snapshot' })
}

/** Verify the pre-0020 application schema/data against both saved artifacts. */
export function verifyPreMigrationSnapshot(databasePath, snapshot, baseline = null) {
  return inspectLocalDatabase(databasePath, COMPARISON_READER, { mode: 'verify-pre', snapshot, baseline })
}

/** schemaPolicy pins independently reviewed application-only post-0020 SQL. */
export function compareComparisonSnapshot(databasePath, snapshot, schemaPolicy = null, baseline = null) {
  return inspectLocalDatabase(databasePath, COMPARISON_READER, { mode: 'compare', snapshot, schemaPolicy, baseline })
}

function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(`Usage: node server/scripts/audit-location-compatibility.mjs --database <existing-local.sqlite>
  --snapshot                         Emit pre-0020 comparison snapshot to stdout.
  --compare <snapshot.json>           Compare original columns and 0020 ownership.
  --verify-pre-0020 <snapshot.json>    Verify unchanged pre-0020 application state.
  --baseline <baseline.json>          Required original compatibility baseline.
  --schema-policy <reviewed.json>     Required only for post-0020 comparison.
Policy: {"formatVersion":2,"schemaScope":"application","migration":"0020_business_location_foundation.sql","schemaSha256":"<independently reviewed post-schema SHA-256>"}
The schema digest uses the existing canonical JSON algorithm over sqlite_master
(type,name,tbl_name,sql), ordered by type,name, excluding case-insensitive _cf_
object names OR owning table names. No raw SQL is exported. Legacy v1 saved
artifact pairs remain supported unchanged; new captures/audits use v2 scope.
Never approve the compared database's hash automatically. Trigger behavior needs
separate rehearsal tests. Snapshots are not backups and do not replace the saved
season baseline. Requires Python 3. JSON to stdout only; no files are written.
Exit: 0 compatible/snapshot captured, 1 failed, 2 violations.`)
    return
  }
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (!['--database', '--snapshot', '--compare', '--verify-pre-0020', '--schema-policy', '--baseline'].includes(key) || key in options) {
      throw new Error('Invalid or duplicate checker option.')
    }
    if (key === '--snapshot') options[key] = true
    else {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error('Checker option requires a value.')
      options[key] = value
    }
  }
  const pre = options['--verify-pre-0020']
  if (!options['--database'] || [options['--snapshot'], options['--compare'], pre].filter(Boolean).length > 1
      || (options['--schema-policy'] && !options['--compare'])
      || (options['--baseline'] && !options['--compare'] && !pre)) {
    throw new Error('Usage: node server/scripts/audit-location-compatibility.mjs --database <existing-local.sqlite>')
  }
  let report
  if (options['--snapshot']) report = captureComparisonSnapshot(options['--database'])
  else if (options['--compare'] || pre) {
    const readJson = file => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch {
        throw new Error('Snapshot or schema policy is not readable UTF-8 JSON.')
      }
    }
    if (pre) report = verifyPreMigrationSnapshot(options['--database'], readJson(pre),
      options['--baseline'] ? readJson(options['--baseline']) : null)
    else report = compareComparisonSnapshot(options['--database'], readJson(options['--compare']),
      options['--schema-policy'] ? readJson(options['--schema-policy']) : null,
      options['--baseline'] ? readJson(options['--baseline']) : null)
  } else report = auditLocalDatabase(options['--database'])
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.compatible === false ? 2 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try { main(process.argv.slice(2)) } catch (error) {
    // Do not expose OS errors containing user-controlled paths or subprocess output.
    console.error(JSON.stringify({ error: error.code ? 'local_database_path_unavailable' : error.message }))
    process.exitCode = 1
  }
}
