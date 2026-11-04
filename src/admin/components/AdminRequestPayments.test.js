import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'

const require = createRequire(import.meta.url)
const component = build({ entryPoints: [fileURLToPath(new URL('./AdminRequestPayments.jsx', import.meta.url))], bundle: true,
  write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }))
  } }],
}).then(result => import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))).then(module => module.default)

const summary = { eligible: true, paymentStatus: 'HOLD', amountDuePaise: 10000, receivedPaise: 2500, outstandingPaise: 7500, revision: 7 }

test('Admin sees payment summary but no recording, method or hold-management controls', async () => {
  const Payments = await component
  const html = renderToStaticMarkup(createElement(Payments, { requestId: 'r1', contextKey: 'scope', initialSummary: summary, canRecord: false }))
  assert.ok(html.includes('Payment hold')); assert.ok(html.includes('₹75.00'))
  assert.ok(!html.includes('<form')); assert.ok(!html.includes('Received amount (₹)'))
  assert.ok(!/purchase|profit/i.test(html))
})

test('privileged form exposes distinct action, recording mode, payment method and occurrence fields', async () => {
  const Payments = await component
  const html = renderToStaticMarkup(createElement(Payments, { requestId: 'r1', contextKey: 'scope', initialSummary: summary, canRecord: true }))
  assert.ok(html.includes('<form')); assert.ok(html.includes('Place payment hold')); assert.ok(html.includes('Release payment hold'))
  assert.ok(html.includes('Recording mode')); assert.ok(html.includes('Payment method')); assert.ok(html.includes('Occurrence time'))
})
