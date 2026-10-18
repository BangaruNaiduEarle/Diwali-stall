import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { before, describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { d1QueryLocal } from './helpers/d1Local.js'
import { cleanupKnownTestRows } from './helpers/testDbCleanup.js'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(SERVER_ROOT, '..')
const IMPORT_JSON = path.join(SERVER_ROOT, 'data', 'catalogue-import.json')
const SOURCE_MODULE = path.join(REPO_ROOT, 'src', 'data', 'products.js')

function runImport() {
  execFileSync('node', ['scripts/import-catalogue-local.mjs'], {
    cwd: SERVER_ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
}

before(() => {
  execFileSync('node', ['scripts/generate-catalogue-import.mjs'], {
    cwd: SERVER_ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
  cleanupKnownTestRows()
})

describe('catalogue import (local D1)', () => {
  it('generated import JSON matches live source count', async () => {
    assert.ok(fs.existsSync(IMPORT_JSON))
    const { products } = await import(pathToFileURL(SOURCE_MODULE).href)
    const payload = JSON.parse(fs.readFileSync(IMPORT_JSON, 'utf8'))
    assert.equal(payload.sourceProductCount, products.length)
    assert.equal(payload.records.length, payload.sourceProductCount)
  })

  it('import is idempotent and preserves product ids', () => {
    const payload = JSON.parse(fs.readFileSync(IMPORT_JSON, 'utf8'))
    const expectedIds = payload.records.map((r) => r.id)
    const expectedSet = new Set(expectedIds)

    cleanupKnownTestRows()
    runImport()
    const count1 = Number(d1QueryLocal('SELECT COUNT(*) AS n FROM products')[0]?.n)
    const ids1 = d1QueryLocal('SELECT id FROM products ORDER BY sort_order ASC, id ASC').map((r) => r.id)
    const extras1 = ids1.filter((id) => !expectedSet.has(id))
    assert.equal(extras1.length, 0, `unexpected products after import: ${extras1.join(', ')}`)

    runImport()
    const count2 = Number(d1QueryLocal('SELECT COUNT(*) AS n FROM products')[0]?.n)
    const ids2 = d1QueryLocal('SELECT id FROM products ORDER BY sort_order ASC, id ASC').map((r) => r.id)

    assert.equal(count1, count2)
    assert.equal(count1, payload.records.length)
    assert.deepEqual(ids1, expectedIds)
    assert.deepEqual(ids2, expectedIds)
    assert.equal(ids1[0], 'P001')
  })

  it('does not store price or x4 columns in products table', () => {
    const cols = d1QueryLocal('PRAGMA table_info(products)')
    const names = cols.map((c) => c.name)
    assert.ok(!names.includes('price'))
    assert.ok(!names.includes('x4'))
    assert.ok(names.includes('company'))
  })

  it('maps first product category slug to gift-boxes', () => {
    const row = d1QueryLocal(
      "SELECT category_slug, name, sort_order FROM products WHERE id = 'P001'",
    )[0]
    assert.equal(row?.category_slug, 'gift-boxes')
    assert.equal(row?.sort_order, 0)
  })
})
