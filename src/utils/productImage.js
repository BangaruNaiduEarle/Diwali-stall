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

/** Local catalogue paths that have a matching file under `public/images/products/images-mobile-webp/`. */
export const catalogueLocalImagePaths = new Set(Object.keys(catalogueCloudinaryByPath))

/**
 * Cloudinary delivery public_id → local path for assets outside the generated catalogue map
 * (admin uploads / family packs / products with on-disk files under `public/images/`).
 */
const supplementalCloudinaryPublicIdToLocalPath = {
  'diwali/products/P114/1.webp': '/images/products/images-mobile-webp/dora-dora.webp',
  'diwali/products/P163/1.webp': '/images/products/images-mobile-webp/1_lakh_box.webp',
  'diwali/products/P163/2.webp': '/images/products/images-mobile-webp/1_lakh_in.webp',
  'diwali/family-packs/FP001/1.png': '/images/family-packs/pocket_budget_pack.webp',
  'diwali/family-packs/FP001/2.webp': '/images/products/images-mobile-webp/pocket_budget_pack.webp',
  'diwali/family-packs/FP002/1.webp': '/images/family-packs/budget_mix_pack.webp',
  'diwali/family-packs/FP002/2.webp': '/images/products/images-mobile-webp/budget_mix_pack.webp',
  'diwali/family-packs/FP003/1.webp': '/images/family-packs/Budget_Family_Pack.webp',
  'diwali/family-packs/FP004/1.webp': '/images/family-packs/Mini_Starter_Pack.webp',
  'diwali/family-packs/FP005/1.webp': '/images/family-packs/Mini_Family_Pack.webp',
  'diwali/family-packs/FP006/1.webp': '/images/family-packs/Happy_Family_Pack.webp',
}

/** @param {string} url */
function cloudinaryPublicIdFromDeliveryUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    const uploadIdx = parts.indexOf('upload')
    if (uploadIdx === -1) return ''
    let i = uploadIdx + 1
    if (/^v\d+$/.test(parts[i] ?? '')) i += 1
    return parts.slice(i).join('/')
  } catch {
    return ''
  }
}

/** Cloudinary public_id (and full secure_url) → local `/images/...` when a catalogue file exists. */
const catalogueCloudinaryToLocalPath = (() => {
  /** @type {Map<string, string>} */
  const byPublicId = new Map()
  /** @type {Map<string, string>} */
  const bySecureUrl = new Map()
  for (const [localPath, secureUrl] of Object.entries(catalogueCloudinaryByPath)) {
    if (!catalogueLocalImagePaths.has(localPath)) continue
    bySecureUrl.set(secureUrl, localPath)
    const publicId = cloudinaryPublicIdFromDeliveryUrl(secureUrl)
    if (publicId) byPublicId.set(publicId, localPath)
  }
  for (const [publicId, localPath] of Object.entries(supplementalCloudinaryPublicIdToLocalPath)) {
    byPublicId.set(publicId, localPath)
  }
  return { byPublicId, bySecureUrl }
})()

function resolveLocalCataloguePath(path) {
  return CATALOGUE_IMAGE_PATH_ALIASES[path] ?? path
}

/** @param {string} url */
function resolveCloudinaryUrlToLocalCataloguePath(url) {
  const exact = catalogueCloudinaryToLocalPath.bySecureUrl.get(url)
  if (exact) return exact
  const publicId = cloudinaryPublicIdFromDeliveryUrl(url)
  if (!publicId) return url
  return catalogueCloudinaryToLocalPath.byPublicId.get(publicId) ?? url
}

/**
 * Normalize a single path for browser use. Never returns `public/...`.
 */
export function normalizeProductImageUrl(raw) {
  if (raw == null) return ''
  let s = String(raw).trim()
  if (!s) return ''

  if (s.startsWith('http://') || s.startsWith('https://')) {
    if (s.includes('res.cloudinary.com') && s.includes('/image/upload/')) {
      return resolveCloudinaryUrlToLocalCataloguePath(s)
    }
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
