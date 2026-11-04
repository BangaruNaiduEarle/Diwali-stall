import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// Include the complete build graph, including future lazy JS/CSS chunks.
export function pwaShellPlugin() {
  return {
    name: 'diwali-pwa-shell', apply: 'build', enforce: 'post',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter(name => name.startsWith('assets/')).sort().map(name => '/' + name)
      assets.push('/manifest.webmanifest', '/icons/diwali-192.png', '/icons/diwali-512.png', '/icons/diwali-maskable-512.png')
      const template = readFileSync(new URL('../public/offline-billing-sw.js', import.meta.url), 'utf8')
      const hash = createHash('sha256').update(template)
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name]
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source)
      }
      for (const asset of assets.filter(path => !path.startsWith('/assets/'))) hash.update(readFileSync(new URL('../public' + asset, import.meta.url)))
      this.emitFile({ type: 'asset', fileName: 'offline-billing-sw.js', source: template
        .replace('/* BUILD_ASSETS */ []', JSON.stringify(assets))
        .replace('development', hash.digest('hex').slice(0, 16)) })
    },
  }
}
