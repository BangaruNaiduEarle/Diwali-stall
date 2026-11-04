import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { fetch as toolingFetch } from 'undici'
import sharp from 'sharp'
import WebSocket from 'ws'

// No D1 bindings, configuration files or persistence paths participate in these
// checks. They exercise APIs used by the pinned Wrangler/Miniflare toolchain.
const memoryOnly = {
  modules: true, compatibilityDate: '2026-05-01', host: '127.0.0.1', port: 0,
  cachePersist: false, d1Persist: false, kvPersist: false, r2Persist: false,
  durableObjectsPersist: false,
}

test('patched esbuild bundles the actual Worker and undici reaches workerd on Node 20', async () => {
  const built = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false,
    logLevel: 'silent',
  })
  const runtime = new Miniflare({ ...memoryOnly, script: built.outputFiles[0].text })
  try {
    const address = await runtime.ready
    for (let index = 0; index < 3; index++) {
      const response = await toolingFetch(new URL('/health', address))
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal((await response.json()).service, 'diwali-api')
    }
  } finally { await runtime.dispose() }
})

test('patched ws supports the Miniflare/workerd WebSocket transport', async () => {
  const runtime = new Miniflare({ ...memoryOnly, script: `export default { fetch() {
    const pair = new WebSocketPair(); pair[1].accept();
    pair[1].addEventListener('message', event => pair[1].send('echo:' + event.data));
    return new Response(null, { status: 101, webSocket: pair[0] });
  } }` })
  let socket
  try {
    const address = await runtime.ready
    address.protocol = 'ws:'
    socket = new WebSocket(address)
    await once(socket, 'open')
    const reply = once(socket, 'message')
    socket.send('security-patch')
    assert.equal(String((await reply)[0]), 'echo:security-patch')
    const closed = once(socket, 'close'); socket.close(); await closed
  } finally { socket?.terminate(); await runtime.dispose() }
})

test('patched sharp native binaries support Miniflare image info, resize and output', async () => {
  const image = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#ff6600' } }).png().toBuffer()
  const runtime = new Miniflare({ ...memoryOnly, images: { binding: 'IMAGES' }, script: 'export default { fetch() { return new Response("test"); } }' })
  try {
    await runtime.ready
    const images = await runtime.getImagesBinding('IMAGES')
    const info = await images.info(new Blob([image]).stream())
    assert.equal(info.format, 'image/png'); assert.equal(info.width, 8); assert.equal(info.height, 6)
    for (const format of ['image/png', 'image/jpeg', 'image/webp', 'image/avif']) {
      const output = await images.input(new Blob([image]).stream()).transform({ width: 4, height: 3 }).output({ format })
      const response = output.response()
      assert.equal(response.headers.get('content-type'), format)
      const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
      assert.equal(metadata.width, 4); assert.equal(metadata.height, 3)
    }
  } finally { await runtime.dispose() }
})
