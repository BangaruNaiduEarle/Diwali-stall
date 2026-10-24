import { catalogueCloudinaryByPath } from '../data/catalogueCloudinaryByPath.js'

/** Files in `public/images/products/` are served at `/images/products/` */
export const PRODUCT_IMAGE_DIR = '/images/products'

export const PRODUCT_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

/** Stored paths with no file on disk — point at existing catalogue assets. */
const CATALOGUE_IMAGE_PATH_ALIASES = {
  '/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp':
    '/images/products/images-mobile-webp/GC_SPECIAL_AJN.jpg',
  '/images/products/images-mobile-webp/COLOUR_KOTI_DLX.webp':
    '/images/products/images-mobile-webp/COLOUR_KOTI_DLX_AJN.webp',
  '/images/products/images-mobile-webp/GANGA_JAMUNA_AJN.webp':
    '/images/products/images-mobile-webp/GANGA_JAMUNA.webp',
}

function resolveLocalCataloguePath(path) {
  const normalized = CATALOGUE_IMAGE_PATH_ALIASES[path] ?? path
  return catalogueCloudinaryByPath[normalized] ?? normalized
}

/**
 * Normalize a single path for browser use. Never returns `public/...`.
 */
export function normalizeProductImageUrl(raw) {
  if (raw == null) return ''
  let s = String(raw).trim()
  if (!s) return ''

  if (s.startsWith('http://') || s.startsWith('https://')) {
    return s
  }

  s = s.replace(/\\/g, '/')
  s = s.replace(/^\/public\//i, '/')
  s = s.replace(/^public\//i, '')

  if (s.startsWith('/images/')) {
    return resolveLocalCataloguePath(s)
  }

  if (s.startsWith('images/')) {
    return resolveLocalCataloguePath(`/${s}`)
  }

  if (s.startsWith('/')) {
    return s
  }

  return `${PRODUCT_IMAGE_DIR}/${s.replace(/^\.?\//, '')}`
}

/** Normalize and dedupe explicit `product.images` entries (no ID fallback). */
export function normalizeProductImages(images) {
  if (!Array.isArray(images)) return []

  const out = []
  const seen = new Set()

  for (const entry of images) {
    const url = normalizeProductImageUrl(entry)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }

  return out
}

/** Extension variants for one logical slide (front, back, or legacy single file). */
export function getProductIdFallbackImageSlots(productId) {
  const id = productId?.trim()
  if (!id) return []

  const slotSuffixes = ['-front', '-back', '']
  return slotSuffixes.map((suffix) =>
    PRODUCT_IMAGE_EXTENSIONS.map((ext) => `${PRODUCT_IMAGE_DIR}/${id}${suffix}.${ext}`),
  )
}

/**
 * Flat candidate list (legacy helpers). Prefer {@link getProductIdFallbackImageSlots} for UI.
 */
export function getProductIdFallbackImageUrls(productId) {
  return getProductIdFallbackImageSlots(productId).flat()
}

/**
 * URLs to display for a product: explicit `images` first, else ID fallback candidates.
 */
export function resolveProductImageList(product) {
  const fromData = normalizeProductImages(product?.images)
  if (fromData.length) return fromData
  const legacy = normalizeProductImageUrl(product?.image)
  if (legacy) return [legacy]
  return getProductIdFallbackImageUrls(product?.id)
}

export function getCataloguePrimaryImage(product) {
  const list = resolveProductImageList(product)
  return list[0] ?? ''
}

/** @deprecated use resolveProductImageList(product) */
export function getProductImageCandidates(productId, explicitSrc) {
  if (explicitSrc?.trim()) {
    const url = normalizeProductImageUrl(explicitSrc)
    return url ? [url, ...getProductIdFallbackImageUrls(productId)] : getProductIdFallbackImageUrls(productId)
  }
  return getProductIdFallbackImageUrls(productId)
}
