import { imagePreviewSrc } from '../lib/cloudinaryUpload.js'

/** Optional, bounded preparation. Billing never depends on a photo download. */
export async function downloadProductPhotos(sources = {}, fetchImage = globalThis.fetch) {
  const entries = Object.entries(sources).slice(0, 120)
  const images = {}, controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  let cursor = 0
  try {
    await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
      while (cursor < entries.length && !controller.signal.aborted) {
        const [id, source] = entries[cursor++]
        const url = imagePreviewSrc(source)
        if (!url) continue
        try {
          const response = await fetchImage(url, { signal: controller.signal, credentials: 'omit', redirect: 'error' })
          if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) continue
          if (Number(response.headers.get('Content-Length')) > 512000) continue
          const blob = await response.blob()
          if (blob.size > 0 && blob.size <= 512000) images[id] = blob
        } catch { /* A failed/CORS-blocked photo gets an icon, never a failed bill. */ }
      }
    }))
  } finally { clearTimeout(timer) }
  return images
}
