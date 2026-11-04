import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { buildAdminCustomerRequestListFilter } from '../src/services/adminCustomerRequests.js'
import { customerRequestDb } from '../src/lib/adminCustomerRequestScope.js'
import { fixture, attach, season, previous } from './helpers/mockAdminTransactionDb.js'

// Execute the actual scoped search SQL against SQLite :memory: only. No migrations.
const sqlite = `import json,sqlite3,sys
p=json.load(sys.stdin); d=sqlite3.connect(':memory:'); d.row_factory=sqlite3.Row
d.execute('CREATE TABLE customer_requests(id TEXT,public_reference TEXT,customer_name TEXT,customer_phone TEXT,status TEXT,finalization_status TEXT,assigned_to_email TEXT,location_id TEXT,season_id TEXT,created_at TEXT,revision INTEGER NOT NULL DEFAULT 0)')
d.execute('CREATE TABLE customer_request_items(request_id TEXT,product_id TEXT,family_pack_id TEXT)')
d.execute('CREATE TABLE quotations(customer_request_id TEXT,status TEXT,location_id TEXT,season_id TEXT)')
for r in p['rows']: d.execute('INSERT INTO customer_requests(id,public_reference,customer_name,customer_phone,status,finalization_status,assigned_to_email,location_id,season_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',r)
print(json.dumps([dict(r) for r in d.execute(p['sql'],p['values'])]))`
const rows = [
  ['internal-a','DWL-TKTSWMFM','Ravi Kumar','+91 (987) 654-3210','received','pending','owner@test.com','loc-a',season,'2026-11-03'],
  ['internal-a2','DWL-TKTSABCD','Ravi Other','9871230000','reviewing','finalized','other@test.com','loc-a',season,'2026-11-04'],
  ['internal-b','DWL-TKTSWXYZ','Ravi Kumar','+91 (987) 654-3210','received','pending','owner@test.com','loc-b',season,'2026-11-05'],
  ['internal-old','DWL-TKTSABEF','Ravi Kumar','+91 (987) 654-3210','received','pending','owner@test.com','loc-a',previous,'2026-11-05'],
]
async function search(opts, limit=25, offset=0) {
  const db=fixture(), {context}=await attach(db)
  db.prepare=sql=>({bind:(...values)=>{
    const execute=()=>{
    const win=process.platform==='win32'
    return JSON.parse(execFileSync(win?'py':'python3',win?['-3','-c',sqlite]:['-c',sqlite],{
      input:JSON.stringify({rows,sql,values}),encoding:'utf8',windowsHide:true,
    }))
    }
    return {all:async()=>({results:execute()}),first:async()=>execute()[0]??null}
  }})
  const {whereSql,binds}=buildAdminCustomerRequestListFilter({seasonId:season,...opts})
  const scoped=customerRequestDb(db,season,context)
  const sql=`SELECT r.id FROM customer_requests r ${whereSql} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`
  return (await scoped.prepare(sql).bind(...binds,limit,offset).all()).results.map(r=>r.id)
}
test('stored references support exact/partial case-insensitive matches without internal ID search',async()=>{
  assert.deepEqual(await search({q:'DWL-TKTSWMFM'}),['internal-a'])
  assert.deepEqual(await search({q:'tkts'}),['internal-a2','internal-a'])
  assert.deepEqual(await search({q:'WMFM'}),['internal-a'])
  assert.deepEqual(await search({q:'internal-a'}),[])
})
test('partial names and formatted phones remain scoped to stall and operating season',async()=>{
  for(const q of ['ravi','987'])assert.deepEqual(await search({q}),['internal-a2','internal-a'])
  assert.deepEqual(await search({q:'+91 (987) 654-3210'}),['internal-a'])
})
test('search preserves filters, ordering, pagination and clear/no-match behavior',async()=>{
  assert.deepEqual(await search({q:'tkts',status:'received',finalizationStatus:'pending',assignedToEmail:'owner@test.com'}),['internal-a'])
  assert.deepEqual(await search({q:'tkts'},1,1),['internal-a'])
  assert.deepEqual(await search({q:'missing'}),[])
  assert.deepEqual(await search({q:'  '}),['internal-a2','internal-a'])
})
test('LIKE wildcards and SQL text remain literal search input',async()=>{
  for(const q of ['%','_',"%' OR 1=1 --"])assert.deepEqual(await search({q}),[])
})
