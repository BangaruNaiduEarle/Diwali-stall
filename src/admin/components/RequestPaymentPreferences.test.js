import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transform } from '../../../server/node_modules/esbuild/lib/main.js'

test('preference form renders stored fields, conditional Received Amount, and read-only state', async () => {
  const require = createRequire(import.meta.url)
  const file = new URL('./RequestPaymentPreferences.jsx', import.meta.url)
  let source = readFileSync(file, 'utf8')
  source = source.replace("from 'react'", `from '${pathToFileURL(require.resolve('react')).href}'`)
    .replace("from '../api/adminApi.js'", `from '${new URL('../api/adminApi.js', file).href}'`)
    .replace("from '../../shared/requestPaymentPreferences.js'", `from '${new URL('../../shared/requestPaymentPreferences.js', file).href}'`)
  const compiled = await transform(source, { loader: 'jsx', format: 'esm', jsxFactory: 'React.createElement' })
  const module = await import('data:text/javascript;base64,' + Buffer.from(`import React from '${pathToFileURL(require.resolve('react')).href}';\n` + compiled.code).toString('base64'))
  for (const status of ['paid', 'unpaid', 'partial_paid']) {
    const markup = renderToStaticMarkup(React.createElement(module.default, {
      request: { id: 'request-1', paymentPreferences: { status, mode: 'offline', receivedAmountPaise: status === 'partial_paid' ? 1234 : null } },
      agreedAmountPaise: 10000, revision: 7, disabled: false, onSaved: async () => {},
    }))
    assert.match(markup, /Payment Status/)
    assert.match(markup, /Payment Mode/)
    assert.equal(markup.includes('Received Amount (₹)'), status === 'partial_paid')
    assert.match(markup, /value="offline" selected=""/)
    if (status === 'partial_paid') assert.match(markup, /value="12.34"/)
  }
  const markup = renderToStaticMarkup(React.createElement(module.default, { request: {}, disabled: true }))
  assert.match(markup, /fieldset disabled=""/)
  assert.match(markup, /Record actual payments through the existing payment workflow/)
})
