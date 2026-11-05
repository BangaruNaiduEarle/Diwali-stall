import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const root=path.resolve(process.argv[2]??'')
assert.ok(path.basename(root).startsWith('diwali-release-'),'Use a fresh disposable release directory')
const manifest=JSON.parse(await readFile(path.join(root,'backup-verification.json'),'utf8'))
assert.equal(manifest.sourceReadOnly,true)
const original=manifest.databases.find(entry=>entry.migrations.includes('0020_business_location_foundation.sql'))
assert.ok(original,'A verified post-0020 local backup is required')
assert.ok(original.migrations.every(name=>!/^002[1-4]_/.test(name)))
await mkdir(path.join(root,'migrations'))
await mkdir(path.join(root,'persist'))
const names=['0021_request_workflow_history.sql','0022_request_payment_ledger.sql','0023_offline_sync_receipts.sql','0024_qr_handover.sql']
for(const name of names)await copyFile(path.resolve('server/database/migrations',name),path.join(root,'migrations',name))
const entry=path.resolve('server/src/index.js').replaceAll('\\','/')
const configuration=`name = "diwali-release-readiness"
main = ${JSON.stringify(entry)}
compatibility_date = "2026-05-01"
[vars]
ADMIN_LOCATION_MODE = "1"
ADMIN_LOCAL_DEV_AUTH = "0"
CORS_ALLOWED_ORIGINS = "http://localhost:5193,http://localhost:8793,http://127.0.0.1:8793"
[[d1_databases]]
binding = "DB"
database_name = "diwali-release-disposable"
database_id = "${crypto.randomUUID()}"
migrations_dir = "migrations"
`
await writeFile(path.join(root,'wrangler.toml'),configuration,{flag:'wx'})
await writeFile(path.join(root,'wrangler-legacy.toml'),configuration.replace('ADMIN_LOCATION_MODE = "1"','ADMIN_LOCATION_MODE = "0"').replace('name = "diwali-release-readiness"','name = "diwali-release-legacy"'),{flag:'wx'})
const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
await writeFile(path.join(root,'.dev.vars'),"HANDOVER_SIGNING_JWK='"+JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey))+"'\n",{flag:'wx'})
await writeFile(path.join(root,'isolation.json'),JSON.stringify({root,original:original.source,verifiedBackup:original.backup,persist:path.join(root,'persist'),config:path.join(root,'wrangler.toml'),migrations:names,originalMigrationCount:original.migrations.length},null,2),{flag:'wx'})
console.log(JSON.stringify({root,config:path.join(root,'wrangler.toml'),persist:path.join(root,'persist'),migrationCount:names.length,verifiedBaseMigration:'0020'},null,2))
